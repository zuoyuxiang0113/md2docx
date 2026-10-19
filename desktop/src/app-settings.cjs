const defaults = require("./app-defaults.json");
const choice = (value, allowed, fallback) => allowed.includes(value) ? value : fallback;
function normalize(value = {}) {
  const general = { ...defaults.general, ...value.general };
  const conversion = { ...defaults.conversion, ...value.conversion };
  return {
    lastProfileId: /^[a-z0-9][a-z0-9_-]{0,63}$/.test(value.lastProfileId || "") ? value.lastProfileId : "default",
    general: {
      appearance: choice(general.appearance, ["system", "light", "dark"], "system"),
      accentColor: /^#[0-9a-f]{6}$/i.test(general.accentColor || "") ? general.accentColor.toUpperCase() : null,
      density: choice(general.density, ["compact", "comfortable"], "comfortable"),
      language: choice(general.language, ["zh", "en"], "zh"),
      startupTask: choice(general.startupTask, ["restore", "clear"], "restore"),
      startupWindowSize: choice(general.startupWindowSize, ["small", "medium", "large"], "medium"),
      serverPort: Number.isInteger(Number(general.serverPort)) && Number(general.serverPort) >= 1024 && Number(general.serverPort) <= 65535 ? Number(general.serverPort) : 5173,
      launchMaximized: general.launchMaximized === true,
      confirmClose: general.confirmClose !== false,
      confirmReset: general.confirmReset !== false,
      shortcutsEnabled: general.shortcutsEnabled !== false,
    },
    files: { dragDrop: value.files?.dragDrop !== false, recursive: value.files?.recursive === true },
    conversion: {
      onConflict: choice(conversion.onConflict, ["ask", "overwrite", "rename", "skip", "fail"], "ask"),
      batchErrors: choice(conversion.batchErrors, ["continue", "stop"], "continue"),
      preflight: conversion.preflight !== false,
      defaultOutputDirectory: typeof conversion.defaultOutputDirectory === "string" ? conversion.defaultOutputDirectory : "",
      afterSuccess: choice(value.conversion?.afterSuccess, ["none", "docx", "folder"], value.conversion?.openOutputDirectory ? "folder" : "none"),
      missingImages: choice(conversion.missingImages, ["warning", "stop"], "warning"),
    },
  };
}
module.exports = { defaults, normalize };
