import fs from 'node:fs/promises';
import path from 'node:path';

export async function build(presentation, root) {
  const slides=JSON.parse(await fs.readFile(path.join(root,'sources/deck-content.json'),'utf8'));
  const palette={bg:'#F5F6F2',ink:'#193B32',green:'#28745F',muted:'#657A70',light:'#E4EEE6',line:'#BFCEC3',future:'#9A6B30'};
  const parts=['系统现状与问题','模块依赖与 C4','数据流与故障影响','部署方案与成本','ADR 与推荐方案','分阶段升级与回退'];
  function text(slide,value,x,y,w,h,size=27,color=palette.ink,bold=false,align='left') {
    const shape=slide.shapes.add({geometry:'textbox',name:String(value).slice(0,35),position:{left:x,top:y,width:w,height:h},fill:'none',line:{fill:'none',width:0}});
    shape.text=value;
    shape.text.style={typeface:'Microsoft YaHei',fontSize:size,color,bold,alignment:align,verticalAlignment:'middle',wrap:'square',autoFit:'none',insets:0};
    return shape;
  }
  function rule(slide,y){slide.shapes.add({geometry:'rect',position:{left:72,top:y,width:1136,height:1},fill:palette.line,line:{width:0,fill:'none'}});}
  function box(slide,n) {
    const primary=n.role==='primary', future=n.role==='future';
    const shape=slide.shapes.add({geometry:'rect',name:n.id,position:{left:n.x,top:n.y,width:n.w,height:n.h},fill:primary?palette.green:future?'#FBF5E9':palette.light,line:{fill:future?palette.future:palette.green,width:1.4,style:future?'dashed':'solid'}});
    shape.text=n.text;
    shape.text.style={typeface:'Microsoft YaHei',fontSize:24,bold:primary,color:primary?'#FFFFFF':palette.ink,alignment:'center',verticalAlignment:'middle',wrap:'square',autoFit:'none',insets:9};
    return shape;
  }
  function addTable(slide,values,number) {
    const columns=values[0].length,rows=values.length;
    let widths=columns===3?[220,385,531]:columns===4?[360,250,260,266]:[245,210,210,210,261];
    if(number===10)widths=[340,440,356];
    if(number===30)widths=[250,495,391];
    const height=Math.min(440,rows*68);
    const table=slide.tables.add({rows,columns,left:72,top:205,width:1136,height,values,columnWidths:widths});
    table.borders.assign({fill:palette.line,width:0.6,style:'solid'});
    table.cells.block({row:0,column:0,rowCount:rows,columnCount:columns}).assign({textStyle:{typeface:'Microsoft YaHei',fontSize:23,color:palette.ink},margins:{left:14,right:14,top:9,bottom:9},anchor:'center'});
    for(let r=0;r<rows;r++) {
      table.rows[r].height=height/rows;
      for(let c=0;c<columns;c++) {
        const cell=table.getCell(r,c);cell.fill=r===0?palette.green:r%2?'#FFFFFF':'#EAF0E9';
        cell.text.style={typeface:'Microsoft YaHei',fontSize:23,color:r===0?'#FFFFFF':palette.ink,bold:r===0};
      }
    }
    return table;
  }
  for (const spec of slides) {
    const s=spec.number===1&&presentation.slides.items.length===1?presentation.slides.items[0]:presentation.slides.add();
    s.background.fill=palette.bg;
    if(spec.kind==='cover') {
      text(s,'MD2DOCX',72,64,1060,48,27,palette.green,true);
      text(s,spec.title,72,140,1136,90,56,palette.ink,true);
      text(s,'真实结构、部署选择与渐进升级',72,245,1136,55,32,palette.muted);
      rule(s,345);
      spec.content.forEach((v,i)=>text(s,v,72+(i%2)*585,385+Math.floor(i/2)*66,550,44,27));
      text(s,spec.subtitle,72,632,1136,30,19,palette.muted);
    } else {
      text(s,`${String(spec.part).padStart(2,'0')}  ${parts[spec.part-1]}   /   讲者 ${spec.part}`,72,34,1100,30,19,palette.green,true);
      text(s,spec.title,72,82,1136,64,42,palette.ink,true);
      text(s,spec.subtitle,72,150,1136,35,24,palette.muted);
      if(spec.kind==='table') { addTable(s,spec.content,spec.number); if(spec.footnote) text(s,spec.footnote,72,510,1136,95,23,palette.muted); }
      else if(spec.kind==='points') {
        spec.content.forEach(([label,body],i)=>{
          const y=215+i*103;
          text(s,label,72,y,215,55,28,palette.green,true);
          text(s,body,315,y,893,68,28);
          if(i<spec.content.length-1)rule(s,y+86);
        });
      } else if(spec.kind==='diagram') {
        const shapes=new Map(spec.content.nodes.map(n=>[n.id,box(s,n)]));
        for(const [a,b] of spec.content.edges) {
          const na=spec.content.nodes.find(n=>n.id===a), nb=spec.content.nodes.find(n=>n.id===b);
          const sameRow=Math.abs(na.y-nb.y)<150 && Math.abs(na.x-nb.x)>250;
          const down=nb.y>na.y;
          s.shapes.connect(shapes.get(a),shapes.get(b),{kind:'elbow',fromSide:sameRow?(nb.x>na.x?'right':'left'):(down?'bottom':'top'),toSide:sameRow?(nb.x>na.x?'left':'right'):(down?'top':'bottom'),line:{fill:palette.green,width:2},tail:{type:'triangle',width:'sm',length:'sm'}});
        }
        if(spec.content.caption)text(s,spec.content.caption,72,650,1136,32,19,palette.muted);
      }
    }
    text(s,`${String(spec.number).padStart(2,'0')} / 30`,1105,684,103,22,16,palette.muted,false,'right');
    s.speakerNotes.text=`讲者 ${spec.part}，第 ${spec.number} 页，计划 ${spec.seconds} 秒\n\n${spec.notes}`;
  }
  return {slides:slides.length,parts:6,seconds:slides.reduce((sum,s)=>sum+s.seconds,0)};
}
