const path = require("node:path");
const { spawn } = require("node:child_process");

function terminateProcessTree(child) {
  if (!child || child.exitCode !== null || !child.pid) return Promise.resolve(false);
  if (process.platform !== "win32") {
    child.kill("SIGTERM");
    return Promise.resolve(true);
  }
  return new Promise((resolve) => {
    const taskkill = path.join(process.env.SystemRoot || "C:\\Windows", "System32", "taskkill.exe");
    const killer = spawn(taskkill, ["/PID", String(child.pid), "/T", "/F"], { windowsHide: true });
    killer.on("error", () => {
      if (child.exitCode === null) child.kill();
      resolve(false);
    });
    killer.on("close", (code) => {
      if (code !== 0 && child.exitCode === null) child.kill();
      resolve(code === 0);
    });
  });
}

module.exports = { terminateProcessTree };
