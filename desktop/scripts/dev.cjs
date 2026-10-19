const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { spawn } = require("node:child_process");

const desktopRoot = path.resolve(__dirname, "..");
const appDataRoot = process.env.APPDATA || path.join(os.homedir(), ".config");
const settingsPath = path.join(appDataRoot, "md2docx", "app-settings.json");

function readPort() {
  const environmentPort = Number(process.env.MD2DOCX_PORT);
  if (Number.isInteger(environmentPort) && environmentPort >= 1024 && environmentPort <= 65535) return environmentPort;
  try {
    const settings = JSON.parse(fs.readFileSync(settingsPath, "utf8"));
    const configured = Number(settings?.general?.serverPort);
    if (Number.isInteger(configured) && configured >= 1024 && configured <= 65535) return configured;
  } catch {}
  return 5173;
}

async function main() {
  const port = readPort();
  const host = "127.0.0.1";
  const { createServer } = await import("vite");
  const server = await createServer({
    root: desktopRoot,
    configFile: path.join(desktopRoot, "vite.config.mjs"),
    server: { host, port, strictPort: true },
  });
  await server.listen();
  server.printUrls();

  const electronPath = require("electron");
  const electron = spawn(electronPath, [desktopRoot], {
    cwd: desktopRoot,
    env: { ...process.env, ELECTRON_START_URL: `http://${host}:${port}` },
    stdio: "inherit",
    windowsHide: false,
  });

  let stopping = false;
  async function stop(code = 0) {
    if (stopping) return;
    stopping = true;
    if (electron.exitCode === null && !electron.killed) electron.kill();
    await server.close();
    process.exitCode = code;
  }

  electron.on("exit", (code) => stop(code || 0));
  electron.on("error", async (error) => { console.error(error); await stop(1); });
  process.on("SIGINT", () => stop(0));
  process.on("SIGTERM", () => stop(0));
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
