const { app, BrowserWindow, dialog, ipcMain, Menu, nativeTheme, shell } = require("electron");
const path = require("node:path");
const fs = require("node:fs/promises");
const { existsSync, readFileSync } = require("node:fs");
const crypto = require("node:crypto");
const { spawn } = require("node:child_process");
const { createLogStore } = require("./log-store.cjs");
const { defaults: appDefaults, normalize: normalizeAppSettings } = require("./app-settings.cjs");
const { atomicWriteJson } = require("./atomic-json.cjs");
const { terminateProcessTree } = require("./process-tree.cjs");

const appDataRoot = app.getPath("appData");
const legacyUserDataRoot = path.join(appDataRoot, "md2docx-desktop-demo");
const userDataRoot = path.join(appDataRoot, "md2docx");
app.setName("MD2DOCX");
app.setPath("userData", userDataRoot);

const projectRoot = path.resolve(__dirname, "..", "..");
const cliScript = path.join(projectRoot, "cli", "md2docx_cli.py");
const runtimeRoot = path.join(app.isPackaged ? process.resourcesPath : projectRoot, "runtime");
const logRoot = process.env.MD2DOCX_LOG_DIR ? path.resolve(process.env.MD2DOCX_LOG_DIR) : path.join(app.getPath("userData"), app.isPackaged ? "logs" : "logs-dev");
const PROFILE_ID = /^[a-z0-9][a-z0-9_-]{0,63}$/;
const defaultConfigPath = app.isPackaged ? path.join(process.resourcesPath, "core", "defaults.json") : path.join(projectRoot, "core", "defaults.json");
const DEFAULT_PROJECT = JSON.parse(readFileSync(defaultConfigPath, "utf8"));

