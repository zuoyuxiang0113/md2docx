const { contextBridge, ipcRenderer, webUtils } = require("electron");

const operationErrorListeners = new Set();
const droppedFileListeners = new Set();
document.addEventListener("drop", (event) => {
  if (!event.target.closest?.(".document-page")) return;
  event.preventDefault();
  const paths = Array.from(event.dataTransfer?.files || []).map((file) => webUtils.getPathForFile(file)).filter(Boolean);
  invoke("collect-markdown", paths).then((files) => { for (const callback of droppedFileListeners) { try { callback(files); } catch {} } }).catch(() => {});
}, true);
async function invoke(channel, ...args) {
  let response;
  try { response = await ipcRenderer.invoke(channel, ...args); }
  catch (error) { response = { success: false, error: { code: "IPC_TRANSPORT_FAILED", category: "internal", severity: "error", jobId: null, file: null, stage: channel, line: null, message: error.message || "通信失败", suggestions: ["重新打开应用。"], recoverable: true } }; }
  if (response?.success === true) return response.data;
  const errorObject = response?.error || { code: "IPC_RESPONSE_INVALID", category: "internal", severity: "error", jobId: null, file: null, stage: channel, line: null, message: "应用返回了无效响应。", suggestions: ["重新打开应用。"], recoverable: true };
  for (const callback of operationErrorListeners) { try { callback(errorObject); } catch {} }
  const error = new Error(errorObject.message);
  error.code = errorObject.code;
  error.errorObject = errorObject;
  throw error;
}

contextBridge.exposeInMainWorld("md2docx", {
  onOperationError: (callback) => { operationErrorListeners.add(callback); return () => operationErrorListeners.delete(callback); },
  onConfirmationRequest: (callback) => {
    const listener = (_event, payload) => callback(payload);
    ipcRenderer.on("confirmation-request", listener);
    return () => ipcRenderer.removeListener("confirmation-request", listener);
  },
  respondConfirmation: (id, value) => ipcRenderer.send("confirmation-response", { id, value }),
  selectFiles: () => invoke("select-files"),
  selectFolder: () => invoke("select-folder"),
  onDroppedFiles: (callback) => { droppedFileListeners.add(callback); return () => droppedFileListeners.delete(callback); },
  loadTaskState: () => invoke("load-task-state"),
  saveTaskState: (state) => invoke("save-task-state", state),
  listProfileBackups: () => invoke("list-profile-backups"),
  restoreProfileBackup: (file) => invoke("restore-profile-backup", file),
  selectOutputDir: () => invoke("select-output-dir"),
  convertFiles: (payload) => invoke("convert-files", payload),
  cancelConversion: () => invoke("cancel-conversion"),
  listProfiles: () => invoke("list-profiles"),
  loadProfile: (id) => invoke("load-profile", id),
  saveProfile: (project) => invoke("save-profile", project),
  saveProfileAs: (project, id) => invoke("save-profile-as", project, id),
  exportProfile: (project) => invoke("export-profile", project),
  renameProfile: (oldId, newId) => invoke("rename-profile", oldId, newId),
  importProfile: (options) => invoke("import-profile", options || {}),
  deleteProfile: (id) => invoke("delete-profile", id),
  openProfilesDir: () => invoke("open-profiles-dir"),
  listEditingDrafts: () => invoke("list-editing-drafts"),
  loadEditingDraft: (id) => invoke("load-editing-draft", id),
  prepareEditingDraft: (id) => invoke("prepare-editing-draft", id),
  saveEditingDraft: (id, value) => invoke("save-editing-draft", id, value),
  deleteEditingDraft: (id) => invoke("delete-editing-draft", id),
  getRuntimeStatus: (options) => invoke("get-runtime-status", options || {}),
  getAppSettings: () => invoke("get-app-settings"),
  saveAppSettings: (settings) => invoke("save-app-settings", settings),
  loadAppSettingsDraft: () => invoke("load-app-settings-draft"),
  saveAppSettingsDraft: (settings) => invoke("save-app-settings-draft", settings),
  commitAppSettingsDraft: (settings) => invoke("commit-app-settings-draft", settings),
  discardAppSettingsDraft: () => invoke("discard-app-settings-draft"),
  popupAppMenu: (section, position) => invoke("popup-app-menu", section, position || {}),
  setTitlebarTheme: (appearance) => invoke("set-titlebar-theme", appearance),
  getLogSettings: () => invoke("get-log-settings"),
  saveLogSettings: (settings) => invoke("save-log-settings", settings),
  readLogs: (limit) => invoke("read-logs", limit),
  clearLogs: () => invoke("clear-logs"),
  openLogsDir: () => invoke("open-logs-dir"),
  exportDiagnostics: (payload) => invoke("export-diagnostics", payload),
  openPath: (target) => invoke("open-path", target),
  onCloseRequest: (callback) => {
    const listener = () => callback();
    ipcRenderer.on("request-close", listener);
    return () => ipcRenderer.removeListener("request-close", listener);
  },
  allowClose: () => ipcRenderer.send("allow-close"),
  cancelClose: () => ipcRenderer.send("cancel-close"),
  setLanguage: (language) => ipcRenderer.send("set-language", language),
  onLanguage: (callback) => {
    const listener = (_event, language) => callback(language);
    ipcRenderer.on("language-changed", listener);
    return () => ipcRenderer.removeListener("language-changed", listener);
  },
  onMenuAction: (callback) => {
    const listener = (_event, action) => callback(action);
    ipcRenderer.on("app-menu-action", listener);
    return () => ipcRenderer.removeListener("app-menu-action", listener);
  },
  onProgress: (callback) => {
    const listener = (_event, payload) => callback(payload);
    ipcRenderer.on("conversion-progress", listener);
    return () => ipcRenderer.removeListener("conversion-progress", listener);
  },
});
