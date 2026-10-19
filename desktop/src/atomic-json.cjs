const path = require("node:path");
const fs = require("node:fs/promises");
const crypto = require("node:crypto");

const queues = new Map();
const retryableErrors = new Set(["EPERM", "EACCES", "EBUSY", "EEXIST", "ENOTEMPTY"]);
const wait = (milliseconds) => new Promise((resolve) => setTimeout(resolve, milliseconds));

async function renameWithRetry(source, target, attempts = 6) {
  let lastError;
  for (let attempt = 0; attempt < attempts; attempt += 1) {
    try {
      await fs.rename(source, target);
      return;
    } catch (error) {
      lastError = error;
      if (!retryableErrors.has(error.code) || attempt === attempts - 1) throw error;
      await wait(25 * (attempt + 1));
    }
  }
  throw lastError;
}

async function atomicWriteJson(filePath, value) {
  const target = path.resolve(filePath);
  const previous = queues.get(target) || Promise.resolve();
  const operation = previous.catch(() => {}).then(async () => {
    await fs.mkdir(path.dirname(target), { recursive: true });
    const temporary = `${target}.${process.pid}.${Date.now()}.${crypto.randomUUID()}.tmp`;
    try {
      await fs.writeFile(temporary, `${JSON.stringify(value, null, 2)}\n`, { encoding: "utf8" });
      try {
        await renameWithRetry(temporary, target);
      } catch (error) {
        if (!retryableErrors.has(error.code)) throw error;
        const backup = `${target}.${process.pid}.${crypto.randomUUID()}.bak`;
        let backedUp = false;
        try {
          await renameWithRetry(target, backup);
          backedUp = true;
        } catch (backupError) {
          if (backupError.code !== "ENOENT") throw backupError;
        }
        try {
          await renameWithRetry(temporary, target);
          if (backedUp) await fs.rm(backup, { force: true });
        } catch (installError) {
          if (backedUp) await renameWithRetry(backup, target).catch(() => {});
          throw installError;
        }
      }
    } finally {
      await fs.rm(temporary, { force: true }).catch(() => {});
    }
  });
  queues.set(target, operation);
  try {
    await operation;
  } finally {
    if (queues.get(target) === operation) queues.delete(target);
  }
}

module.exports = { atomicWriteJson };