let mainWindow;
function titlebarPalette(appearance = appSettings.general.appearance) {
  const dark = appearance === "dark" || (appearance === "system" && nativeTheme.shouldUseDarkColors);
  const accent = appSettings.general.accentColor;
  return { color: "#00000000", symbolColor: dark ? "#ededed" : accent ? "#202124" : "#17241c", height: 38 };
}
function syncTitlebar(appearance = appSettings.general.appearance) {
  if (!mainWindow || mainWindow.isDestroyed() || process.platform !== "win32") return false;
  mainWindow.setTitleBarOverlay(titlebarPalette(appearance));
  return true;
}
let allowWindowClose = false;
let closeRequestPending = false;
const pendingConfirmations = new Map();
let activeConversion = null;
let currentLanguage = "zh";
let logSettings = { enabled: true, level: "INFO", autoCleanup: true, retentionDays: 7 };
const logStore = createLogStore(logRoot, () => logSettings);
let appSettings = normalizeAppSettings(appDefaults);
let persistedAppSettings = normalizeAppSettings(appDefaults);
let runtimeStatusCache = null;
let runtimeStatusPromise = null;
const clone = (value) => JSON.parse(JSON.stringify(value));
const safeName = (value) => { if (!value) return null; const text = String(value).replaceAll("\\", "/"); return text.split("/").pop() || null; };
async function migrateLegacyUserData() {
  if (path.resolve(legacyUserDataRoot) === path.resolve(userDataRoot) || !existsSync(legacyUserDataRoot)) return false;
  await fs.mkdir(userDataRoot, { recursive: true });
  const entries = ["app-settings.json", "profiles", "profile-backups", "workspace", "logs", "logs-dev"];
  for (const entry of entries) {
    const source = path.join(legacyUserDataRoot, entry);
    if (!existsSync(source)) continue;
    await fs.cp(source, path.join(userDataRoot, entry), { recursive: true, force: false, errorOnExist: false });
  }
  await fs.rm(legacyUserDataRoot, { recursive: true, force: true });
  return true;
}
function appSettingsPath() { return path.join(app.getPath("userData"), "app-settings.json"); }
function appSettingsDraftPath() { return path.join(workspaceDir(), "app-settings.editing.json"); }
function defaultOutputDirectory() { return path.join(app.getPath("documents"), "MD2DOCX"); }
function normalizeLogSettings(value = {}) { const level = ["INFO", "DEBUG"].includes(String(value.level || "").toUpperCase()) ? String(value.level).toUpperCase() : "INFO"; const retentionDays = Math.min(3650, Math.max(1, Number.isFinite(Number(value.retentionDays)) ? Math.round(Number(value.retentionDays)) : 7)); return { enabled: value.enabled !== false, level, autoCleanup: value.autoCleanup !== false, retentionDays, displayLimit: [200, 500, 1000].includes(Number(value.displayLimit)) ? Number(value.displayLimit) : 200 }; }
function normalizeSettingsSnapshot(value = {}) { const normalized = normalizeAppSettings(value); if (!normalized.conversion.defaultOutputDirectory) normalized.conversion.defaultOutputDirectory = defaultOutputDirectory(); return { ...normalized, logs: normalizeLogSettings(value.logs || {}) }; }
async function loadAppSettings() {
  let persistDefaults = false;
  try {
    const parsed = JSON.parse(await fs.readFile(appSettingsPath(), "utf8"));
    const normalized = normalizeSettingsSnapshot(parsed);
    persistedAppSettings = normalizeAppSettings(normalized);
    appSettings = normalizeAppSettings(normalized);
    logSettings = normalized.logs;
    persistDefaults = !parsed.conversion?.defaultOutputDirectory || !parsed.general?.startupWindowSize || !parsed.general?.serverPort;
  } catch {
    const normalized = normalizeSettingsSnapshot({ ...appSettings, logs: logSettings });
    persistedAppSettings = normalizeAppSettings(normalized);
    appSettings = normalizeAppSettings(normalized);
    logSettings = normalized.logs;
    persistDefaults = true;
  }
  await fs.mkdir(appSettings.conversion.defaultOutputDirectory, { recursive: true }).catch(() => {});
  if (persistDefaults) await atomicWriteJson(appSettingsPath(), { ...appSettings, logs: logSettings });
  return { ...appSettings, logs: logSettings };
}
async function writeAppSettingsDraft(settings, dirty) { const draft = { dirty: dirty === true, updatedAt: new Date().toISOString(), settings: normalizeSettingsSnapshot(settings) }; await atomicWriteJson(appSettingsDraftPath(), draft); return draft; }
async function prepareAppSettingsDraft() { return writeAppSettingsDraft({ ...persistedAppSettings, logs: logSettings }, false); }
async function saveAppSettings(next = {}) {
  const persisted = normalizeSettingsSnapshot({ ...persistedAppSettings, ...next, general: { ...persistedAppSettings.general, ...(next.general || {}) }, conversion: { ...persistedAppSettings.conversion, ...(next.conversion || {}) }, files: { ...persistedAppSettings.files, ...(next.files || {}) }, logs: { ...logSettings, ...(next.logs || {}) } });
  const working = normalizeSettingsSnapshot({ ...appSettings, ...next, general: { ...appSettings.general, ...(next.general || {}) }, conversion: { ...appSettings.conversion, ...(next.conversion || {}) }, files: { ...appSettings.files, ...(next.files || {}) }, logs: { ...logSettings, ...(next.logs || {}) } });
  persistedAppSettings = normalizeAppSettings(persisted);
  appSettings = normalizeAppSettings(working);
  logSettings = working.logs;
  if (next.general && ("appearance" in next.general || "accentColor" in next.general)) syncTitlebar();
  await atomicWriteJson(appSettingsPath(), { ...persistedAppSettings, logs: persisted.logs });
  const draft = await loadAppSettingsDraft().catch(() => null);
  if (draft) await writeAppSettingsDraft({ ...working, lastProfileId: persistedAppSettings.lastProfileId }, draft.dirty);
  return { ...appSettings, logs: logSettings };
}
async function loadAppSettingsDraft() { try { const draft = JSON.parse(await fs.readFile(appSettingsDraftPath(), "utf8")); if (!draft || typeof draft.dirty !== "boolean" || !draft.settings) throw new Error("设置工作副本格式无效。"); return { dirty: draft.dirty, updatedAt: draft.updatedAt || null, settings: normalizeSettingsSnapshot(draft.settings) }; } catch (error) { if (error.code === "ENOENT") return null; throw error; } }
async function saveAppSettingsDraft(next = {}) { const base = { ...appSettings, logs: logSettings }; const settings = normalizeSettingsSnapshot({ ...base, ...next, general: { ...base.general, ...(next.general || {}) }, conversion: { ...base.conversion, ...(next.conversion || {}) }, files: { ...base.files, ...(next.files || {}) }, logs: { ...base.logs, ...(next.logs || {}) } }); appSettings = normalizeAppSettings(settings); logSettings = settings.logs; if (next.general && ("appearance" in next.general || "accentColor" in next.general)) syncTitlebar(); return writeAppSettingsDraft({ ...settings, lastProfileId: persistedAppSettings.lastProfileId }, true); }
async function commitAppSettingsDraft(next = null) { const draft = next ? { settings: normalizeSettingsSnapshot(next) } : await loadAppSettingsDraft(); const settings = normalizeSettingsSnapshot({ ...(draft?.settings || appSettings), lastProfileId: persistedAppSettings.lastProfileId }); persistedAppSettings = normalizeAppSettings(settings); appSettings = normalizeAppSettings(settings); logSettings = settings.logs; await atomicWriteJson(appSettingsPath(), { ...persistedAppSettings, logs: logSettings }); await writeAppSettingsDraft({ ...appSettings, logs: logSettings }, false); return { ...appSettings, logs: logSettings }; }
async function discardAppSettingsDraft() { appSettings = normalizeAppSettings(persistedAppSettings); const formal = JSON.parse(await fs.readFile(appSettingsPath(), "utf8")); logSettings = normalizeLogSettings(formal.logs || {}); await writeAppSettingsDraft({ ...appSettings, logs: logSettings }, false); syncTitlebar(); return { ...appSettings, logs: logSettings }; }
async function ensureLogDirs() { return logStore.prepare(); }
async function appendLog(record) { return logStore.append(record); }
async function readLogs(limit = 200) { return logStore.read(limit); }
async function clearLogs() { return logStore.clear(); }
async function exportDiagnostics(payload = {}) { await ensureLogDirs(); const records = await readLogs(500); const runtime = await getRuntimeStatus(); const runtimeSummary = Object.fromEntries(["python", "pandoc", "pythonDocx", "lxml"].map((name) => [name, { available: Boolean(runtime[name]?.available), version: runtime[name]?.version || null, path: safeName(runtime[name]?.path) }])); const failedFiles = (payload.results || []).filter((item) => !item.ok && !item.skipped).map((item) => ({ name: safeName(item.source), code: item.errorObject?.code || "CONVERSION_FAILED", stage: item.errorObject?.stage || null })); const report = { appVersion: app.getVersion(), platform: `${process.platform}-${process.arch}`, nodeVersion: process.versions.node, runtime: runtimeSummary, configId: payload.config?.id || null, schemaVersion: payload.config?.schemaVersion || null, fileCount: Array.isArray(payload.files) ? payload.files.length : 0, jobIds: [...new Set((payload.results || []).map((item) => item.jobId).filter(Boolean))], settings: { general: appSettings.general, conversion: { onConflict: appSettings.conversion.onConflict, batchErrors: appSettings.conversion.batchErrors, preflight: appSettings.conversion.preflight, afterSuccess: appSettings.conversion.afterSuccess, missingImages: appSettings.conversion.missingImages }, logs: logSettings }, errorCount: failedFiles.length, failedFiles, logs: records }; const result = await dialog.showSaveDialog(mainWindow, { title: "导出诊断报告", defaultPath: "md2docx-diagnostics.json", filters: [{ name: "JSON", extensions: ["json"] }] }); if (result.canceled) return null; await atomicWriteJson(result.filePath, report); return result.filePath; }
function mergeProject(value = {}) {
  if (!value || typeof value !== "object" || Array.isArray(value) || value.schemaVersion !== 2) throw new Error("配置必须使用 schemaVersion 2。");
  const merge = (base, extra) => Object.fromEntries(Object.keys({ ...base, ...extra }).map((key) => [key, extra[key] && typeof extra[key] === "object" && !Array.isArray(extra[key]) ? merge(base[key] || {}, extra[key]) : extra[key] ?? base[key]]));
  const project = merge(clone(DEFAULT_PROJECT), value);
  project.id = String(project.id || "default"); project.files = Array.isArray(project.files) ? project.files : []; project.updatedAt = project.updatedAt || new Date().toISOString();
  delete project.name;
  delete project.elements;
  for (const key of ["headerFooter", "toc", "sections", "lists", "notes", "references"]) delete project[key];
  for (const key of ["imagePolicy", "mermaid", "preview"]) delete project.options[key];
  return project;
}
function profilesDir() { return path.join(app.getPath("userData"), "profiles"); }
function profilePath(id) { if (!PROFILE_ID.test(id)) throw new Error("配置 ID 只能包含小写字母、数字、下划线和短横线。"); return path.join(profilesDir(), `${id}.json`); }
function profileIdFromPath(filePath) { return path.basename(filePath, path.extname(filePath)); }
function workspaceDir() { return path.join(app.getPath("userData"), "workspace"); }
function editingPath(id) { if (!PROFILE_ID.test(id)) throw new Error("配置 ID 无效。"); return path.join(workspaceDir(), `${id}.editing.json`); }
function backupsDir() { return path.join(app.getPath("userData"), "profile-backups"); }
async function pruneProfileBackups(id, kind) {
  const keep = kind === "damaged" ? 3 : 10;
  const entries = (await fs.readdir(backupsDir(), { withFileTypes: true })).filter((entry) => entry.isFile() && entry.name.startsWith(`${id}.`) && entry.name.endsWith(`.${kind}.json`));
  const dated = await Promise.all(entries.map(async (entry) => ({ name: entry.name, modified: (await fs.stat(path.join(backupsDir(), entry.name))).mtimeMs })));
  dated.sort((left, right) => right.modified - left.modified);
  await Promise.all(dated.slice(keep).map((entry) => fs.rm(path.join(backupsDir(), entry.name), { force: true })));
}
async function backupProfile(id, kind = "saved") {
  const source = profilePath(id);
  try { await fs.access(source); } catch (error) { if (error.code === "ENOENT") return null; throw error; }
  await fs.mkdir(backupsDir(), { recursive: true });
  const digest = crypto.createHash("sha256").update(await fs.readFile(source)).digest("hex").slice(0, 16);
  const existing = await fs.readdir(backupsDir());
  if (existing.some((name) => name.startsWith(`${id}.`) && name.endsWith(`.${digest}.${kind}.json`))) { await pruneProfileBackups(id, kind); return null; }
  const target = path.join(backupsDir(), `${id}.${Date.now()}.${digest}.${kind}.json`);
  await fs.copyFile(source, target);
  await pruneProfileBackups(id, kind);
  return target;
}
async function listProfileBackups() {
  await fs.mkdir(backupsDir(), { recursive: true }); const items = [];
  for (const entry of await fs.readdir(backupsDir(), { withFileTypes: true })) {
    if (!entry.isFile() || !entry.name.endsWith(".json")) continue;
    const file = path.join(backupsDir(), entry.name);
    try { const config = mergeProject(JSON.parse(await fs.readFile(file, "utf8"))); items.push({ file: entry.name, id: config.id, updatedAt: (await fs.stat(file)).mtime.toISOString(), valid: true }); }
    catch { items.push({ file: entry.name, id: entry.name.split(".")[0], valid: false }); }
  }
  return items.sort((a, b) => String(b.updatedAt || "").localeCompare(String(a.updatedAt || "")));
}
async function collectMarkdown(inputs, recursive = appSettings.files.recursive) {
  if (!Array.isArray(inputs) || inputs.some((item) => typeof item !== "string")) throw new Error("文件列表格式无效。");
  const found = new Map();
  async function visit(target) {
    const full = path.resolve(target); const stat = await fs.lstat(full);
    if (stat.isSymbolicLink()) return;
    if (stat.isFile()) { if (/\.(md|markdown)$/i.test(full)) found.set(full.toLowerCase(), full); return; }
    if (!stat.isDirectory()) return;
    for (const entry of await fs.readdir(full, { withFileTypes: true })) if (entry.isFile() || (recursive && entry.isDirectory())) await visit(path.join(full, entry.name));
  }
  for (const input of inputs) await visit(input);
  return [...found.values()].sort((a, b) => a.localeCompare(b));
}
async function cleanupStaleAtomicFiles() {
  const roots = [app.getPath("userData"), profilesDir(), workspaceDir()];
  for (const root of roots) {
    let entries = [];
    try { entries = await fs.readdir(root, { withFileTypes: true }); } catch { continue; }
    for (const entry of entries) {
      if (!entry.isFile() || !/\.json\.\d+\..*\.tmp$/.test(entry.name)) continue;
      await fs.rm(path.join(root, entry.name), { force: true }).catch(() => {});
    }
  }
}
async function readBundledDefault() {
  return mergeProject(clone(DEFAULT_PROJECT));
}
async function ensureProfiles() {
  await fs.mkdir(profilesDir(), { recursive: true });
  await fs.mkdir(workspaceDir(), { recursive: true });
  const target = profilePath("default");
  try {
    const profile = await readProfile(target);
    const raw = JSON.parse(await fs.readFile(target, "utf8"));
    if (profileNeedsCleanup(raw)) await writeProfile(target, profile);
  }
  catch (error) { if (error.code !== "ENOENT") await backupProfile("default", "damaged"); await writeProfile(target, { ...(await readBundledDefault()), id: "default" }); }
}
function profileNeedsCleanup(raw) {
  if (!raw || typeof raw !== "object") return false;
  if (["name", "elements", "files", "outputDirectory", "headerFooter", "toc", "sections", "lists", "notes", "references"].some((key) => Object.prototype.hasOwnProperty.call(raw, key))) return true;
  return ["imagePolicy", "mermaid", "preview"].some((key) => Object.prototype.hasOwnProperty.call(raw.options || {}, key));
}
async function readProfile(filePath) { const expectedId = profileIdFromPath(filePath); if (!PROFILE_ID.test(expectedId)) throw new Error("配置文件名不是有效配置 ID。"); const raw = await fs.readFile(filePath, "utf8"); const project = mergeProject(JSON.parse(raw)); if (project.id !== expectedId) throw new Error(`配置 ID 与文件名不一致：应为 ${expectedId}。`); return { ...project, id: expectedId, projectPath: filePath }; }
async function writeProfile(filePath, value) { const expectedId = profileIdFromPath(filePath); if (!PROFILE_ID.test(expectedId)) throw new Error("配置文件名不是有效配置 ID。"); const normalized = mergeProject({ ...value, id: expectedId }); const runtimeState = { files: normalized.files || [], outputDirectory: normalized.outputDirectory || "" }; delete normalized.files; delete normalized.outputDirectory; delete normalized.projectPath; normalized.id = expectedId; normalized.updatedAt = new Date().toISOString(); if (path.dirname(path.resolve(filePath)) === path.resolve(profilesDir())) await backupProfile(expectedId); await atomicWriteJson(filePath, normalized); return { ...normalized, ...runtimeState, projectPath: filePath }; }
async function readEditingDraft(id) { try { const raw = await fs.readFile(editingPath(id), "utf8"); const value = JSON.parse(raw); if (!value || typeof value !== "object" || value.id !== id || !value.config) throw new Error("编辑副本格式无效。"); return value; } catch (error) { if (error.code === "ENOENT") return null; throw error; } }
async function writeEditingDraft(id, value) {
  const project = mergeProject({ ...(value?.config || value || {}), id });
  delete project.files;
  delete project.outputDirectory;
  delete project.projectPath;
  const draft = { id, dirty: value?.dirty === true, updatedAt: new Date().toISOString(), config: project, files: Array.isArray(value?.files) ? value.files : [], outputDirectory: typeof value?.outputDirectory === "string" ? value.outputDirectory : "" };
  await atomicWriteJson(editingPath(id), draft);
  return draft;
}
async function deleteEditingDraft(id) { await fs.rm(editingPath(id), { force: true }); return true; }
async function listEditingDrafts() { await fs.mkdir(workspaceDir(), { recursive: true }); const entries = await fs.readdir(workspaceDir(), { withFileTypes: true }); const drafts = []; for (const entry of entries.filter((item) => item.isFile() && item.name.endsWith(".editing.json"))) { const id = entry.name.slice(0, -".editing.json".length); try { const draft = await readEditingDraft(id); if (draft) drafts.push({ id, dirty: draft.dirty === true, updatedAt: draft.updatedAt }); } catch (error) { drafts.push({ id, error: error.message }); } } return drafts; }
async function prepareEditingDraft(id, refreshClean = false) {
  const existing = await readEditingDraft(id).catch(() => null);
  if (existing && (!refreshClean || existing.dirty)) return existing;
  const profile = await readProfile(profilePath(id));
  return writeEditingDraft(id, { config: profile, files: existing?.files || [], outputDirectory: existing?.outputDirectory || "", dirty: false });
}
async function listProfiles() { await ensureProfiles(); const entries = await fs.readdir(profilesDir(), { withFileTypes: true }); const profiles = []; for (const entry of entries.filter((item) => item.isFile() && item.name.endsWith(".json"))) { const id = profileIdFromPath(entry.name); const filePath = path.join(profilesDir(), entry.name); try { const profile = await readProfile(filePath); const raw = JSON.parse(await fs.readFile(filePath, "utf8")); if (profileNeedsCleanup(raw)) await writeProfile(filePath, profile); profiles.push({ id, updatedAt: profile.updatedAt, valid: true }); } catch (error) { await backupProfile(id, "damaged").catch(() => {}); profiles.push({ id, updatedAt: null, valid: false, error: error.message }); } } return profiles.sort((a, b) => a.id.localeCompare(b.id, "zh-CN")); }

