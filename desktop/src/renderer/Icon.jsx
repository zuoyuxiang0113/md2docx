import React from "react";

const iconGlyphs = { brand: "M", styles: "Aa", document: "▤", settings: "⚙", results: "☷", add: "+", remove: "×", folder: "▱", save: "↓", import: "↧", export: "↥", edit: "✎", reset: "↺", check: "✓", next: "›", refresh: "↻", warning: "!", file: "▤", collapse: "‹", expand: "›", back: "‹", config: "▤", environment: "◎", general: "◌", conversion: "⇄", logs: "≡", about: "i", package: "□" };

export default function Icon({ name }) {
  return <span className={`icon-glyph icon-${name}`} aria-hidden="true">{iconGlyphs[name]}</span>;
}
