"""Synthetic WSL benchmark. No user documents, no service DB, no network."""
import asyncio, json, os, resource, statistics, subprocess, sys, tempfile, time
from pathlib import Path
from server.runner import Sandbox
from server.settings import Settings

async def sample(case):
    s=Settings.from_env()
    with tempfile.TemporaryDirectory(prefix='md2docx-talk-bench-') as tmp:
        w=Path(tmp); (w/'inputs').mkdir(); (w/'outputs').mkdir()
        profile=json.loads(Path('core/defaults.json').read_text()); profile['numbering']['stripExisting']=False
        (w/'config.json').write_text(json.dumps(profile),encoding='utf-8')
        text={
          'small': '# 2026 测试报告\n\n中文正文 **加粗**。\n',
          'table_math': '# 表格公式\n\n| 项目 | 数量 |\n| --- | --- |\n| 文档 | 1 |\n\n$x^2+y^2=z^2$\n',
          'long': '# 长文档\n\n' + ('## 章节\n\n这是一段用于性能观察的合成中文正文。English test text.\n\n' * 200),
        }[case]
        (w/'inputs/test.md').write_text(text,encoding='utf-8')
        start=time.perf_counter()
        report=await Sandbox(s).run(w,'test.md','test.docx',{'missingImages':'warning'},'bench',asyncio.Event(),lambda _:None,60)
        return {'case':case,'wall_s':round(time.perf_counter()-start,4),'child_highwater_kib':resource.getrusage(resource.RUSAGE_CHILDREN).ru_maxrss,'input_bytes':len(text.encode()),'output_bytes':(w/'outputs/test.docx').stat().st_size}

if __name__=='__main__':
    if len(sys.argv)>1:
        print(json.dumps(asyncio.run(sample(sys.argv[1]))))
    else:
        samples=[]
        for case in ['small','table_math','long']:
            for repeat in range(5):
                r=subprocess.run([sys.executable,__file__,case],capture_output=True,text=True,check=True,env={**os.environ,'PYTHONPATH':str(Path.cwd())})
                samples.append(json.loads(r.stdout))
        summary={case:{'n':5,'median_s':round(statistics.median(x['wall_s'] for x in samples if x['case']==case),4),'max_s':max(x['wall_s'] for x in samples if x['case']==case),'max_child_highwater_mib':round(max(x['child_highwater_kib'] for x in samples if x['case']==case)/1024,1)} for case in ['small','table_math','long']}
        out=Path(__file__).parent/'benchmark-results.json'
        result={'scope':'WSL Ubuntu-26.04, local synthetic sandbox CLI samples; not VMware, not 2-core/2GB capacity','logical_cpus':os.cpu_count(),'samples':samples,'summary':summary}
        out.write_text(json.dumps(result,ensure_ascii=False,indent=2),encoding='utf-8'); print(json.dumps(result,ensure_ascii=False,indent=2))