function menuLabels() { return currentLanguage === "zh" ? { addFiles: "添加 Markdown 文件…", output: "选择输出目录…", profiles: "管理配置", save: "保存当前更改", convert: "开始转换", quit: "退出", undo: "撤销", redo: "重做", cut: "剪切", copy: "复制", paste: "粘贴", selectAll: "全选", document: "文档", styles: "配置", results: "结果", settings: "设置", reload: "重新加载", runtime: "运行环境", logs: "日志与诊断", diagnostics: "导出诊断报告", about: "关于", chinese: "中文", english: "English" } : { addFiles: "Add Markdown files…", output: "Choose output folder…", profiles: "Manage profiles", save: "Save current changes", convert: "Start conversion", quit: "Quit", undo: "Undo", redo: "Redo", cut: "Cut", copy: "Copy", paste: "Paste", selectAll: "Select all", document: "Document", styles: "Configuration", results: "Results", settings: "Settings", reload: "Reload", runtime: "Runtime", logs: "Logs & diagnostics", diagnostics: "Export diagnostics", about: "About", chinese: "中文", english: "English" }; }
function sendMenuAction(action) { if (mainWindow && !mainWindow.isDestroyed()) mainWindow.webContents.send("app-menu-action", action); }
function popupAppMenu(section, position = {}) {
  if (!mainWindow || mainWindow.isDestroyed()) return; const label = menuLabels();
  const templates = {
    file: [{ label: label.addFiles, accelerator: "CmdOrCtrl+O", click: () => sendMenuAction("add-files") }, { label: label.output, click: () => sendMenuAction("choose-output") }, { type: "separator" }, { label: label.profiles, click: () => sendMenuAction("manage-profiles") }, { label: label.save, accelerator: "CmdOrCtrl+S", click: () => sendMenuAction("save-current") }, { type: "separator" }, { label: label.convert, accelerator: "CmdOrCtrl+Enter", click: () => sendMenuAction("convert") }, { type: "separator" }, { label: label.quit, role: "quit" }],
    edit: [{ role: "undo", label: label.undo }, { role: "redo", label: label.redo }, { type: "separator" }, { role: "cut", label: label.cut }, { role: "copy", label: label.copy }, { role: "paste", label: label.paste }, { role: "selectAll", label: label.selectAll }],
    view: [{ label: label.document, click: () => sendMenuAction("page-document") }, { label: label.styles, click: () => sendMenuAction("page-styles") }, { label: label.results, click: () => sendMenuAction("page-results") }, { label: label.settings, click: () => sendMenuAction("page-settings") }, { type: "separator" }, { label: label.reload, role: "reload" }],
    help: [{ label: label.runtime, click: () => sendMenuAction("settings-runtime") }, { label: label.logs, click: () => sendMenuAction("settings-logs") }, { label: label.diagnostics, click: () => sendMenuAction("export-diagnostics") }, { type: "separator" }, { label: label.about, click: () => sendMenuAction("settings-about") }, { type: "separator" }, { label: label.chinese, type: "radio", checked: currentLanguage === "zh", click: () => setLanguage("zh") }, { label: label.english, type: "radio", checked: currentLanguage === "en", click: () => setLanguage("en") }],
  };
  Menu.buildFromTemplate(templates[section] || []).popup({ window: mainWindow, x: Math.round(position.x || 0), y: Math.round(position.y || 38) });
}
function buildApplicationMenu(language = currentLanguage) { currentLanguage = language === "en" ? "en" : "zh"; Menu.setApplicationMenu(null); if (mainWindow && !mainWindow.isDestroyed()) mainWindow.setTitle(currentLanguage === "zh" ? "Markdown 转 DOCX" : "Markdown to DOCX"); }
function setLanguage(language, notifyRenderer = true) { currentLanguage = language === "en" ? "en" : "zh"; buildApplicationMenu(currentLanguage); if (notifyRenderer && mainWindow && !mainWindow.isDestroyed()) mainWindow.webContents.send("language-changed", currentLanguage); }
function createWindow({ bounds, maximized = false } = {}) { const startupSize = { small: { width: 900, height: 620 }, medium: { width: 1000, height: 700 }, large: { width: 1200, height: 820 } }[appSettings.general.startupWindowSize] || { width: 1000, height: 700 }; const options = { width: bounds?.width || startupSize.width, height: bounds?.height || startupSize.height, minWidth: 900, minHeight: 620, show: false, backgroundColor: "#f5f7fb", webPreferences: { contextIsolation: true, nodeIntegration: false, sandbox: true, preload: path.join(__dirname, "preload.cjs") } }; if (bounds) { options.x = bounds.x; options.y = bounds.y; } if (process.platform === "win32") { options.titleBarStyle = "hidden"; options.titleBarOverlay = titlebarPalette(); } const window = new BrowserWindow(options); mainWindow = window; currentLanguage = appSettings.general.language; buildApplicationMenu(currentLanguage); window.setMenuBarVisibility(false); window.webContents.setWindowOpenHandler(() => ({ action: "deny" })); window.webContents.on("will-navigate", (event, url) => { const current = window.webContents.getURL(); if (current && url !== current) event.preventDefault(); }); const startUrl = process.env.ELECTRON_START_URL; if (startUrl) window.loadURL(startUrl); else window.loadFile(path.join(__dirname, "..", "dist", "index.html")); window.once("ready-to-show", () => { if (window.isDestroyed()) return; if (appSettings.general.launchMaximized || maximized) window.maximize(); syncTitlebar(); window.show(); window.focus(); allowWindowClose = false; closeRequestPending = false; }); window.on("close", (event) => { if (allowWindowClose) return; event.preventDefault(); if (closeRequestPending) return; closeRequestPending = true; window.webContents.send("request-close"); }); window.on("closed", () => { if (mainWindow === window) mainWindow = null; });
  window.webContents.on("did-fail-load", (_event, errorCode, errorDescription, validatedURL) => { appendLog({ level: "ERROR", component: "electron", event: "renderer_load_failed", stage: "renderer", code: String(errorCode), message: errorDescription, details: { url: validatedURL } }).catch(() => {}); });
  window.webContents.on("render-process-gone", (_event, details) => { appendLog({ level: "ERROR", component: "electron", event: "renderer_process_gone", stage: "renderer", code: details.reason || "unknown", message: "渲染进程已退出", details: { exitCode: details.exitCode } }).catch(() => {}); });
  window.webContents.on("console-message", (_event, level, message, line, sourceId) => { if (level >= 2) appendLog({ level: "ERROR", component: "renderer", event: "console_error", stage: "renderer", code: "CONSOLE_ERROR", message: String(message).slice(0, 1000), details: { line, source: sourceId } }).catch(() => {}); });
  window.webContents.on("before-input-event", (event, input) => {
    if (!appSettings.general.shortcutsEnabled || input.type !== "keyDown" || !(input.control || input.meta) || input.alt || input.shift || input.isAutoRepeat) return;
    const action = { o: "add-files", s: "save-current", enter: "convert" }[String(input.key).toLowerCase()];
    if (action) { event.preventDefault(); sendMenuAction(action); }
  });
  return window; }

