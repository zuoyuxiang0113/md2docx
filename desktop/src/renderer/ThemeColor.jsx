import React, { useEffect, useRef, useState } from "react";
import { colorPresets, hexRgb, rgbHex, hexHsv, hsvHex } from "./theme-colors.js";

export default function ThemeColor({ value, onChange, language }) {
  const zh = language === "zh";
  const selected = value || "#28745F";
  const [expanded, setExpanded] = useState(false);
  const [color, setColor] = useState(selected);
  const [hex, setHex] = useState(selected);
  const [rgb, setRgb] = useState(hexRgb(selected).map(String));
  const [hsv, setHsv] = useState(hexHsv(selected));
  const [error, setError] = useState("");
  const onChangeRef = useRef(onChange);
  onChangeRef.current = onChange;
  useEffect(() => { setColor(selected); setHex(selected); setRgb(hexRgb(selected).map(String)); setHsv(hexHsv(selected)); setError(""); }, [selected]);
  useEffect(() => {
    if (color === selected) return;
    const timer = setTimeout(() => onChangeRef.current(color), 180);
    return () => clearTimeout(timer);
  }, [color, selected]);
  function update(next, nextHsv = hexHsv(next)) { setColor(next); setHex(next); setRgb(hexRgb(next).map(String)); setHsv(nextHsv); setError(""); }
  function move(event) {
    const bounds = event.currentTarget.getBoundingClientRect();
    const s = Math.min(1, Math.max(0, (event.clientX - bounds.left) / bounds.width));
    const v = 1 - Math.min(1, Math.max(0, (event.clientY - bounds.top) / bounds.height));
    update(hsvHex(hsv[0], s, v), [hsv[0], s, v]);
  }
  function editHex(text) {
    setHex(text);
    const next = text.startsWith("#") ? text : "#" + text;
    if (/^#[0-9a-f]{6}$/i.test(next)) update(next.toUpperCase());
    else setError(zh ? "请输入 6 位十六进制颜色，例如 #377DE0。" : "Enter a six-digit HEX color, e.g. #377DE0.");
  }
  function editRgb(index, text) {
    const values = rgb.map((item, position) => position === index ? text : item);
    setRgb(values);
    if (values.every((item) => /^\d{1,3}$/.test(item) && Number(item) <= 255)) update(rgbHex(values.map(Number)));
    else setError(zh ? "RGB 每项需为 0–255 的整数。" : "Each RGB channel must be an integer from 0 to 255.");
  }
  return <section className="settings-section settings-extra theme-color-section">
    <div className="settings-section-heading"><h2>{zh ? "主题色" : "Accent color"}</h2><span className="theme-current-color"><i style={{ background: value || "var(--accent)" }} />{value || (zh ? "默认" : "Default")}</span></div>
    <div className="theme-presets">
      <button className={`theme-preset ${!value ? "selected" : ""}`} style={{ "--preset-color": "#28745F" }} type="button" aria-pressed={!value} onClick={() => onChange(null)}><i className="theme-default-swatch" />{zh ? "默认" : "Default"}</button>
      {colorPresets.map((preset) => <button type="button" key={preset.color} style={{ "--preset-color": preset.color }} aria-pressed={value === preset.color} className={`theme-preset ${value === preset.color ? "selected" : ""}`} onClick={() => onChange(preset.color)}><i style={{ background: preset.color }} />{zh ? preset.zh : preset.en}</button>)}
    </div>
    <button className={`theme-color-toggle ${expanded ? "expanded" : ""}`} type="button" aria-expanded={expanded} aria-controls="theme-color-picker" onClick={() => setExpanded(!expanded)}><span className="theme-color-toggle-label"><i className="theme-custom-swatch" />{zh ? "自定义主题色" : "Custom accent color"}</span><span aria-hidden="true">{expanded ? "⌃" : "⌄"}</span></button>
    {expanded && <div className="theme-color-picker" id="theme-color-picker">
      <div className="theme-palette-column">
        <div className="theme-sv-palette" role="slider" tabIndex={0} aria-label={zh ? "饱和度与亮度色盘" : "Saturation and brightness"} aria-valuemin={0} aria-valuemax={100} aria-valuenow={Math.round(hsv[1] * 100)} aria-valuetext={`${zh ? "饱和度" : "Saturation"} ${Math.round(hsv[1] * 100)}%, ${zh ? "亮度" : "Brightness"} ${Math.round(hsv[2] * 100)}%`} style={{ backgroundColor: hsvHex(hsv[0], 1, 1) }} onPointerDown={(event) => { event.currentTarget.setPointerCapture(event.pointerId); move(event); }} onPointerMove={(event) => { if (event.currentTarget.hasPointerCapture(event.pointerId)) move(event); }} onKeyDown={(event) => {
          if (!["ArrowLeft", "ArrowRight", "ArrowUp", "ArrowDown"].includes(event.key)) return;
          event.preventDefault();
          const s = Math.min(1, Math.max(0, hsv[1] + (event.key === "ArrowRight" ? .01 : event.key === "ArrowLeft" ? -.01 : 0)));
          const v = Math.min(1, Math.max(0, hsv[2] + (event.key === "ArrowUp" ? .01 : event.key === "ArrowDown" ? -.01 : 0)));
          update(hsvHex(hsv[0], s, v), [hsv[0], s, v]);
        }}><span className="theme-palette-cursor" style={{ left: `${hsv[1] * 100}%`, top: `${(1 - hsv[2]) * 100}%` }} /></div>
        <label className="theme-hue-label"><span>{zh ? "色相" : "Hue"}</span><input className="theme-hue-slider" type="range" min="0" max="359" value={Math.round(hsv[0])} onChange={(event) => { const h = Number(event.target.value); update(hsvHex(h, hsv[1], hsv[2]), [h, hsv[1], hsv[2]]); }} /></label>
      </div>
      <div className="theme-color-values">
        <label className="control-field"><span>HEX</span><input spellCheck={false} maxLength={7} value={hex} aria-invalid={Boolean(error)} onChange={(event) => editHex(event.target.value)} /></label>
        <div className="theme-rgb-fields">{["R", "G", "B"].map((channel, index) => <label className="control-field" key={channel}><span>{channel}</span><input type="number" min="0" max="255" step="1" value={rgb[index]} onChange={(event) => editRgb(index, event.target.value)} /></label>)}</div>
        {error && <p className="theme-color-error" role="status">{error}</p>}
      </div>
    </div>}
  </section>;
}
