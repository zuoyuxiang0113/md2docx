export const colorPresets = [
  { color: "#28745F", zh: "松绿", en: "Green" },
  { color: "#377DE0", zh: "湖蓝", en: "Blue" },
  { color: "#8965D8", zh: "紫罗兰", en: "Violet" },
  { color: "#D98432", zh: "琥珀", en: "Amber" },
  { color: "#CE5D83", zh: "玫瑰", en: "Rose" },
  { color: "#708293", zh: "石墨", en: "Slate" },
];

export function hexRgb(hex) { return [1, 3, 5].map((position) => parseInt(hex.slice(position, position + 2), 16)); }
export function rgbHex(rgb) { return "#" + rgb.map((value) => Math.round(Math.min(255, Math.max(0, value))).toString(16).padStart(2, "0")).join("").toUpperCase(); }
export function hexHsv(hex) {
  const [r, g, b] = hexRgb(hex).map((value) => value / 255);
  const max = Math.max(r, g, b), min = Math.min(r, g, b), delta = max - min;
  let hue = 0;
  if (delta) hue = max === r ? ((g - b) / delta) % 6 : max === g ? (b - r) / delta + 2 : (r - g) / delta + 4;
  return [(hue * 60 + 360) % 360, max ? delta / max : 0, max];
}
export function hsvHex(h, s, v) {
  const c = v * s, x = c * (1 - Math.abs((h / 60) % 2 - 1)), m = v - c;
  const channels = h < 60 ? [c, x, 0] : h < 120 ? [x, c, 0] : h < 180 ? [0, c, x] : h < 240 ? [0, x, c] : h < 300 ? [x, 0, c] : [c, 0, x];
  return rgbHex(channels.map((value) => (value + m) * 255));
}
function luminance(hex) {
  const [r, g, b] = hexRgb(hex).map((value) => { const n = value / 255; return n <= .04045 ? n / 12.92 : ((n + .055) / 1.055) ** 2.4; });
  return .2126 * r + .7152 * g + .0722 * b;
}
function readableAccent(hex, dark, surface) {
  const background = luminance(surface);
  let channels = hexRgb(hex);
  for (let step = 0; step < 40; step++) {
    const color = rgbHex(channels), foreground = luminance(color);
    if ((Math.max(background, foreground) + .05) / (Math.min(background, foreground) + .05) >= 4.5) return color;
    channels = channels.map((value) => dark ? value + (255 - value) * .12 : value * .88);
  }
  return dark ? "#EDEDED" : "#17241C";
}
export function themeSurfaces(hex, dark) {
  const seed = hexRgb(hex);
  const tint = (gray, weight) => rgbHex(seed.map((channel) => gray * (1 - weight) + channel * weight));
  return dark ? {
    "--app-bg": tint(25, .025),
    "--content-bg": tint(25, .025),
    "--sidebar-bg": tint(28, .035),
    "--sidebar-surface": tint(48, .12),
    "--topbar-bg": tint(32, .03),
    "--panel-bg": tint(36, .03),
    "--panel-raised": tint(41, .04),
    "--control-bg": tint(48, .05),
    "--control-hover": tint(59, .08),
    "--control-selected": tint(48, .24),
    "--border": tint(88, .08),
    "--border-subtle": "rgba(237, 237, 237, .065)",
    "--text": "#EDEDED", "--text-muted": "#C6C6C6", "--text-disabled": "#8D8D8D",
    "--sidebar-text": "#EDEDED", "--sidebar-muted": "#C8C8C8",
  } : {
    "--app-bg": tint(219, .09),
    "--content-bg": tint(219, .09),
    "--sidebar-bg": tint(199, .15),
    "--sidebar-surface": tint(185, .27),
    "--topbar-bg": tint(214, .1),
    "--panel-bg": tint(229, .055),
    "--panel-raised": tint(216, .09),
    "--control-bg": tint(211, .12),
    "--control-hover": tint(199, .18),
    "--control-selected": tint(199, .28),
    "--border": tint(153, .22),
    "--border-subtle": "rgba(32, 33, 36, .08)",
    "--text": "#202124", "--text-muted": "#45484D", "--text-disabled": "#73767B",
    "--sidebar-text": "#24272C", "--sidebar-muted": "#3E444D",
  };
}
export function accentVariables(hex, dark) {
  if (!/^#[0-9a-f]{6}$/i.test(hex || "")) return undefined;
  const surfaces = themeSurfaces(hex, dark);
  const accent = readableAccent(hex, dark, surfaces["--control-bg"]);
  return {
    ...surfaces,
    "--accent": accent,
    "--accent-strong": accent,
    "--accent-soft": `color-mix(in srgb, ${accent} ${dark ? 20 : 22}%, var(--panel-bg))`,
    "--focus": accent,
    "--accent-foreground": luminance(accent) > .179 ? "#111111" : "#FFFFFF",
    "--accent-hover": `color-mix(in srgb, ${accent} 85%, ${dark ? "white" : "black"})`,
  };
}