function executableCandidates(envName, bundledPath, names) { return [process.env[envName], bundledPath, ...names].filter(Boolean); }
function probeExecutable(candidates, args) { return new Promise((resolve) => { const attempt = (index, lastError = "") => { if (index >= candidates.length) return resolve({ available: false, error: lastError }); const executable = candidates[index]; const child = spawn(executable, args, { windowsHide: true, cwd: projectRoot }); let stdout = ""; let stderr = ""; child.stdout?.setEncoding("utf8"); child.stderr?.setEncoding("utf8"); child.stdout?.on("data", (chunk) => { stdout += chunk; }); child.stderr?.on("data", (chunk) => { stderr += chunk; }); child.on("error", (error) => attempt(index + 1, error.message)); child.on("close", (code) => code === 0 ? resolve({ available: true, path: executable, version: (stdout || stderr).trim().split(/\r?\n/)[0] }) : attempt(index + 1, stderr || `退出码 ${code}`)); }; attempt(0); }); }
async function probePythonModule(python, moduleName, distributionName = moduleName) { if (!python?.available) return { available: false, path: null, version: null, error: "Python 不可用" }; return new Promise((resolve) => { const child = spawn(python.path, ["-c", `import importlib.metadata, importlib.util; module=${JSON.stringify(moduleName)}; distribution=${JSON.stringify(distributionName)}; spec=importlib.util.find_spec(module); print(importlib.metadata.version(distribution) if spec else "")`], { windowsHide: true, cwd: projectRoot }); let stdout = ""; let stderr = ""; child.stdout.setEncoding("utf8"); child.stderr.setEncoding("utf8"); child.stdout.on("data", (chunk) => { stdout += chunk; }); child.stderr.on("data", (chunk) => { stderr += chunk; }); child.on("error", (error) => resolve({ available: false, path: null, version: null, error: error.message })); child.on("close", (code) => { const version = stdout.trim(); resolve({ available: code === 0 && Boolean(version), path: python.path, version: version || null, error: code === 0 ? null : (stderr.trim() || `退出码 ${code}`) }); }); }); }
function bundledCliPath() { const candidates = app.isPackaged ? [path.join(process.resourcesPath, "cli", "md2docx.exe")] : [path.join(projectRoot, "release", "cli", "md2docx", "md2docx.exe")]; return candidates.find((candidate) => existsSync(candidate)) || null; }
async function probeRuntimeStatus() {
  const cli = bundledCliPath();
  if (cli) {
    const response = await invokeCli(cli, ["doctor", "--json"], { MD2DOCX_LOG_DIR: logRoot, MD2DOCX_LOG_ENABLED: logSettings.enabled ? "1" : "0", MD2DOCX_LOG_AUTO_CLEANUP: logSettings.autoCleanup ? "1" : "0", MD2DOCX_LOG_RETENTION_DAYS: String(logSettings.retentionDays), MD2DOCX_LOG_LEVEL: logSettings.level });
    if (!response.payload?.checks) throw Object.assign(new Error("内置转换器未返回有效的环境检测结果。"), { code: "CLI_RESPONSE_INVALID" });
    return { ...response.payload.checks, ready: response.payload.success === true && response.code === 0, cli: { available: true, path: cli, version: response.payload.version } };
  }
  if (app.isPackaged) throw Object.assign(new Error("找不到应用内置转换器，请重新安装应用。"), { code: "CLI_NOT_FOUND" });
  const python = await probeExecutable(executableCandidates("MD2DOCX_PYTHON", path.join(runtimeRoot, "python", "python.exe"), ["py.exe", "python.exe"]), ["--version"]);
  const pandoc = await probeExecutable(executableCandidates("MD2DOCX_PANDOC", path.join(runtimeRoot, "pandoc", "pandoc.exe"), ["pandoc.exe"]), ["--version"]);
  const pythonDocx = await probePythonModule(python, "docx", "python-docx");
  const lxml = await probePythonModule(python, "lxml");
  return { python, pandoc, pythonDocx, lxml, ready: python.available && pandoc.available && pythonDocx.available && lxml.available };
}
async function getRuntimeStatus(force = false) {
  if (!force && runtimeStatusCache) return runtimeStatusCache;
  if (!force && runtimeStatusPromise) return runtimeStatusPromise;
  runtimeStatusPromise = probeRuntimeStatus().then((status) => {
    runtimeStatusCache = status;
    return status;
  }).finally(() => { runtimeStatusPromise = null; });
  return runtimeStatusPromise;
}
async function invokeCli(executable, args, env = {}, onProgress = null, control = null) { return new Promise((resolve, reject) => { const bundled = bundledCliPath(); const child = spawn(executable, executable === bundled ? args : [cliScript, ...args], { windowsHide: true, cwd: app.isPackaged ? app.getPath("temp") : projectRoot, env: { ...process.env, ...env, PYTHONIOENCODING: "utf-8" } }); if (control) { control.child = child; if (control.cancelRequested) control.terminationPromise = terminateProcessTree(child); } let stdout = ""; let stderr = ""; let progressBuffer = ""; child.stdout.setEncoding("utf8"); child.stderr.setEncoding("utf8"); child.stdout.on("data", (chunk) => { stdout += chunk; }); child.stderr.on("data", (chunk) => { stderr += chunk; progressBuffer += chunk; const lines = progressBuffer.split(/\r?\n/); progressBuffer = lines.pop() || ""; for (const line of lines) { try { const event = JSON.parse(line); if (event && event.event && onProgress) onProgress(event); } catch {} } }); child.on("error", (error) => { if (control?.cancelRequested) resolve({ code: 9, payload: null, stdout, stderr, cancelled: true }); else reject(error); }); child.on("close", (code) => { let payload = null; try { payload = JSON.parse(stdout); } catch {} resolve({ code, payload, stdout, stderr, cancelled: Boolean(control?.cancelRequested) }); }); }); }
async function nextAvailableOutput(target, reserved) {
  let candidate = target;
  let index = 1;
  while (reserved.has(candidate.toLowerCase()) || await fs.access(candidate).then(() => true, () => false)) {
    candidate = path.join(path.dirname(target), `${path.basename(target, path.extname(target))} (${index})${path.extname(target)}`);
    index += 1;
  }
  return candidate;
}

