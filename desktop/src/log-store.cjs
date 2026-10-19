const fs = require("node:fs/promises");
const path = require("node:path");
const crypto = require("node:crypto");

const MAX_BYTES = 5 * 1024 * 1024;
const KEEP_ARCHIVES = 10;
const MAX_TOTAL_BYTES = 100 * 1024 * 1024;
const LOG_FILE = /^(?:app\.log|[a-zA-Z0-9_-]+\.jsonl)(?:\.[a-zA-Z0-9_-]+)?$/;
const ranks = { DEBUG: 10, INFO: 20, WARNING: 30, ERROR: 40, FATAL: 50 };
const filename = (value) => value == null ? null : String(value).replaceAll("\\", "/").split("/").pop();
function scrub(value) {
  if (Array.isArray(value)) return value.slice(0, 20).map(scrub);
  if (value && typeof value === "object") return Object.fromEntries(Object.entries(value).filter(([key]) => !["content", "markdown", "body", "config", "configSnapshot"].includes(key)).map(([key, item]) => [key, scrub(item)]));
  if (typeof value === "string") return value.replace(/(?:[a-z]:[\\/]|\\\\)[^\r\n"']+/gi, (match) => `<path:${filename(match)}>`).replace(/(?<![\w.])\/[^\s"']+/g, (match) => `<path:${filename(match)}>`).slice(0, 2000);
  return value;
}

function createLogStore(root, settings) {
  const jobs = path.join(root, "jobs");
  let nextCleanup = 0;
  let queue = Promise.resolve();
  async function files(directory) {
    try { const entries = await fs.readdir(directory, { withFileTypes: true }); return entries.filter((entry) => entry.isFile() && LOG_FILE.test(entry.name)).map((entry) => path.join(directory, entry.name)); }
    catch (error) { if (error.code === "ENOENT") return []; throw error; }
  }
  async function prepare() {
    await fs.mkdir(jobs, { recursive: true });
    if (Date.now() < nextCleanup) return;
    nextCleanup = Date.now() + 3600000;
    await enforceCapacity();
    if (!settings().autoCleanup) return;
    const cutoff = Date.now() - settings().retentionDays * 86400000;
    for (const target of [...await files(root), ...await files(jobs)]) {
      try { if ((await fs.stat(target)).mtimeMs < cutoff) await fs.unlink(target); } catch {}
    }
  }
  async function enforceCapacity(reserve = 0) {
    const entries = [];
    for (const file of [...await files(root), ...await files(jobs)]) {
      try { const stat = await fs.stat(file); entries.push({ file, time: stat.mtimeMs, size: stat.size }); } catch {}
    }
    let total = entries.reduce((sum, item) => sum + item.size, 0);
    entries.sort((a, b) => a.time - b.time);
    for (const item of entries) {
      if (total + reserve <= MAX_TOTAL_BYTES) break;
      try { await fs.unlink(item.file); total -= item.size; } catch {}
    }
    return total + reserve <= MAX_TOTAL_BYTES;
  }
  async function rotate(target, bytes) {
    const stat = await fs.stat(target).catch(() => ({ size: 0 }));
    if (!stat.size || stat.size + bytes <= MAX_BYTES) return;
    await fs.rename(target, `${target}.${Date.now()}-${crypto.randomUUID()}`);
    const base = path.basename(target);
    const archives = [];
    for (const file of await files(path.dirname(target))) {
      if (!path.basename(file).startsWith(`${base}.`)) continue;
      try { archives.push({ file, time: (await fs.stat(file)).mtimeMs }); } catch {}
    }
    archives.sort((a, b) => b.time - a.time);
    for (const item of archives.slice(KEEP_ARCHIVES)) await fs.unlink(item.file).catch(() => {});
  }
  function append(record) {
    const operation = queue.catch(() => {}).then(async () => {
      const config = settings();
      const level = String(record.level || "INFO").toUpperCase();
      if (!config.enabled || (ranks[level] || 20) < (ranks[config.level] || 20)) return;
      await prepare();
      const entry = scrub({ timestamp: new Date().toISOString(), ...record, level, file: filename(record.file) });
      const line = `${JSON.stringify(entry)}\n`;
      const targets = [path.join(root, "app.log")];
      if (/^[a-zA-Z0-9_-]{1,128}$/.test(record.jobId || "")) targets.push(path.join(jobs, `${record.jobId}.jsonl`));
      if (!await enforceCapacity(Buffer.byteLength(line) * targets.length)) return;
      for (const target of targets) { await rotate(target, Buffer.byteLength(line)); await fs.appendFile(target, line, "utf8"); }
    });
    queue = operation;
    return operation.catch(() => {});
  }
  async function read(limit = 200) {
    await queue.catch(() => {});
    const count = Math.min(2000, Math.max(1, Math.floor(Number(limit) || 200)));
    const records = [];
    const candidates = [];
    for (const file of [...await files(root), ...await files(jobs)]) {
      try { candidates.push({ file, time: (await fs.stat(file)).mtimeMs }); } catch {}
    }
    candidates.sort((a, b) => b.time - a.time);
    for (const { file } of candidates.slice(0, 30)) {
      try {
        for (const line of (await fs.readFile(file, "utf8")).split(/\r?\n/).slice(-count - 1)) {
          try { const item = JSON.parse(line); if (item && typeof item === "object" && !Array.isArray(item)) records.push(scrub({ ...item, file: filename(item.file) })); } catch {}
        }
      } catch {}
    }
    const seen = new Set();
    return records.sort((a, b) => Date.parse(a.timestamp) - Date.parse(b.timestamp)).filter((item) => {
      const key = JSON.stringify([item.timestamp, item.event, item.jobId, item.file, item.stage, item.message]);
      if (seen.has(key)) return false;
      seen.add(key); return true;
    }).slice(-count);
  }
  function clear() {
    const operation = queue.catch(() => {}).then(async () => {
      let removed = 0;
      for (const file of [...await files(root), ...await files(jobs)]) { await fs.unlink(file); removed += 1; }
      nextCleanup = 0;
      return removed;
    });
    queue = operation;
    return operation;
  }
  return { prepare, append, read, clear };
}

module.exports = { createLogStore };