function requestRendererConfirmation(sender, payload) {
  if (!sender || sender.isDestroyed()) return Promise.resolve("cancel");
  const id = crypto.randomUUID();
  return new Promise((resolve) => {
    const timer = setTimeout(() => {
      pendingConfirmations.delete(id);
      resolve("cancel");
    }, 300000);
    timer.unref?.();
    pendingConfirmations.set(id, { senderId: sender.id, resolve, timer });
    sender.send("confirmation-request", { id, ...payload });
  });
}

async function chooseConflictPolicy(source, output, current, sender) {
  if (current !== "ask") return current;
  const zh = currentLanguage === "zh";
  return requestRendererConfirmation(sender, {
    title: zh ? "输出文件已存在" : "Output file already exists",
    message: zh ? `${path.basename(output)} 已存在。请选择本次任务后续遇到冲突时的处理方式。` : `${path.basename(output)} already exists. Choose how to handle conflicts for this task.`,
    tone: "warning",
    actions: [
      { value: "cancel", label: zh ? "取消任务" : "Cancel task", variant: "subtle" },
      { value: "skip", label: zh ? "全部跳过" : "Skip all", variant: "outline" },
      { value: "rename", label: zh ? "全部重命名" : "Rename all", variant: "outline" },
      { value: "overwrite", label: zh ? "全部覆盖" : "Overwrite all", variant: "primary", primary: true },
    ],
  });
}

async function convertFiles(event, files, outputDir, project) {
  if (activeConversion) throw Object.assign(new Error("已有转换任务正在运行。"), { code: "CONVERSION_BUSY" });
  const jobId = `desktop-${Date.now()}-${crypto.randomUUID().slice(0, 8)}`;
  await appendLog({ level: "INFO", component: "electron", event: "job_started", jobId, stage: "queued", message: "转换任务开始", details: { fileCount: files.length } });
  const runtime = await getRuntimeStatus();
  if (!runtime.ready) {
    const error = { code: "RUNTIME_NOT_READY", category: "environment", severity: "error", jobId, file: null, stage: "runtime", line: null, message: runtime.python.available ? "转换依赖不完整。" : "找不到 Python。", suggestions: ["打开运行环境设置并重新检测。"], recoverable: true };
    await appendLog({ level: "ERROR", component: "electron", event: "job_failed", jobId, stage: "runtime", code: error.code, message: error.message });
    return { status: "failed", jobId, total: files.length, processed: 0, unprocessed: files.length, items: files.map((source) => ({ source, success: false, ok: false, jobId, error: error.message, errorObject: { ...error, file: source } })) };
  }
  const snapshotRoot = await fs.mkdtemp(path.join(app.getPath("temp"), "md2docx-snapshot-"));
  const snapshot = path.join(snapshotRoot, "project.json");
  const inputList = path.join(snapshotRoot, "inputs.json");
  const snapshotProject = mergeProject(project);
  delete snapshotProject.files;
  delete snapshotProject.outputDirectory;
  delete snapshotProject.projectPath;
  await fs.writeFile(snapshot, `${JSON.stringify(snapshotProject, null, 2)}\n`, "utf8");
  await fs.writeFile(inputList, `${JSON.stringify({ files }, null, 2)}\n`, "utf8");
  let conflictPolicy = appSettings.conversion.onConflict;
  if (conflictPolicy === "ask") {
    const seen = new Set();
    let conflict = null;
    for (const source of files) {
      const output = path.join(outputDir, `${path.basename(source, path.extname(source))}.docx`);
      const key = output.toLowerCase();
      if (!seen.has(key) && await fs.access(output).then(() => true, () => false)) { conflict = { source, output }; break; }
      seen.add(key);
    }
    if (conflict) conflictPolicy = await chooseConflictPolicy(conflict.source, conflict.output, conflictPolicy, event.sender);
    else conflictPolicy = "overwrite";
    if (conflictPolicy === "cancel") {
      await fs.rm(snapshotRoot, { recursive: true, force: true });
      await appendLog({ level: "WARNING", component: "electron", event: "job_cancelled", jobId, stage: "queued", message: "转换任务已取消。", details: { total: files.length, processed: 0 } });
      return { status: "cancelled", jobId, total: files.length, processed: 0, unprocessed: files.length, items: [] };
    }
  }
  const control = { jobId, cancelRequested: false, child: null, terminationPromise: null };
  const progressItems = [];
  activeConversion = control;
  try {
    const cliArgs = ["batch", "--input-list", inputList, "--output-dir", outputDir, "--config", snapshot, "--job-id", jobId, "--progress", "jsonl", "--missing-images", appSettings.conversion.missingImages, "--on-conflict", conflictPolicy, "--batch-errors", appSettings.conversion.batchErrors];
    const response = await invokeCli(runtime.cli?.path || runtime.python.path, cliArgs, { MD2DOCX_PANDOC: runtime.pandoc.path, MD2DOCX_LOG_DIR: logRoot, MD2DOCX_LOG_ENABLED: logSettings.enabled ? "1" : "0", MD2DOCX_LOG_AUTO_CLEANUP: logSettings.autoCleanup ? "1" : "0", MD2DOCX_LOG_RETENTION_DAYS: String(logSettings.retentionDays), MD2DOCX_LOG_LEVEL: logSettings.level, MD2DOCX_SKIP_PREFLIGHT: appSettings.conversion.preflight ? "" : "1" }, (progress) => {
      if (progress.event === "item" && progress.item) progressItems.push(progress.item);
      if (!event.sender.isDestroyed()) event.sender.send("conversion-progress", { total: files.length, current: progressItems.length, jobId, ...progress });
    }, control);
    const payload = response.payload || {};
    const rawItems = Array.isArray(payload.items) ? payload.items : progressItems;
    const items = rawItems.map((item) => ({ ...item, ok: item.success ?? item.ok, report: { ...item } }));
    const processed = Number.isInteger(payload.processed) ? payload.processed : items.length;
    const unprocessed = Math.max(0, files.length - processed);
    const status = response.cancelled ? "cancelled" : payload.status || (response.code === 0 ? "completed" : items.length ? "partial" : "failed");
    await appendLog({ level: status === "completed" ? "INFO" : "WARNING", component: "electron", event: status === "cancelled" ? "job_cancelled" : "job_completed", jobId, stage: "completed", message: status === "cancelled" ? "转换任务已取消。" : "转换任务完成", details: { total: files.length, processed, unprocessed } });
    if (!event.sender.isDestroyed()) event.sender.send("conversion-progress", { total: files.length, done: true, jobId, stage: "completed", status });
    return { status, jobId, total: files.length, processed, unprocessed, items, errors: payload.errors || [], warnings: payload.warnings || [] };
  } finally {
    if (activeConversion === control) activeConversion = null;
    await fs.rm(snapshotRoot, { recursive: true, force: true });
  }
}

async function cancelConversion() {
  if (!activeConversion) return false;
  activeConversion.cancelRequested = true;
  if (activeConversion.child && activeConversion.child.exitCode === null) {
    activeConversion.terminationPromise ||= terminateProcessTree(activeConversion.child);
    await activeConversion.terminationPromise;
  }
  return true;
}

function classifyIpcError(channel, error) {
  const rawMessage = error instanceof SyntaxError ? "配置 JSON 格式无效，请检查文件内容。" : String(error?.message || error || "操作失败");
  const code = String(error?.code || "").toUpperCase();
  let category = "internal";
  let normalizedCode = code || "IPC_HANDLER_FAILED";
  let suggestions = ["查看日志与诊断页面，或重试此操作。"];
  if (["EACCES", "EPERM", "EBUSY", "EEXIST", "ENOSPC"].includes(code)) {
    category = "storage";
    normalizedCode = "STORAGE_WRITE_FAILED";
    suggestions = ["检查目录权限、磁盘空间和占用该文件的程序。"];
  } else if (/配置|profile|schemaVersion|JSON/i.test(rawMessage)) {
    category = "config";
    normalizedCode = code || "CONFIG_INVALID";
    suggestions = ["检查配置文件内容或重新导入配置。"];
  } else if (/Python|Pandoc|运行环境|runtime/i.test(rawMessage)) {
    category = "environment";
    normalizedCode = code || "RUNTIME_NOT_READY";
    suggestions = ["打开运行环境页面并重新检测依赖。"];
  } else if (/不存在|not found|ENOENT/i.test(rawMessage)) {
    category = "input";
    normalizedCode = code || "INPUT_NOT_FOUND";
    suggestions = ["检查文件或目录路径是否仍然有效。"];
  }
  if (rawMessage.includes("已存在") && channel.includes("profile")) { normalizedCode = "PROFILE_ID_EXISTS"; category = "config"; suggestions = ["使用不同的配置 ID。"];
  } else if (rawMessage.includes("不能删除") || rawMessage.includes("不能重命名")) { normalizedCode = "PROFILE_PROTECTED"; category = "config"; suggestions = ["使用另存为创建自定义配置。"];
  } else if (channel.includes("editing-draft")) { normalizedCode = /^(save|prepare|delete)-/.test(channel) ? "DRAFT_WRITE_FAILED" : "DRAFT_INVALID";
  } else if (channel.includes("app-settings-draft") || channel === "save-app-settings" || channel === "save-log-settings") { normalizedCode = "SETTINGS_WRITE_FAILED";
  } else if (channel === "export-diagnostics") { normalizedCode = "DIAGNOSTICS_EXPORT_FAILED"; }
  return {
    code: normalizedCode,
    category,
    severity: "error",
    jobId: null,
    file: null,
    stage: channel,
    line: null,
    message: rawMessage,
    suggestions,
    recoverable: category !== "internal",
    details: { channel, systemCode: code || null },
  };
}

function handleIpc(channel, handler) { ipcMain.handle(channel, async (event, ...args) => {
  try {
    return { success: true, data: await handler(event, ...args) };
  } catch (error) {
    const errorObject = classifyIpcError(channel, error);
    await appendLog({ level: "ERROR", component: "electron", event: "ipc_failed", stage: channel, code: errorObject.code, message: errorObject.message, details: { category: errorObject.category, recoverable: errorObject.recoverable } }).catch(() => {});
    return { success: false, error: errorObject };
  }
}); }

handleIpc("select-files", async () => { const result = await dialog.showOpenDialog(mainWindow, { title: "添加 Markdown 文件", properties: ["openFile", "multiSelections"], filters: [{ name: "Markdown", extensions: ["md", "markdown"] }] }); return result.canceled ? [] : result.filePaths; });
handleIpc("select-output-dir", async () => { const result = await dialog.showOpenDialog(mainWindow, { title: "选择 DOCX 输出目录", properties: ["openDirectory", "createDirectory"] }); return result.canceled ? null : result.filePaths[0]; });
handleIpc("list-profiles", listProfiles);
handleIpc("select-folder", async () => { const result = await dialog.showOpenDialog(mainWindow, { title: "添加 Markdown 文件夹", properties: ["openDirectory"] }); return result.canceled ? [] : collectMarkdown(result.filePaths); });
handleIpc("collect-markdown", (_event, paths) => { if (!appSettings.files.dragDrop) return []; return collectMarkdown(paths); });
handleIpc("load-task-state", async () => { if (appSettings.general.startupTask === "clear") return { files: [], outputDirectory: "" }; try { return JSON.parse(await fs.readFile(path.join(workspaceDir(), "task-state.json"), "utf8")); } catch (error) { if (error.code === "ENOENT") return null; throw error; } });
handleIpc("save-task-state", async (_event, value) => { await atomicWriteJson(path.join(workspaceDir(), "task-state.json"), { files: Array.isArray(value?.files) ? value.files.filter((file) => typeof file === "string") : [], outputDirectory: typeof value?.outputDirectory === "string" ? value.outputDirectory : "" }); return true; });
handleIpc("list-profile-backups", listProfileBackups);
handleIpc("restore-profile-backup", async (_event, file) => {
  if (typeof file !== "string" || path.basename(file) !== file || !file.endsWith(".json")) throw new Error("备份文件无效。");
  const config = mergeProject(JSON.parse(await fs.readFile(path.join(backupsDir(), file), "utf8")));
  const target = profilePath(config.id); await backupProfile(config.id, "damaged"); const saved = await writeProfile(target, config); await deleteEditingDraft(config.id); return saved;
});
handleIpc("load-profile", async (_event, id) => {
  return readProfile(profilePath(id));
});
handleIpc("save-profile", async (_event, project) => { const saved = await writeProfile(profilePath(project.id), project); await writeEditingDraft(saved.id, { config: saved, files: project.files, outputDirectory: project.outputDirectory, dirty: false }); return saved; });
handleIpc("save-profile-as", async (_event, project, requestedId) => { const id = String(requestedId || project?.id || `profile-${crypto.randomUUID().slice(0, 8)}`).trim(); const target = profilePath(id); if (await fs.access(target).then(() => true, () => false)) throw new Error("目标配置 ID 已存在。"); const saved = await writeProfile(target, { ...project, id }); await writeEditingDraft(saved.id, { config: saved, files: project.files, outputDirectory: project.outputDirectory, dirty: false }); return saved; });
handleIpc("export-profile", async (_event, project) => { const suggested = `${project?.id || "profile"}.json`; const result = await dialog.showSaveDialog(mainWindow, { title: "导出配置", defaultPath: suggested, filters: [{ name: "JSON", extensions: ["json"] }] }); if (result.canceled) return null; const id = profileIdFromPath(result.filePath); if (!PROFILE_ID.test(id)) throw new Error("导出的文件名必须以小写字母开头，只能包含小写字母、数字、下划线和短横线。"); return writeProfile(result.filePath, { ...project, id }); });
handleIpc("rename-profile", async (_event, oldId, nextId) => { if (oldId === "default") throw new Error("系统默认配置不能重命名。"); const targetId = String(nextId || "").trim(); if (!PROFILE_ID.test(targetId)) throw new Error("配置 ID 只能包含小写字母、数字、下划线和短横线。"); if (oldId === targetId) return readProfile(profilePath(oldId)); const source = profilePath(oldId); const target = profilePath(targetId); await fs.access(source); try { await fs.access(target); throw new Error("目标配置 ID 已存在。"); } catch (error) { if (error.code !== "ENOENT") throw error; } const current = await readProfile(source); const saved = await writeProfile(target, { ...current, id: targetId }); await fs.rm(source, { force: true }); const draft = await readEditingDraft(oldId).catch(() => null); if (draft) { await writeEditingDraft(targetId, { ...draft, id: targetId, config: { ...draft.config, id: targetId } }); await deleteEditingDraft(oldId); } return saved; });
async function importProfileFile(sourcePath, requestedId, overwrite = false) { const raw = JSON.parse(await fs.readFile(sourcePath, "utf8")); const sourceId = profileIdFromPath(sourcePath); const id = String(requestedId || (PROFILE_ID.test(sourceId) && sourceId !== "default" ? sourceId : `profile-${crypto.randomUUID().slice(0, 8)}`)).trim(); const target = profilePath(id); const exists = await fs.access(target).then(() => true, () => false); if (exists && !overwrite) return { conflict: true, id, sourcePath, config: { ...raw, id } }; return writeProfile(target, { ...raw, id }); }
handleIpc("import-profile", async (_event, options = {}) => { let sourcePath = options.sourcePath; if (!sourcePath) { const result = await dialog.showOpenDialog(mainWindow, { title: "导入配置", properties: ["openFile"], filters: [{ name: "JSON", extensions: ["json"] }] }); if (result.canceled) return null; sourcePath = result.filePaths[0]; } return importProfileFile(sourcePath, options.id, options.overwrite === true); });
handleIpc("delete-profile", async (_event, id) => { if (id === "default") throw new Error("系统默认配置不能删除。"); await fs.rm(profilePath(id), { force: true }); await deleteEditingDraft(id); return true; });
handleIpc("open-profiles-dir", async () => { await ensureProfiles(); return openLocalPath(profilesDir()); });
handleIpc("list-editing-drafts", async () => listEditingDrafts());
handleIpc("load-editing-draft", async (_event, id) => {
  return readEditingDraft(id);
});
handleIpc("prepare-editing-draft", async (_event, id) => {
  return prepareEditingDraft(id);
});
handleIpc("save-editing-draft", async (_event, id, value) => {
  await writeEditingDraft(id, value); return true;
});
handleIpc("delete-editing-draft", async (_event, id) => deleteEditingDraft(id));
handleIpc("get-runtime-status", async (_event, options = {}) => getRuntimeStatus(options?.force === true));
handleIpc("get-app-settings", async () => loadAppSettings());
handleIpc("save-app-settings", async (_event, settings) => saveAppSettings(settings || {}));
handleIpc("load-app-settings-draft", async () => loadAppSettingsDraft());
handleIpc("save-app-settings-draft", async (_event, settings) => saveAppSettingsDraft(settings || {}));
handleIpc("commit-app-settings-draft", async (_event, settings) => commitAppSettingsDraft(settings || null));
handleIpc("discard-app-settings-draft", async () => discardAppSettingsDraft());
handleIpc("popup-app-menu", (_event, section, position) => popupAppMenu(section, position));
handleIpc("set-titlebar-theme", (_event, appearance) => {
  return syncTitlebar(appearance);
});
handleIpc("get-log-settings", async () => (await loadAppSettings()).logs);
handleIpc("save-log-settings", async (_event, settings) => (await saveAppSettings({ logs: settings || {} })).logs);
handleIpc("read-logs", async (_event, limit) => readLogs(Number(limit) || 200));
handleIpc("clear-logs", async () => clearLogs());
handleIpc("open-logs-dir", async () => { await ensureLogDirs(); return openLocalPath(logRoot); });
handleIpc("export-diagnostics", async (_event, payload) => exportDiagnostics(payload || {}));
handleIpc("convert-files", async (event, { files, outputDir, project }) => convertFiles(event, files, outputDir, project));
handleIpc("cancel-conversion", async () => cancelConversion());
async function openLocalPath(target) {
  if (typeof target !== "string" || !target.trim()) throw Object.assign(new Error("请选择有效的文件或目录。"), { code: "PATH_INVALID" });
  const resolved = path.resolve(target);
  try { await fs.access(resolved); }
  catch (error) { throw Object.assign(new Error(error.code === "ENOENT" ? "文件或目录不存在，请重新转换或检查输出位置。" : "无法访问文件或目录，请检查权限。"), { code: error.code === "ENOENT" ? "PATH_NOT_FOUND" : "PATH_ACCESS_FAILED" }); }
  const reason = await shell.openPath(resolved);
  if (reason) throw Object.assign(new Error("系统无法打开文件或目录。请检查 DOCX 默认打开程序及文件占用情况。"), { code: "PATH_OPEN_FAILED" });
  return true;
}
handleIpc("open-path", async (_event, target) => openLocalPath(target));
ipcMain.on("allow-close", () => { closeRequestPending = false; allowWindowClose = true; if (mainWindow && !mainWindow.isDestroyed()) mainWindow.close(); });
ipcMain.on("cancel-close", () => { closeRequestPending = false; });
ipcMain.on("confirmation-response", (event, payload = {}) => {
  const pending = pendingConfirmations.get(payload.id);
  if (!pending || pending.senderId !== event.sender.id) return;
  clearTimeout(pending.timer);
  pendingConfirmations.delete(payload.id);
  pending.resolve(typeof payload.value === "string" ? payload.value : "cancel");
});
ipcMain.on("set-language", (_event, language) => setLanguage(language, false));

app.whenReady().then(async () => {
  const startedAt = Date.now();
  const migrated = await migrateLegacyUserData();
  await loadAppSettings();
  createWindow();
  void (async () => {
    const backgroundStartedAt = Date.now();
    await Promise.all([cleanupStaleAtomicFiles(), ensureLogDirs(), ensureProfiles()]);
    await prepareAppSettingsDraft();
    await appendLog({ level: "INFO", component: "electron", event: migrated ? "user_data_migrated" : "app_started", stage: "startup", message: migrated ? "用户数据已迁移到新目录" : "应用启动", durationMs: Date.now() - startedAt, details: { backgroundDurationMs: Date.now() - backgroundStartedAt } });
    try {
      await prepareEditingDraft(appSettings.lastProfileId, true);
    } catch {
      appSettings.lastProfileId = "default";
      await prepareEditingDraft("default", true);
      await saveAppSettings({ lastProfileId: "default" });
    }
  })().catch((error) => appendLog({ level: "ERROR", component: "electron", event: "startup_background_failed", stage: "startup", code: error.code || "STARTUP_BACKGROUND_FAILED", message: error.message }).catch(() => {}));
  app.on("activate", () => { if (BrowserWindow.getAllWindows().length === 0) createWindow(); });
});
app.on("window-all-closed", () => { if (process.platform !== "darwin") app.quit(); });
app.on("before-quit", () => {});
nativeTheme.on("updated", () => { if (appSettings.general.appearance === "system") syncTitlebar(); });


