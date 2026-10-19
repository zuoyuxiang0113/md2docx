import React, { useEffect, useMemo, useRef, useState } from "react";
import profileDefaults from "../../../core/defaults.json";
import appDefaults from "../app-defaults.json";
import ThemeColor from "./ThemeColor.jsx";
import StyleEditor from "./StyleEditor.jsx";
import { createBrowserApi } from "./browser-api.js";
import { ToastViewport } from "./Feedback.jsx";
import Icon from "./Icon.jsx";
import { ConfirmationDialog, ProfileDialog } from "./Dialogs.jsx";
import { accentVariables } from "./theme-colors.js";

const PROFILE_ID = /^[a-z0-9][a-z0-9_-]{0,63}$/;
function mergeAppSettings(value = {}) {
  return { ...appDefaults, ...value, general: { ...appDefaults.general, ...value.general }, files: { ...appDefaults.files, ...value.files }, conversion: { ...appDefaults.conversion, ...value.conversion }, logs: { ...appDefaults.logs, ...value.logs } };
}

const defaults = { ...profileDefaults, files: [], outputDirectory: "" };

const messages = {
  zh: {
    title: "Markdown 转 DOCX", styles: "配置", document: "文档", settings: "设置", results: "结果", runtimeSettings: "运行环境", logSettings: "日志与诊断", generalSettings: "常规", conversionSettings: "转换", aboutSettings: "关于", back: "设置", collapseSidebar: "收起侧边栏", expandSidebar: "展开侧边栏", pageSettings: "页面", bodySettings: "正文", headingSettings: "标题", tableSettings: "表格", codeSettings: "代码块", imageSettings: "图片", mathSettings: "公式", numberingSettings: "编号",
    configFile: "配置", configUntitled: "未命名配置", profileScheme: "配置方案", manageProfiles: "管理配置", profileLibrary: "配置库", newProfile: "新建配置", openProfile: "打开", save: "保存", saveAs: "另存为", importProfile: "导入", exportProfile: "导出", renameProfile: "重命名", deleteProfile: "删除", openFolder: "打开配置目录", close: "关闭", currentProfile: "当前使用", fileName: "文件名", modifiedAt: "最近修改", onlyOneProfile: "当前只有一个配置", invalidProfile: "配置损坏", unsaved: "未保存", saved: "已保存", restoreDraft: "恢复上次未保存修改？", discardDraft: "放弃上次未保存修改？", profilePrompt: "输入配置 ID", profileConflict: "配置文件已存在，选择覆盖或输入新的文件名。", profileConflictOverwrite: "覆盖现有配置", profileCreateError: "创建配置失败",
    profileIdLabel: "配置 ID", profileIdHint: "小写字母、数字、下划线或短横线，最多 64 个字符", selectedProfile: "已选择", createProfileTitle: "新建配置", createProfileHelp: "从内置 default 创建一份新的配置。", saveAsTitle: "另存为新配置", saveAsHelp: "保存当前编辑内容为新的配置，原配置保持不变。", renameProfileTitle: "重命名配置", renameProfileHelp: "文件名与 JSON 中的 id 会同时更新。", deleteProfileTitle: "删除配置", deleteProfileHelp: "配置及其工作副本将被删除，此操作不可撤销。", importConflictTitle: "配置已存在", importConflictHelp: "覆盖现有配置，或输入新的配置 ID 后导入副本。", cancel: "取消", create: "创建", confirmRename: "重命名", confirmDelete: "删除", overwrite: "覆盖", importCopy: "导入副本", profileSavedNotice: (id) => `${id}.json 已保存`, profileCreatedNotice: (id) => `${id}.json 已创建`, profileExportedNotice: (path) => `已导出到 ${path}`, profileDeletedNotice: (id) => `${id}.json 已删除`, profileRenamedNotice: (id) => `已重命名为 ${id}.json`, browserFolderUnavailable: "浏览器预览无法打开 APPDATA 目录，请在 Electron 桌面端使用此功能。", invalidProfileId: "配置 ID 格式不正确。",
    addFile: "添加文件", count: (n) => `${n} 个文件`, remove: "移除", outputDirectory: "输出目录", chooseDirectory: "选择目录",
    numbering: "启用 Word 自动编号", start: "开始转换", converting: "转换中", done: "完成", body: "正文", heading: (n) => `标题 ${n}`,
    size: "字号", color: "颜色", lineSpacing: "行距", firstIndent: "首行缩进", spaceBefore: "段前", spaceAfter: "段后", preset: "纸张", orientation: "方向", portrait: "纵向", landscape: "横向", width: "宽度", height: "高度", margin: "页边距", topMargin: "上", bottomMargin: "下", leftMargin: "左", rightMargin: "右", headerBold: "表头加粗", threeLine: "三线表", tableAlignment: "表格对齐", padding: "单元格内边距", background: "背景色", wrap: "自动换行", showLanguage: "显示语言", imageAlign: "图片对齐", maxWidth: "最大宽度", keepRatio: "保持比例", caption: "保留图注", mathFormat: "公式格式", fallback: "失败处理", stripNumbers: "去除已有编号", enabled: "启用", startAt: "起始级别", fieldsSaved: "字段已预留并随配置文件保存",
    alignment: "对齐方式", left: "左对齐", center: "居中", right: "右对齐", justify: "两端对齐", bold: "加粗", italic: "斜体",
    reset: "恢复默认", sampleTitle: "示例标题", sampleText: "排版示例 · Markdown to DOCX",
    python: "Python", pandoc: "Pandoc", ready: "可用", missing: "未找到", runtime: "运行环境", path: "路径", version: "版本", refresh: "重新检查", logEnabled: "启用日志", logLevel: "日志级别", logLevelInfo: "普通", logLevelDebug: "详细", autoCleanup: "自动清理", retentionDays: "保留天数", openLogs: "打开日志目录", exportDiagnostics: "导出诊断报告", clearLogs: "清理日志", logCount: (n) => `${n} 条记录`, noLogs: "暂无日志", confirmClearLogs: "确定清理日志吗？",
    appearance: "外观", followSystem: "跟随系统", light: "浅色", dark: "深色", density: "界面密度", compact: "紧凑", comfortable: "舒适", launchMaximized: "启动时最大化", confirmClose: "关闭前确认", conflictPolicy: "同名输出文件", conflictAsk: "询问", conflictOverwrite: "覆盖", conflictRename: "自动重命名", conflictSkip: "跳过", conflictFail: "失败", batchErrors: "批量错误", batchContinue: "继续并汇总", batchStop: "立即停止", preflight: "转换前预检", defaultOutput: "默认输出目录", chooseDirectory: "选择目录", openAfterConvert: "成功后打开输出目录", runtimePackage: "Python 依赖", pythonDocx: "python-docx", lxml: "lxml", appVersion: "版本", dataDirectory: "数据目录", schemaNote: "当前配置协议：schemaVersion 2",
    fixPython: "设置 MD2DOCX_PYTHON 或放入 runtime/python", fixPandoc: "设置 MD2DOCX_PANDOC 或放入 runtime/pandoc",
    runtimeMissing: "转换工具缺失", failed: "失败", skipped: "跳过", succeeded: "成功", warnings: (n) => `${n} 条警告`,
    resultCount: (ok, total) => `${ok}/${total} 成功`, openDocx: "打开 DOCX", openOutput: "打开输出目录", convertAgain: "再次转换",
    confirmOpen: "有未保存修改，仍要打开其他配置吗？", error: "操作失败", closeConfirm: "确定关闭应用吗？",
  },
  en: {
    title: "Markdown to DOCX", styles: "Configuration", document: "Document", settings: "Settings", results: "Results", runtimeSettings: "Runtime", logSettings: "Logs & diagnostics", generalSettings: "General", conversionSettings: "Conversion", aboutSettings: "About", back: "Settings", collapseSidebar: "Collapse sidebar", expandSidebar: "Expand sidebar", pageSettings: "Page", bodySettings: "Body", headingSettings: "Headings", tableSettings: "Table", codeSettings: "Code", imageSettings: "Images", mathSettings: "Math", numberingSettings: "Numbering",
    configFile: "Configuration", configUntitled: "Untitled configuration", profileScheme: "Profile", manageProfiles: "Manage profiles", profileLibrary: "Profile library", newProfile: "New profile", openProfile: "Open", save: "Save", saveAs: "Save as", importProfile: "Import", exportProfile: "Export", renameProfile: "Rename", deleteProfile: "Delete", openFolder: "Open profile folder", close: "Close", currentProfile: "Current", fileName: "Filename", modifiedAt: "Modified", onlyOneProfile: "Only one profile", invalidProfile: "Invalid profile", unsaved: "Unsaved", saved: "Saved", restoreDraft: "Restore last unsaved changes?", discardDraft: "Discard last unsaved changes?", profilePrompt: "Enter profile ID", profileConflict: "A profile with this filename already exists. Choose overwrite or enter a new filename.", profileConflictOverwrite: "Overwrite existing profile", profileCreateError: "Failed to create profile",
    profileIdLabel: "Profile ID", profileIdHint: "Lowercase letters, numbers, underscores, or hyphens; 64 characters maximum", selectedProfile: "Selected", createProfileTitle: "New profile", createProfileHelp: "Create a new profile from the built-in default.", saveAsTitle: "Save as new profile", saveAsHelp: "Save the current edits as a new profile and leave the original unchanged.", renameProfileTitle: "Rename profile", renameProfileHelp: "The filename and JSON id are updated together.", deleteProfileTitle: "Delete profile", deleteProfileHelp: "The profile and its working copy will be deleted. This cannot be undone.", importConflictTitle: "Profile already exists", importConflictHelp: "Overwrite the existing profile, or enter another ID to import a copy.", cancel: "Cancel", create: "Create", confirmRename: "Rename", confirmDelete: "Delete", overwrite: "Overwrite", importCopy: "Import copy", profileSavedNotice: (id) => `${id}.json saved`, profileCreatedNotice: (id) => `${id}.json created`, profileExportedNotice: (path) => `Exported to ${path}`, profileDeletedNotice: (id) => `${id}.json deleted`, profileRenamedNotice: (id) => `Renamed to ${id}.json`, browserFolderUnavailable: "The browser preview cannot open the APPDATA folder. Use this action in the Electron desktop app.", invalidProfileId: "The profile ID format is invalid.",
    addFile: "Add files", count: (n) => `${n} file(s)`, remove: "Remove", outputDirectory: "Output folder", chooseDirectory: "Choose folder",
    numbering: "Enable Word automatic numbering", start: "Convert", converting: "Converting", done: "Done", body: "Body", heading: (n) => `Heading ${n}`,
    size: "Size", color: "Color", lineSpacing: "Line spacing", firstIndent: "First-line indent", spaceBefore: "Before", spaceAfter: "After", preset: "Paper", orientation: "Orientation", portrait: "Portrait", landscape: "Landscape", width: "Width", height: "Height", margin: "Margins", topMargin: "Top", bottomMargin: "Bottom", leftMargin: "Left", rightMargin: "Right", headerBold: "Bold header", threeLine: "Three-line table", tableAlignment: "Table alignment", padding: "Cell padding", background: "Background", wrap: "Wrap text", showLanguage: "Show language", imageAlign: "Image alignment", maxWidth: "Max width", keepRatio: "Keep ratio", caption: "Keep captions", mathFormat: "Math format", fallback: "Fallback", stripNumbers: "Strip existing numbers", enabled: "Enabled", startAt: "Start level", fieldsSaved: "Fields are preserved in the configuration file",
    alignment: "Alignment", left: "Left", center: "Center", right: "Right", justify: "Justify", bold: "Bold", italic: "Italic",
    reset: "Reset", sampleTitle: "Heading sample", sampleText: "Typesetting sample · Markdown to DOCX",
    python: "Python", pandoc: "Pandoc", ready: "Ready", missing: "Missing", runtime: "Runtime", path: "Path", version: "Version", refresh: "Recheck", logEnabled: "Enable logs", logLevel: "Log level", logLevelInfo: "Normal", logLevelDebug: "Detailed", autoCleanup: "Auto-clean logs", retentionDays: "Retention days", openLogs: "Open log folder", exportDiagnostics: "Export diagnostics", clearLogs: "Clear logs", logCount: (n) => `${n} records`, noLogs: "No logs", confirmClearLogs: "Clear logs now?",
    appearance: "Appearance", followSystem: "System", light: "Light", dark: "Dark", density: "Density", compact: "Compact", comfortable: "Comfortable", launchMaximized: "Launch maximized", confirmClose: "Confirm before close", conflictPolicy: "Name conflicts", conflictAsk: "Ask", conflictOverwrite: "Overwrite", conflictRename: "Auto rename", conflictSkip: "Skip", conflictFail: "Fail", batchErrors: "Batch errors", batchContinue: "Continue and summarize", batchStop: "Stop immediately", preflight: "Preflight before conversion", defaultOutput: "Default output folder", chooseDirectory: "Choose folder", openAfterConvert: "Open output folder on success", runtimePackage: "Python dependencies", pythonDocx: "python-docx", lxml: "lxml", appVersion: "Version", dataDirectory: "Data directory", schemaNote: "Current profile protocol: schemaVersion 2",
    fixPython: "Set MD2DOCX_PYTHON or add to runtime/python", fixPandoc: "Set MD2DOCX_PANDOC or add to runtime/pandoc",
    runtimeMissing: "Conversion tools missing", failed: "Failed", skipped: "Skipped", succeeded: "Succeeded", warnings: (n) => `${n} warning(s)`,
    resultCount: (ok, total) => `${ok}/${total} succeeded`, openDocx: "Open DOCX", openOutput: "Open output folder", convertAgain: "Convert again",
    confirmOpen: "Unsaved changes. Open another configuration?", error: "Operation failed", closeConfirm: "Close the application?",
  },
};

function mergeDefaults(value = {}) {
  const merge = (base, extra) => Object.fromEntries(Object.keys({ ...base, ...extra }).map((key) => [
    key,
    extra?.[key] && typeof extra[key] === "object" && !Array.isArray(extra[key])
      ? merge(base?.[key] || {}, extra[key])
      : extra?.[key] ?? base[key],
  ]));
  const config = merge(defaults, value);
  delete config.elements;
  return config;
}

const api = window.md2docx || createBrowserApi({ defaults, appDefaults, mergeDefaults, mergeAppSettings, profileIdPattern: PROFILE_ID });

function displayName(path, fallback) {
  return path ? path.split(/[\\/]/).pop() : fallback;
}

export default function App() {
  const [language, setLanguage] = useState(() => localStorage.getItem("md2docx-language") || "zh");
  const t = messages[language] || messages.zh;
  const st = language === "zh" ? {
    language: "界面语言", startup: "启动时的任务", restore: "恢复上次文件和输出目录", clear: "每次清空", windowSize: "默认启动窗口大小", small: "小（900 × 620）", medium: "中（1000 × 700）", large: "大（1200 × 820）", serverPort: "服务端口", files: "文件添加", drag: "允许拖放 Markdown 和文件夹", recursive: "包含子文件夹", addFolder: "添加文件夹", after: "转换完成后", none: "不操作", docx: "打开成功的 DOCX", folder: "打开输出目录", images: "本地图片缺失", warning: "继续并警告", stop: "停止当前文件转换", shortcuts: "启用快捷键", reset: "恢复默认前确认", operations: "操作", saveCurrent: "保存当前更改", limit: "日志显示条数", drop: "拖入 Markdown 文件或文件夹"
  } : {
    language: "Language", startup: "Startup task", restore: "Restore previous files and output", clear: "Clear each launch", windowSize: "Default startup window size", small: "Small (900 × 620)", medium: "Medium (1000 × 700)", large: "Large (1200 × 820)", serverPort: "Service port", files: "Adding files", drag: "Allow dropping Markdown and folders", recursive: "Include subfolders", addFolder: "Add folder", after: "After conversion", none: "Do nothing", docx: "Open successful DOCX files", folder: "Open output folder", images: "Missing local images", warning: "Continue with warnings", stop: "Stop converting this file", shortcuts: "Enable shortcuts", reset: "Confirm before restoring defaults", operations: "Actions", saveCurrent: "Save current changes", limit: "Log display limit", drop: "Drop Markdown files or folders"
  };
  const [config, setConfig] = useState(() => mergeDefaults());
  const [configPath, setConfigPath] = useState("");
  const [profiles, setProfiles] = useState([]);
  const [profileId, setProfileId] = useState("default");
  const [selectedProfileId, setSelectedProfileId] = useState("default");
  const [profileAction, setProfileAction] = useState(null);
  const [dragging, setDragging] = useState(false);
  const [dirty, setDirty] = useState(false);
  const [files, setFiles] = useState([]);
  const [outputDirectory, setOutputDirectory] = useState("");
  const [activePage, setActivePage] = useState("document");
  const [settingsSection, setSettingsSection] = useState("home");
  const [appSettings, setAppSettings] = useState(appDefaults);
  const [serverPortInput, setServerPortInput] = useState(String(appDefaults.general.serverPort));
  const [settingsDirty, setSettingsDirty] = useState(false);
  const [sidebarCollapsed, setSidebarCollapsed] = useState(() => localStorage.getItem("md2docx-sidebar-collapsed") === "1");
  const [systemDark, setSystemDark] = useState(() => window.matchMedia("(prefers-color-scheme: dark)").matches);
  const [logSettings, setLogSettings] = useState(appDefaults.logs);
  const [logRecords, setLogRecords] = useState([]);
  const [logLevelFilter, setLogLevelFilter] = useState("all");
  const [logJobFilter, setLogJobFilter] = useState("all");
  const logJobIds = [...new Set(logRecords.map((record) => record.jobId).filter(Boolean))];
  const visibleLogs = logRecords.filter((record) => (logLevelFilter === "all" || record.level === logLevelFilter) && (logJobFilter === "all" || record.jobId === logJobFilter));
  const [styleKey, setStyleKey] = useState("normal");
  const [styleSection, setStyleSection] = useState("body");
  const [configView, setConfigView] = useState("library");
  const [runtime, setRuntime] = useState(null);
  const [busy, setBusy] = useState(false);
  const [progress, setProgress] = useState(null);
  const [toasts, setToasts] = useState([]);
  const [confirmation, setConfirmation] = useState(null);
  const confirmationResolver = useRef(null);
  const [results, setResults] = useState([]);
  const [conversionTask, setConversionTask] = useState(null);
  const [resultsStale, setResultsStale] = useState(false);
  const [profileLoaded, setProfileLoaded] = useState(false);

  function setNotice(message, type = "warning", duration = type === "error" ? 6500 : type === "success" ? 4200 : 5200) {
    if (!message) return;
    const toast = { id: `${Date.now()}-${Math.random().toString(16).slice(2)}`, message, type, duration };
    const signature = String(message).split("\n")[0];
    setToasts((current) => current.some((item) => item.type === type && String(item.message).split("\n")[0] === signature) ? current : [...current.slice(-3), toast]);
  }

  function dismissToast(id) {
    setToasts((current) => current.filter((toast) => toast.id !== id));
  }

  function requestConfirmation(options) {
    if (confirmationResolver.current) confirmationResolver.current("cancel");
    return new Promise((resolve) => {
      confirmationResolver.current = resolve;
      setConfirmation(options);
    });
  }

  function finishConfirmation(value = "cancel") {
    const resolve = confirmationResolver.current;
    confirmationResolver.current = null;
    if (confirmation?.requestId) api.respondConfirmation?.(confirmation.requestId, value);
    setConfirmation(null);
    resolve?.(value);
  }

  function confirmUnsavedChanges(message = language === "zh" ? "当前配置包含尚未保存的修改。" : "The current profile has unsaved changes.") {
    return requestConfirmation({
      title: language === "zh" ? "未保存修改" : "Unsaved changes",
      message,
      tone: "warning",
      actions: [
        { value: "cancel", label: t.cancel, variant: "subtle" },
        { value: "discard", label: language === "zh" ? "放弃修改" : "Discard", variant: "outline" },
        { value: "save", label: language === "zh" ? "保存修改" : "Save", variant: "primary", primary: true },
      ],
    });
  }

  async function confirmAction({ title, message, confirmLabel, tone = "warning" }) {
    const choice = await requestConfirmation({
      title,
      message,
      tone,
      actions: [
        { value: "cancel", label: t.cancel, variant: "subtle" },
        { value: "confirm", label: confirmLabel, variant: tone === "danger" ? "danger" : "primary", primary: true },
      ],
    });
    return choice === "confirm";
  }

  useEffect(() => { localStorage.setItem("md2docx-language", language); }, [language]);
  useEffect(() => { setServerPortInput(String(appSettings.general.serverPort)); }, [appSettings.general.serverPort]);
  useEffect(() => { const query = window.matchMedia("(prefers-color-scheme: dark)"); const changed = (event) => setSystemDark(event.matches); query.addEventListener("change", changed); return () => query.removeEventListener("change", changed); }, []);
  useEffect(() => api.onOperationError?.((error) => {
    const details = [error?.message || t.error, [error?.code, error?.stage].filter(Boolean).join(" · "), error?.suggestions?.[0]].filter(Boolean).join("\n");
    setNotice(details, "error", 8000);
  }), []);
  useEffect(() => api.onConfirmationRequest?.((request) => {
    if (confirmationResolver.current) confirmationResolver.current("cancel");
    confirmationResolver.current = null;
    setConfirmation({ ...request, requestId: request.id });
  }), []);
  useEffect(() => api.onDroppedFiles?.((selected) => {
    if (busy || !appSettings.files.dragDrop) return;
    setFiles((current) => [...new Set([...current, ...selected])]);
    if (!selected.length) setNotice(st.drop);
  }), [busy, appSettings.files.dragDrop, language]);
  useEffect(() => api.onLanguage((nextLanguage) => {
    setLanguage(nextLanguage);
    setAppSettings((current) => {
      const next = { ...current, general: { ...current.general, language: nextLanguage } };
      if (activePage === "settings" && settingsSection === "general") api.saveAppSettingsDraft?.({ general: next.general }).catch?.(() => {});
      else api.saveAppSettings?.({ general: next.general }).catch?.(() => {});
      return next;
    });
    if (activePage === "settings" && settingsSection === "general") setSettingsDirty(true);
  }), [activePage, settingsSection]);
  useEffect(() => { if (profileLoaded) api.setLanguage(language); }, [language, profileLoaded]);
  useEffect(() => { if (profileLoaded) api.setTitlebarTheme?.(appSettings.general.appearance).catch?.(() => {}); }, [appSettings.general.appearance, profileLoaded]);
  useEffect(() => api.onProgress((payload) => {
    if (payload.done) setProgress(null);
    else setProgress({ current: payload.current ?? ((payload.index ?? 0) + 1), total: payload.total || files.length, stage: payload.stage || payload.event || "queued" });
  }), []);
  useEffect(() => api.onMenuAction?.((action) => {
    if (busy || profileAction) return;
    if (action === "add-files") addFiles();
    else if (action === "choose-output") chooseOutputDirectory();
    else if (action === "manage-profiles") openProfileManager();
    else if (action === "save-current" || action === "save-profile") saveCurrentContext();
    else if (action === "convert") convert();
    else if (action === "page-document") navigatePage("document");
    else if (action === "page-styles") navigatePage("styles");
    else if (action === "page-results") navigatePage("results");
    else if (action === "page-settings") navigatePage("settings");
    else if (action === "settings-runtime") openSettingsSection("runtime");
    else if (action === "settings-logs") { openSettingsSection("logs"); openLogs(); }
    else if (action === "settings-about") openSettingsSection("about");
    else if (action === "export-diagnostics") exportDiagnostics();
  }), [profileId, config, files, outputDirectory, dirty, settingsDirty, busy, runtime, results, activePage, settingsSection, configView, appSettings, logSettings, profileAction]);
  useEffect(() => { api.getRuntimeStatus().then(setRuntime).catch(() => setRuntime(null)); }, []);
  useEffect(() => { api.getLogSettings?.().then((value) => value && setLogSettings((current) => ({ ...current, ...value }))).catch(() => {}); }, []);
  useEffect(() => {
    (async () => {
      try {
        const [available, settings] = await Promise.all([api.listProfiles(), api.getAppSettings?.()]);
        const previousTask = await api.loadTaskState?.();
        if (settings?.general?.language) setLanguage(settings.general.language);
        const profileItems = available?.length ? available : [{ id: "default", updatedAt: null, valid: true }];
        setProfiles(profileItems);
        const preferredId = settings?.lastProfileId;
        const initial = profileItems.find((item) => item.valid !== false && item.id === preferredId) || profileItems.find((item) => item.valid !== false && item.id === "default") || profileItems.find((item) => item.valid !== false);
        let loadedSuccessfully = false;
        if (initial) {
          const loaded = await api.loadProfile(initial.id);
          if (loaded) {
            const draft = await api.prepareEditingDraft?.(loaded.id).catch?.(() => null) || await api.loadEditingDraft?.(loaded.id).catch?.(() => null);
            let working = loaded;
            let restored = false;
            if (draft?.dirty) {
              const choice = await confirmUnsavedChanges(language === "zh" ? "发现上次退出时保留的修改。请选择恢复、放弃或取消启动切换。" : "Unsaved edits from the previous session were found. Restore or discard them.");
              if (choice === "save" || choice === "cancel") { working = { ...draft.config, files: draft.files || [], outputDirectory: draft.outputDirectory || "" }; restored = true; }
              else { await api.deleteEditingDraft?.(loaded.id); await api.prepareEditingDraft?.(loaded.id); }
            } else if (draft) {
              working = { ...draft.config, files: draft.files || [], outputDirectory: draft.outputDirectory || "" };
            }
            setConfig(mergeDefaults(working));
            const restoreTask = settings?.general?.startupTask !== "clear";
            setFiles(restoreTask ? previousTask?.files ?? working.files ?? [] : []);
            setOutputDirectory(restoreTask ? previousTask?.outputDirectory || working.outputDirectory || settings?.conversion?.defaultOutputDirectory || "" : settings?.conversion?.defaultOutputDirectory || "");
            setProfileId(loaded.id); setSelectedProfileId(loaded.id); setConfigPath(loaded.projectPath || ""); setDirty(restored); setProfileLoaded(true);
            await api.saveAppSettings?.({ lastProfileId: loaded.id });
            if (settings) setAppSettings(mergeAppSettings(settings));
            loadedSuccessfully = true;
          }
        }
        if (!loadedSuccessfully) {
          setConfig(mergeDefaults());
          setFiles([]);
          setOutputDirectory(settings?.conversion?.defaultOutputDirectory || "");
          setProfileId("default");
          setDirty(false);
          setProfileLoaded(true);
          setNotice("默认配置不可用，当前使用内置默认值。");
        }
      } catch (error) { setNotice(error.message || t.error, "error"); }
    })();
  }, []);
  useEffect(() => {
    if (!profileLoaded || !profileId) return undefined;
    const timer = window.setTimeout(() => {
      api.saveEditingDraft?.(profileId, { config, files, outputDirectory, dirty }).catch?.(() => {});
      api.saveTaskState?.({ files, outputDirectory }).catch?.(() => {});
    }, 250);
    return () => window.clearTimeout(timer);
  }, [config, files, outputDirectory, dirty, profileId, profileLoaded]);
  useEffect(() => api.onCloseRequest?.(async () => {
    let allowed = false;
    try {
      if (busy) { setNotice(language === "zh" ? "转换正在进行，请完成后再关闭。" : "Conversion is running. Close after it finishes."); return; }
      allowed = true;
      const hadUnsavedChanges = dirty || settingsDirty;
      if (dirty) {
        const choice = await confirmUnsavedChanges();
        if (choice === "save") allowed = await saveConfiguration(false);
        else if (choice === "discard") await discardCurrentDraft();
        else allowed = false;
      }
      if (allowed && settingsDirty) allowed = await resolveSettingsChanges();
      if (allowed && !hadUnsavedChanges && appSettings.general.confirmClose) allowed = await confirmAction({ title: language === "zh" ? "关闭应用" : "Close application", message: t.closeConfirm, confirmLabel: language === "zh" ? "关闭" : "Close", tone: "danger" });
      if (allowed) await api.saveTaskState?.({ files, outputDirectory });
    } catch (error) { allowed = false; setNotice(error.message || t.error, "error"); }
    finally { if (allowed) api.allowClose?.(); else api.cancelClose?.(); }
  }), [dirty, settingsDirty, busy, language, appSettings.general.confirmClose, profileId, config, files, outputDirectory, appSettings, logSettings]);

  const warningCount = useMemo(() => results.reduce((total, item) => total + (item.report?.warnings?.length || 0), 0), [results]);
  const succeededCount = results.filter((item) => item.ok).length;
  const failedCount = results.filter((item) => !item.ok && !item.skipped).length;
  const skippedCount = results.filter((item) => item.skipped).length;

  function updateConfig(change) {
    if (busy) return;
    setConfig((current) => mergeDefaults({ ...current, ...change }));
    setDirty(true);
    if (results.length) setResultsStale(true);
  }

  function updateStyle(property, value) {
    if (busy) return;
    setConfig((current) => mergeDefaults({
      ...current,
      styles: { ...current.styles, [styleKey]: { ...current.styles[styleKey], [property]: value } },
    }));
    setDirty(true);
    if (results.length) setResultsStale(true);
  }

  function updateGroup(group, property, value) {
    if (busy) return;
    const currentGroup = group.split(".").reduce((valueAtPath, key) => valueAtPath?.[key], config) || {};
    const nextGroup = { ...currentGroup, [property]: value };
    const parts = group.split(".");
    const next = { ...config };
    let cursor = next;
    parts.forEach((part, index) => {
      if (index === parts.length - 1) cursor[part] = nextGroup;
      else { cursor[part] = { ...(cursor[part] || {}) }; cursor = cursor[part]; }
    });
    updateConfig(next);
  }

  async function resetStyles() {
    if (busy) return;
    if (appSettings.general.confirmReset && !(await confirmAction({ title: language === "zh" ? "恢复默认设置" : "Restore defaults", message: language === "zh" ? "当前分类的修改将被默认值覆盖。" : "Changes in this section will be replaced with defaults.", confirmLabel: language === "zh" ? "恢复" : "Restore" }))) return;
    const copy = (value) => JSON.parse(JSON.stringify(value));
    if (styleSection === "page") updateConfig({ page: copy(defaults.page) });
    else if (styleSection === "numbering") updateConfig({ numbering: copy(defaults.numbering) });
    else if (styleSection === "image") updateConfig({ options: { ...config.options, images: copy(defaults.options.images) } });
    else if (styleSection === "math") updateConfig({ options: { ...config.options, math: defaults.options.math, mathFallback: defaults.options.mathFallback } });
    else {
      const key = { body: "normal", table: "table", code: "codeBlock", heading: styleKey }[styleSection];
      if (key) updateConfig({ styles: { ...config.styles, [key]: copy(defaults.styles[key]) } });
    }
  }

  async function addFiles() {
    if (busy) return;
    try {
      const selected = await api.selectFiles();
      if (!selected.length) return;
      const next = [...new Set([...files, ...selected])];
      setFiles(next);
    } catch (error) { setNotice(error.message || t.error, "error"); }
  }
  async function addFolder() {
    if (busy) return;
    try {
      const selected = await api.selectFolder?.();
      if (!selected) { setNotice(language === "zh" ? "请在桌面端添加文件夹。" : "Add folders in the desktop app."); return; }
      setFiles((current) => [...new Set([...current, ...selected])]);
      if (!selected.length) setNotice(language === "zh" ? "文件夹中没有 Markdown 文件。" : "No Markdown files found.");
    } catch (error) { setNotice(error.message || t.error, "error"); }
  }
  async function dropFiles(event) {
    event.preventDefault(); setDragging(false);
    if (busy || !appSettings.files.dragDrop) return;
    if (!api.onDroppedFiles) setNotice(language === "zh" ? "请在桌面端拖放文件。" : "Drag files into the desktop app.");
  }

  function removeFile(path) {
    const next = files.filter((file) => file !== path);
    setFiles(next);
  }

  async function chooseOutputDirectory() {
    if (busy) return;
    try {
      const selected = await api.selectOutputDir();
      if (selected) setOutputDirectory(selected);
    } catch (error) { setNotice(error.message || t.error, "error"); }
  }

  async function chooseDefaultOutputDirectory() {
    if (busy) return;
    try {
      const selected = await api.selectOutputDir();
      if (selected) updateAppSettings("conversion", { defaultOutputDirectory: selected });
    } catch (error) { setNotice(error.message || t.error, "error"); }
  }

  async function discardCurrentDraft() {
    const loaded = await api.loadProfile(profileId);
    if (loaded) {
      setConfig(mergeDefaults(loaded));
      setConfigPath(loaded.projectPath || configPath);
      await api.saveEditingDraft?.(profileId, { config: loaded, files, outputDirectory, dirty: false });
    }
    setDirty(false);
    return true;
  }

  async function resolveUnsaved() {
    if (!dirty) return true;
    const choice = await confirmUnsavedChanges();
    if (choice === "cancel") return false;
    if (choice === "save") return saveConfiguration(false);
    return discardCurrentDraft();
  }

  async function openConfiguration() {
    await openProfileManager();
  }

  async function saveConfiguration(as = false) {
    if (busy) return false;
    if (as) {
      setProfileAction({ mode: "saveAs", value: `${profileId || "profile"}-copy`, targetId: profileId, error: "" });
      return false;
    }
    try {
      const requestedId = profileId || config.id || "default";
      const saved = await api.saveProfile({ ...config, id: requestedId, files, outputDirectory });
      if (!saved) return false;
      setConfig(mergeDefaults(saved));
      setProfileId(saved.id);
      setSelectedProfileId(saved.id);
      setConfigPath(saved.projectPath || configPath);
      setProfiles(await api.listProfiles());
      setDirty(false);
      await api.saveEditingDraft?.(saved.id, { config: saved, files, outputDirectory, dirty: false });
      await api.saveAppSettings?.({ lastProfileId: saved.id });
      setNotice(t.profileSavedNotice(saved.id), "success");
      return true;
    } catch (error) { setNotice(error.message || t.error, "error"); }
    return false;
  }

  async function selectProfile(nextId) {
    if (!nextId || nextId === profileId || busy) return false;
    if (!(await resolveUnsaved())) return false;
    try {
      const loaded = await api.loadProfile(nextId);
      if (!loaded) return false;
      const draft = await api.prepareEditingDraft?.(loaded.id).catch?.(() => null) || await api.loadEditingDraft?.(loaded.id).catch?.(() => null);
      let working = loaded;
      let restored = false;
      if (draft?.dirty) {
        const draftChoice = await confirmUnsavedChanges(language === "zh" ? "此配置存在尚未处理的编辑副本。" : "This profile has an unresolved editing draft.");
        if (draftChoice === "cancel") return false;
        if (draftChoice === "save") { working = { ...draft.config, files: draft.files || [], outputDirectory: draft.outputDirectory || "" }; restored = true; }
        else { await api.deleteEditingDraft?.(loaded.id); await api.prepareEditingDraft?.(loaded.id); }
      } else if (draft) {
        working = { ...draft.config, files: draft.files || [], outputDirectory: draft.outputDirectory || "" };
      }
      setConfig(mergeDefaults(working));
      setFiles(working.files || []);
      setOutputDirectory(working.outputDirectory || appSettings.conversion.defaultOutputDirectory || "");
      setProfileId(loaded.id);
      setSelectedProfileId(loaded.id);
      setConfigPath(loaded.projectPath || "");
      setDirty(restored);
      setResults([]);
      setConversionTask(null);
      setResultsStale(false);
      await api.saveAppSettings?.({ lastProfileId: loaded.id });
      return true;
    } catch (error) { setNotice(error.message || t.error, "error"); return false; }
  }

  async function importConfiguration() {
    if (busy) return;
    if (!(await resolveUnsaved())) return;
    try {
      let imported = await api.importProfile();
      if (!imported) return;
      if (imported.conflict) {
        setProfileAction({ mode: "importConflict", value: `${imported.id}-copy`, targetId: imported.id, sourcePath: imported.sourcePath, sourceData: imported.sourceData, fileName: imported.fileName, error: "" });
        return;
      }
      setConfig(mergeDefaults(imported));
      setFiles([]);
      setOutputDirectory(appSettings.conversion.defaultOutputDirectory || "");
      setProfileId(imported.id);
      setSelectedProfileId(imported.id);
      setConfigPath(imported.projectPath || "");
      setProfiles(await api.listProfiles());
      setDirty(false);
      await api.saveEditingDraft?.(imported.id, { config: imported, files: [], outputDirectory: appSettings.conversion.defaultOutputDirectory || "", dirty: false });
      await api.saveAppSettings?.({ lastProfileId: imported.id });
      setNotice(language === "zh" ? `${imported.id}.json 已导入` : `${imported.id}.json imported`, "success");
    } catch (error) { setNotice(error.message || t.error, "error"); }
  }

  async function createConfiguration() {
    if (busy) return;
    setProfileAction({ mode: "create", value: "new-profile", targetId: "default", error: "" });
  }

  async function openProfileManager() {
    if (activePage === "styles" && configView === "editor" && !(await resolveUnsaved())) return;
    if (activePage === "settings" && !(await resolveSettingsChanges())) return;
    try {
      const available = await api.listProfiles();
      setProfiles(available?.length ? available : [{ id: "default", updatedAt: null, valid: true }]);
      setSelectedProfileId(profileId);
      setConfigView("library");
      setActivePage("styles");
    } catch (error) { setNotice(error.message || t.error, "error"); }
  }

  async function openManagedProfile(id) {
    if (!id || profiles.find((item) => item.id === id)?.valid === false) return;
    if (id !== profileId && !(await selectProfile(id))) return;
    setSelectedProfileId(id);
    setConfigView("editor");
    setActivePage("styles");
  }

  async function returnToProfileLibrary() {
    if (!(await resolveUnsaved())) return;
    try {
      const available = await api.listProfiles();
      setProfiles(available?.length ? available : [{ id: "default", updatedAt: null, valid: true }]);
    } catch (error) { setNotice(error.message || t.error, "error"); }
    setSelectedProfileId(profileId);
    setConfigView("library");
  }

  function profileDate(value) {
    if (!value) return "—";
    try { return new Intl.DateTimeFormat(language === "zh" ? "zh-CN" : "en-US", { dateStyle: "short", timeStyle: "short" }).format(new Date(value)); } catch { return "—"; }
  }

  async function restoreDamagedProfile(id) {
    if (!id || busy) return;
    try {
      const backups = await api.listProfileBackups?.() || [];
      const backup = backups.find((item) => item.valid && item.id === id);
      if (!backup) { setNotice(language === "zh" ? "没有可用于恢复此配置的备份" : "No usable backup is available for this profile", "warning"); return; }
      const confirmed = await confirmAction({ title: language === "zh" ? "恢复损坏配置" : "Restore damaged profile", message: language === "zh" ? `将使用最近的有效备份恢复 ${id}.json。` : `Restore ${id}.json from its latest valid backup.`, confirmLabel: language === "zh" ? "恢复" : "Restore" });
      if (!confirmed) return;
      const restored = await api.restoreProfileBackup(backup.file);
      setProfiles(await api.listProfiles());
      setConfig(mergeDefaults(restored));
      setProfileId(restored.id);
      setSelectedProfileId(restored.id);
      setConfigPath(restored.projectPath || "");
      setDirty(false);
      await api.saveAppSettings?.({ lastProfileId: restored.id });
      setNotice(language === "zh" ? `${restored.id}.json 已恢复` : `${restored.id}.json restored`, "success");
    } catch (error) { setNotice(error.message || t.error, "error"); }
  }

  async function exportConfiguration() {
    if (busy) return;
    try {
      const source = selectedProfileId === profileId ? { ...config, id: profileId } : await api.loadProfile(selectedProfileId);
      const exported = source && await api.exportProfile?.(source);
      if (exported?.projectPath) setNotice(t.profileExportedNotice(exported.projectPath), "success");
    } catch (error) { setNotice(error.message || t.error, "error"); }
  }

  async function deleteConfiguration() {
    if (busy || selectedProfileId === "default" || profiles.filter((item) => item.valid !== false).length <= 1) return;
    setProfileAction({ mode: "delete", value: selectedProfileId, targetId: selectedProfileId, error: "" });
  }

  async function renameConfiguration() {
    if (busy || selectedProfileId === "default") return;
    setProfileAction({ mode: "rename", value: selectedProfileId, targetId: selectedProfileId, error: "" });
  }

  function updateProfileAction(value) {
    setProfileAction((current) => ({ ...current, value, error: value && !PROFILE_ID.test(value) ? t.invalidProfileId : "" }));
  }

  async function completeProfileAction(kind = null) {
    if (!profileAction || busy) return;
    const mode = kind || profileAction.mode;
    const id = String(profileAction.value || "").trim();
    if (mode !== "delete" && mode !== "overwrite" && !PROFILE_ID.test(id)) { setProfileAction((current) => ({ ...current, error: t.invalidProfileId })); return; }
    try {
      if (mode === "create" || mode === "saveAs") {
        if (mode === "create" && !(await resolveUnsaved())) return;
        const source = mode === "create" ? await api.loadProfile("default") : config;
        const created = await api.saveProfileAs({ ...source, id, files: mode === "saveAs" ? files : [], outputDirectory: mode === "saveAs" ? outputDirectory : "" }, id);
        setConfig(mergeDefaults(created)); setFiles(mode === "saveAs" ? files : []); setOutputDirectory(mode === "saveAs" ? outputDirectory : (appSettings.conversion.defaultOutputDirectory || ""));
        setProfileId(created.id); setSelectedProfileId(created.id); setConfigPath(created.projectPath || ""); setDirty(false); setResults([]); setConversionTask(null); setResultsStale(false);
        await api.saveEditingDraft?.(created.id, { config: created, files: mode === "saveAs" ? files : [], outputDirectory: mode === "saveAs" ? outputDirectory : "", dirty: false });
        await api.saveAppSettings?.({ lastProfileId: created.id });
        setNotice(t.profileCreatedNotice(created.id), "success");
      } else if (mode === "rename") {
        if (profileAction.targetId === profileId && !(await resolveUnsaved())) return;
        const renamed = await api.renameProfile?.(profileAction.targetId, id);
        if (profileAction.targetId === profileId) { setConfig(mergeDefaults(renamed)); setProfileId(renamed.id); setConfigPath(renamed.projectPath || ""); await api.saveAppSettings?.({ lastProfileId: renamed.id }); }
        setSelectedProfileId(renamed.id); setNotice(t.profileRenamedNotice(renamed.id), "success");
      } else if (mode === "delete") {
        const deletingId = profileAction.targetId;
        if (deletingId === profileId && !(await resolveUnsaved())) return;
        await api.deleteProfile(deletingId);
        if (deletingId === profileId) {
          const loaded = await api.loadProfile("default"); const draft = await api.prepareEditingDraft?.("default"); const working = draft ? { ...draft.config, files: draft.files || [], outputDirectory: draft.outputDirectory || "" } : loaded;
          setConfig(mergeDefaults(working)); setFiles(working.files || []); setOutputDirectory(working.outputDirectory || appSettings.conversion.defaultOutputDirectory || ""); setProfileId("default"); setSelectedProfileId("default"); setConfigPath(loaded.projectPath || ""); setDirty(Boolean(draft?.dirty)); await api.saveAppSettings?.({ lastProfileId: "default" });
        } else setSelectedProfileId(profileId);
        setNotice(t.profileDeletedNotice(deletingId), "success");
      } else if (mode === "overwrite" || mode === "importConflict") {
        const importId = mode === "overwrite" ? profileAction.targetId : id;
        const imported = await api.importProfile({ sourcePath: profileAction.sourcePath, sourceData: profileAction.sourceData, fileName: profileAction.fileName, id: importId, overwrite: mode === "overwrite" });
        if (!imported || imported.conflict) throw new Error(t.profileConflict);
        setConfig(mergeDefaults(imported)); setFiles([]); setOutputDirectory(appSettings.conversion.defaultOutputDirectory || ""); setProfileId(imported.id); setSelectedProfileId(imported.id); setConfigPath(imported.projectPath || ""); setDirty(false); await api.saveEditingDraft?.(imported.id, { config: imported, files: [], outputDirectory: "", dirty: false }); await api.saveAppSettings?.({ lastProfileId: imported.id });
      }
      setProfiles(await api.listProfiles());
      setProfileAction(null);
      if (["create", "saveAs", "overwrite", "importConflict"].includes(mode)) { setConfigView("editor"); setActivePage("styles"); }
    } catch (error) { setProfileAction((current) => ({ ...current, error: error.message || t.error })); }
  }

  async function refreshRuntime() {
    setRuntime(null);
    try { setRuntime(await api.getRuntimeStatus({ force: true })); }
    catch (error) { setNotice(error.message || t.error, "error"); }
  }

  async function navigatePage(page) {
    if (page === "runtime" || page === "logs") {
      const opened = await openSettingsSection(page);
      if (opened && page === "logs") await openLogs();
      return;
    }
    if (activePage === "settings" && settingsSection === "general" && settingsDirty && !(await resolveSettingsChanges())) return;
    if (page === "styles") {
      if (activePage === "styles" && configView === "editor" && !(await resolveUnsaved())) return;
      try {
        const available = await api.listProfiles();
        setProfiles(available?.length ? available : [{ id: "default", updatedAt: null, valid: true }]);
      } catch (error) { setNotice(error.message || t.error, "error"); }
      setSelectedProfileId(profileId);
      setConfigView("library");
      setActivePage("styles");
      return;
    }
    if (activePage === "styles" && configView === "editor" && !(await resolveUnsaved())) return;
    setActivePage(page);
    if (page === "settings") setSettingsSection("home");
  }

  async function openSettingsSection(section) {
    if (activePage === "styles" && !(await resolveUnsaved())) return false;
    if (activePage === "settings" && settingsSection === "general" && section !== "general" && settingsDirty && !(await resolveSettingsChanges())) return false;
    setActivePage("settings");
    setSettingsSection(section);
    return true;
  }

  async function returnToSettingsHome() {
    if (settingsSection === "general" && settingsDirty && !(await resolveSettingsChanges())) return;
    setSettingsSection("home");
  }

  async function openLogs() {
    try { setLogRecords(await api.readLogs?.(logSettings.displayLimit || 200) || []); } catch (error) { setNotice(error.message || t.error, "error"); }
  }

  async function updateLogSettings(change) {
    const next = { ...logSettings, ...change };
    setLogSettings(next);
    try { await api.saveLogSettings?.(next); if (change.displayLimit) setLogRecords(await api.readLogs?.(next.displayLimit) || []); } catch (error) { setNotice(error.message || t.error, "error"); }
  }

  async function updateAppSettings(group, change) {
    const next = { ...appSettings, [group]: { ...appSettings[group], ...change } };
    setAppSettings(next);
    setSettingsDirty(true);
    try { await api.saveAppSettingsDraft?.({ [group]: next[group] }); } catch (error) { setNotice(error.message || t.error, "error"); }
  }

  async function commitSettingsChanges() {
    try {
      const saved = mergeAppSettings(await api.commitAppSettingsDraft?.({ ...appSettings, logs: logSettings }) || { ...appSettings, logs: logSettings });
      setAppSettings(saved);
      setLogSettings(saved.logs);
      setLanguage(saved.general.language);
      setSettingsDirty(false);
      setNotice(language === "zh" ? "设置已保存" : "Settings saved", "success");
      return true;
    } catch (error) { setNotice(error.message || t.error, "error"); return false; }
  }

  async function discardSettingsChanges() {
    try {
      const saved = mergeAppSettings(await api.discardAppSettingsDraft?.() || appDefaults);
      setAppSettings(saved);
      setLogSettings(saved.logs);
      setLanguage(saved.general.language);
      setSettingsDirty(false);
      return true;
    } catch (error) { setNotice(error.message || t.error, "error"); return false; }
  }

  async function resolveSettingsChanges() {
    if (!settingsDirty) return true;
    const choice = await requestConfirmation({
      title: language === "zh" ? "保存设置修改" : "Save settings changes",
      message: language === "zh" ? "设置已写入编辑缓冲，是否保存为正式设置？" : "Changes are stored in the editing buffer. Save them as the active settings?",
      tone: "warning",
      actions: [
        { value: "cancel", label: t.cancel, variant: "subtle" },
        { value: "discard", label: language === "zh" ? "放弃修改" : "Discard", variant: "outline" },
        { value: "save", label: t.save, variant: "primary", primary: true },
      ],
    });
    if (choice === "cancel") return false;
    if (choice === "discard") return discardSettingsChanges();
    return commitSettingsChanges();
  }

  async function saveCurrentContext() {
    if (busy) return false;
    if (activePage === "settings") return settingsSection === "general" && settingsDirty ? commitSettingsChanges() : true;
    if (dirty) return saveConfiguration(false);
    return true;
  }

  function commitServerPort() {
    const port = Number(serverPortInput);
    if (!Number.isInteger(port) || port < 1024 || port > 65535) {
      setServerPortInput(String(appSettings.general.serverPort));
      setNotice(language === "zh" ? "端口号必须是 1024–65535 之间的整数" : "The port must be an integer between 1024 and 65535", "warning");
      return;
    }
    if (port !== appSettings.general.serverPort) updateAppSettings("general", { serverPort: port });
  }


  async function clearLogs() {
    if (!(await confirmAction({ title: language === "zh" ? "清理日志" : "Clear logs", message: t.confirmClearLogs, confirmLabel: language === "zh" ? "清理" : "Clear", tone: "danger" }))) return;
    try { await api.clearLogs?.(); setLogRecords([]); setLogJobFilter("all"); setNotice(language === "zh" ? "日志已清理" : "Logs cleared", "success"); } catch (error) { setNotice(error.message || t.error, "error"); }
  }

  async function exportDiagnostics() {
    try { const exported = await api.exportDiagnostics?.({ config, files, results }); if (exported) setNotice(language === "zh" ? "诊断报告已导出" : "Diagnostics exported", "success"); } catch (error) { setNotice(error.message || t.error, "error"); }
  }

  async function convert() {
    if (!files.length || !outputDirectory || busy) return;
    if (activePage === "settings" && !(await resolveSettingsChanges())) return;
    if (!runtime?.ready) { openSettingsSection("runtime"); return; }
    setBusy(true);
    setProgress({ current: 0, total: files.length, stage: "queued" });
    try {
      const currentConfig = mergeDefaults({ ...config, files, outputDirectory });
      const task = await api.convertFiles({ files, outputDir: outputDirectory, project: currentConfig });
      const nextResults = task.items || [];
      setConversionTask(task);
      setResults(nextResults);
      setResultsStale(false);
      setActivePage("results");
      const successful = nextResults.filter((item) => item.ok);
      const failed = nextResults.filter((item) => !item.ok && !item.skipped);
      const skipped = nextResults.filter((item) => item.skipped);
      if (task.status === "cancelled") setNotice(language === "zh" ? `转换已取消：已处理 ${task.processed}/${task.total}` : `Conversion cancelled: ${task.processed}/${task.total} processed`, "warning");
      else if (!failed.length && !skipped.length && !task.unprocessed) setNotice(language === "zh" ? `转换完成：${successful.length} 个文件` : `Conversion complete: ${successful.length} file(s)`, "success");
      else if (successful.length) setNotice(language === "zh" ? `转换完成：${successful.length} 个成功，${failed.length} 个失败，${skipped.length} 个跳过` : `Conversion complete: ${successful.length} succeeded, ${failed.length} failed, ${skipped.length} skipped`, "warning");
      else setNotice(language === "zh" ? "转换失败，请查看结果详情" : "Conversion failed. See result details.", "error");
      if (successful.length && appSettings.conversion.afterSuccess === "folder") await api.openPath(outputDirectory);
      if (appSettings.conversion.afterSuccess === "docx") for (const item of successful) await api.openPath(item.output);
    } catch (error) { setNotice(error.message || t.error, "error"); }
    finally { setBusy(false); setProgress(null); }
  }

  async function cancelConversion() {
    try { await api.cancelConversion?.(); setNotice(language === "zh" ? "正在取消转换…" : "Cancelling conversion…", "warning"); }
    catch (error) { setNotice(error.message || t.error, "error"); }
  }

  const navItems = [
    { id: "styles", label: t.styles, icon: <Icon name="styles" /> },
    { id: "document", label: t.document, icon: <Icon name="document" />, badge: files.length || null },
    { id: "results", label: t.results, icon: <Icon name="results" />, badge: results.length || null, stale: resultsStale },
    { id: "settings", label: t.settings, icon: <Icon name="settings" /> },
  ];
  const selectedNavId = activePage;
  const pageTitle = activePage === "styles" && configView === "editor"
    ? (language === "zh" ? "样式设置" : "Style settings")
    : activePage === "settings" && settingsSection !== "home"
    ? ({ config: t.configFile, general: t.generalSettings, runtime: t.runtimeSettings, logs: t.logSettings, about: t.aboutSettings }[settingsSection] || t.settings)
    : navItems.find((item) => item.id === activePage)?.label || t.styles;
  const configName = profileId || t.configUntitled;
  const profileActionText = profileAction ? {
    create: [t.createProfileTitle, t.createProfileHelp, t.create],
    saveAs: [t.saveAsTitle, t.saveAsHelp, t.saveAs],
    rename: [t.renameProfileTitle, t.renameProfileHelp, t.confirmRename],
    delete: [t.deleteProfileTitle, t.deleteProfileHelp, t.confirmDelete],
    importConflict: [t.importConflictTitle, t.importConflictHelp, t.importCopy],
  }[profileAction.mode] : null;
  const menuItems = language === "zh" ? [["file", "文件"], ["edit", "编辑"], ["view", "视图"], ["help", "帮助"]] : [["file", "File"], ["edit", "Edit"], ["view", "View"], ["help", "Help"]];
  function openApplicationMenu(section, event) { const rect = event.currentTarget.getBoundingClientRect(); api.popupAppMenu?.(section, { x: rect.left, y: rect.bottom }); }
  function toggleSidebar() { setSidebarCollapsed((current) => { const next = !current; localStorage.setItem("md2docx-sidebar-collapsed", next ? "1" : "0"); return next; }); }

  const isDark = appSettings.general.appearance === "dark" || (appSettings.general.appearance === "system" && systemDark);
  const themeAccent = accentVariables(appSettings.general.accentColor, isDark);
  return <div className={`desktop-app density-${appSettings.general.density} theme-${appSettings.general.appearance} ${sidebarCollapsed ? "sidebar-collapsed" : ""}`} style={themeAccent}>
    <div className="app-menu-strip">
      <div className="app-menu-items">{menuItems.map(([id, label]) => <button type="button" key={id} onClick={(event) => openApplicationMenu(id, event)}>{label}</button>)}</div>
      <span className="app-menu-title">MD2DOCX</span>
    </div>
    <aside className="sidebar">
      <div className="sidebar-brand"><span className="brand-icon"><Icon name="brand" /></span><span className="brand-title">MD2DOCX</span></div>
      <nav className="sidebar-nav" aria-label="主导航">
        {navItems.map((item) => <React.Fragment key={item.id}>{item.id === "settings" && <div className="sidebar-nav-divider" role="separator" />}<button type="button" title={item.label} aria-label={item.label} aria-current={selectedNavId === item.id ? "page" : undefined} disabled={busy} className={`sidebar-link ${selectedNavId === item.id ? "active" : ""}`} onClick={() => navigatePage(item.id)}>
          <span className="sidebar-icon">{item.icon}</span><span className="sidebar-label">{item.label}</span>
          {item.badge != null && <span className="sidebar-badge">{item.badge}</span>}{item.stale && <span className="sidebar-stale">•</span>}{item.warning && <span className="sidebar-warning" />}
        </button></React.Fragment>)}
      </nav>
      <button className="sidebar-collapse-toggle" type="button" title={sidebarCollapsed ? t.expandSidebar : t.collapseSidebar} aria-label={sidebarCollapsed ? t.expandSidebar : t.collapseSidebar} onClick={toggleSidebar}><Icon name={sidebarCollapsed ? "expand" : "collapse"} /><span className="sidebar-collapse-label">{sidebarCollapsed ? t.expandSidebar : t.collapseSidebar}</span></button>
    </aside>

    <section className="app-main">
      <header className="main-header">
        <h1>{pageTitle}</h1>
        {activePage !== "styles" && <div className="header-tools">
          <select className="header-config" value={profileId} disabled={busy} onChange={(event) => selectProfile(event.target.value)} aria-label={t.configFile}>
            {profiles.filter((item) => item.valid !== false).map((item) => <option key={item.id} value={item.id}>{item.id}</option>)}
          </select>
          {(activePage === "settings" ? settingsDirty : dirty) && <span className="dirty-status" title={t.unsaved}><span className="dirty-dot" />{t.unsaved}</span>}
          <button className="button outline profile-manage-button" type="button" disabled={busy} onClick={openProfileManager}><Icon name="config" />{t.manageProfiles}</button>
        </div>}
      </header>

      <main className="page-body">
        {activePage === "styles" && configView === "library" && <section className="styles-page profile-library-page">
          <div className="profile-library-toolbar">
            <div><button className="button outline" type="button" disabled={busy} onClick={createConfiguration}><Icon name="add" />{t.newProfile}</button><button className="button outline" type="button" disabled={busy} onClick={importConfiguration}><Icon name="import" />{t.importProfile}</button><button className="button subtle" type="button" disabled={busy} onClick={async () => { const opened = await api.openProfilesDir(); if (opened === false) setNotice(t.browserFolderUnavailable); }}><Icon name="folder" />{t.openFolder}</button></div>
          </div>
          <section className="profile-manager" aria-label={t.profileLibrary}>
            <div className="profile-list">
              {profiles.map((item) => <button type="button" disabled={busy} className={`profile-list-row ${item.id === profileId ? "is-current" : ""} ${item.id === selectedProfileId ? "is-selected" : ""} ${item.valid === false ? "is-invalid" : ""}`} key={item.id} onClick={() => setSelectedProfileId(item.id)} onDoubleClick={() => item.valid !== false && openManagedProfile(item.id)}>
                <span className="profile-radio" aria-hidden="true" />
                <span className="profile-list-main"><strong>{item.id}.json</strong><small>{item.valid === false ? t.invalidProfile : `${t.modifiedAt}: ${profileDate(item.updatedAt)}`}</small></span>
                {item.id === profileId && item.valid !== false && <span className="profile-current-badge">{t.currentProfile}</span>}
                {item.valid !== false && <Icon name="next" />}
              </button>)}
            </div>
            <div className="profile-manager-actions">{profiles.find((item) => item.id === selectedProfileId)?.valid === false && <button className="button primary" type="button" disabled={busy} onClick={() => restoreDamagedProfile(selectedProfileId)}><Icon name="refresh" />{language === "zh" ? "恢复" : "Restore"}</button>}<button className="button primary" type="button" disabled={busy || profiles.find((item) => item.id === selectedProfileId)?.valid === false} onClick={() => openManagedProfile(selectedProfileId)}><Icon name="next" />{t.openProfile}</button><button className="button outline" type="button" disabled={busy || profiles.find((item) => item.id === selectedProfileId)?.valid === false} onClick={exportConfiguration}><Icon name="export" />{t.exportProfile}</button><button className="button outline" type="button" disabled={busy || selectedProfileId === "default" || profiles.find((item) => item.id === selectedProfileId)?.valid === false} onClick={renameConfiguration}><Icon name="edit" />{t.renameProfile}</button><button className="button danger" type="button" disabled={busy || selectedProfileId === "default" || (profiles.find((item) => item.id === selectedProfileId)?.valid !== false && profiles.filter((item) => item.valid !== false).length <= 1)} onClick={deleteConfiguration}><Icon name="remove" />{t.deleteProfile}</button></div>
          </section>
        </section>}

        {activePage === "styles" && configView === "editor" && <section className="styles-page profile-editor-page">
          <div className="profile-toolbar editor-profile-toolbar">
            <button className="button subtle profile-editor-back" type="button" disabled={busy} onClick={returnToProfileLibrary}><Icon name="back" />{language === "zh" ? "配置列表" : "Profiles"}</button>
            <div className="editor-profile-name"><strong>{profileId}.json</strong><span className={`profile-status ${dirty ? "is-dirty" : "is-saved"}`}>{dirty ? t.unsaved : t.saved}</span></div>
            <div className="editor-profile-actions"><button className="button outline" type="button" disabled={busy} onClick={() => saveConfiguration(true)}><Icon name="export" />{t.saveAs}</button><button className="button primary" type="button" disabled={busy || !dirty} onClick={() => saveConfiguration(false)}><Icon name="save" />{t.save}</button></div>
          </div>
          <StyleEditor config={config} section={styleSection} setSection={setStyleSection} styleKey={styleKey} setStyleKey={setStyleKey} updateGroup={updateGroup} updateStyle={updateStyle} updateConfig={updateConfig} busy={busy} language={language} t={t} onReset={resetStyles} />
        </section>}

        {activePage === "document" && <section className={`document-page ${dragging ? "is-dragging" : ""}`} onDragOver={(event) => { event.preventDefault(); if (appSettings.files.dragDrop && !busy) { event.dataTransfer.dropEffect = "copy"; setDragging(true); } }} onDragLeave={(event) => { if (!event.currentTarget.contains(event.relatedTarget)) setDragging(false); }} onDrop={dropFiles}>
          {dragging && <div className="drop-hint">{st.drop}</div>}
          <div className="document-toolbar"><div><h2>{t.addFile}</h2><span className="file-count">{t.count(files.length)}</span></div><div className="document-add-actions"><button className="button outline" type="button" disabled={busy} onClick={addFolder}><Icon name="folder" />{st.addFolder}</button><button className="button primary" type="button" disabled={busy} onClick={addFiles}><Icon name="add" />{t.addFile}</button></div></div>
          {files.length === 0 ? <button className="empty-files" type="button" disabled={busy} onClick={addFiles}><Icon name="add" /><span>{t.addFile}</span></button> : <div className="file-table">
            {files.map((file, index) => <div className="document-row" key={file}><span className="file-order">{String(index + 1).padStart(2, "0")}</span><span className="file-type">MD</span><span className="document-name" title={file}>{displayName(file, file)}</span><button className="icon-button remove-file" type="button" disabled={busy} title={t.remove} aria-label={`${t.remove}: ${displayName(file, file)}`} onClick={() => removeFile(file)}><Icon name="remove" /></button></div>)}
          </div>}
          <div className="document-options">
            <div className="output-setting"><label>{t.outputDirectory}</label><div><Icon name="folder" /><span title={outputDirectory}>{outputDirectory || "—"}</span><button className="button outline" type="button" disabled={busy} onClick={chooseOutputDirectory}>{t.chooseDirectory}</button></div></div>
            <label className="toggle-row"><span>{t.numbering}</span><input type="checkbox" disabled={busy} checked={Boolean(config.numbering?.enabled)} onChange={(event) => updateGroup("numbering", "enabled", event.target.checked)} /><i /></label>
          </div>
          {!runtime?.ready && <button className="missing-runtime-link" type="button" onClick={() => openSettingsSection("runtime")}><Icon name="warning" />{t.runtimeMissing}<Icon name="next" /></button>}
          <div className="document-actions"><span className="progress-status">{busy && progress ? <><span>{progress.current}/{progress.total}</span><small>{progress.stage}</small></> : ""}</span>{busy ? <button className="button danger convert-button" type="button" onClick={cancelConversion}><Icon name="remove" />{language === "zh" ? "取消转换" : "Cancel"}</button> : <button className="button convert-button" type="button" disabled={!files.length || !outputDirectory || !runtime?.ready} onClick={convert}><Icon name="file" />{t.start}</button>}</div>
        </section>}

        {activePage === "settings" && settingsSection === "home" && <section className="settings-home">
          <button className="settings-entry" type="button" onClick={() => openSettingsSection("general")}><span className="settings-entry-icon"><Icon name="general" /></span><span className="settings-entry-copy"><strong>{t.generalSettings}</strong><small>{t.appearance} · {t.density}</small></span><Icon name="next" /></button>
          <button className="settings-entry" type="button" onClick={() => openSettingsSection("runtime")}><span className={`settings-entry-icon ${runtime?.ready ? "entry-ready" : "entry-missing"}`}><Icon name="environment" /></span><span className="settings-entry-copy"><strong>{t.runtimeSettings}</strong><small>{runtime?.ready ? t.ready : t.missing}</small></span><Icon name="next" /></button>
          <button className="settings-entry" type="button" onClick={() => { openSettingsSection("logs"); openLogs(); }}><span className="settings-entry-icon"><Icon name="results" /></span><span className="settings-entry-copy"><strong>{t.logSettings}</strong><small>{t.logCount(logRecords.length)}</small></span><Icon name="next" /></button>
          <button className="settings-entry" type="button" onClick={() => openSettingsSection("about")}><span className="settings-entry-icon"><Icon name="about" /></span><span className="settings-entry-copy"><strong>{t.aboutSettings}</strong><small>MD2DOCX · {t.appVersion}</small></span><Icon name="next" /></button>
        </section>}

        {activePage === "settings" && settingsSection === "config" && <section className="settings-subpage">
          <button className="settings-back" type="button" onClick={returnToSettingsHome}><Icon name="back" />{t.back}</button>
          <section className="settings-section"><div className="settings-section-heading"><h2>{t.configFile}</h2></div><div className="config-file-row"><Icon name="file" /><div className="config-file-name" title={configPath}>{configName}</div><div className="config-file-actions"><button className="button outline" type="button" disabled={busy} onClick={openConfiguration}>{t.open}</button><button className="button outline" type="button" disabled={busy} onClick={importConfiguration}>{t.importProfile}</button><button className="button outline" type="button" disabled={busy} onClick={() => saveConfiguration(true)}>{t.saveAs}</button><button className="button outline" type="button" disabled={busy} onClick={exportConfiguration}>{t.exportProfile}</button><button className="button primary" type="button" disabled={busy} onClick={() => saveConfiguration(false)}>{t.save}</button><button className="button subtle" type="button" disabled={busy || profileId === "default"} onClick={renameConfiguration}>{t.renameProfile}</button><button className="button subtle" type="button" disabled={busy || profileId === "default"} onClick={deleteConfiguration}>{t.deleteProfile}</button><button className="button subtle" type="button" disabled={busy} onClick={() => api.openProfilesDir()}>{t.openFolder}</button></div></div></section>
        </section>}

        {activePage === "settings" && settingsSection === "general" && <section className="settings-subpage">
          <button className="settings-back" type="button" onClick={returnToSettingsHome}><Icon name="back" />{t.back}</button>
          <section className="settings-section"><div className="settings-section-heading"><h2>{t.generalSettings}</h2></div>
            <div className="settings-form-grid">
              <label className="control-field"><span>{st.language}</span><select value={language} onChange={(event) => { setLanguage(event.target.value); updateAppSettings("general", { language: event.target.value }); }}><option value="zh">中文</option><option value="en">English</option></select></label>
              <label className="control-field"><span>{st.startup}</span><select value={appSettings.general.startupTask} onChange={(event) => updateAppSettings("general", { startupTask: event.target.value })}><option value="restore">{st.restore}</option><option value="clear">{st.clear}</option></select></label>
              <label className="control-field"><span>{t.appearance}</span><select value={appSettings.general.appearance} onChange={(event) => updateAppSettings("general", { appearance: event.target.value })}><option value="system">{t.followSystem}</option><option value="light">{t.light}</option><option value="dark">{t.dark}</option></select></label>
              <label className="control-field"><span>{t.density}</span><select value={appSettings.general.density} onChange={(event) => updateAppSettings("general", { density: event.target.value })}><option value="comfortable">{t.comfortable}</option><option value="compact">{t.compact}</option></select></label>
              <label className="control-field"><span>{st.windowSize}</span><select value={appSettings.general.startupWindowSize} onChange={(event) => updateAppSettings("general", { startupWindowSize: event.target.value })}><option value="small">{st.small}</option><option value="medium">{st.medium}</option><option value="large">{st.large}</option></select></label>
              <label className="control-field"><span>{st.serverPort}</span><input type="number" min="1024" max="65535" step="1" value={serverPortInput} onChange={(event) => setServerPortInput(event.target.value)} onBlur={commitServerPort} onKeyDown={(event) => { if (event.key === "Enter") event.currentTarget.blur(); }} /></label>
            </div>
            <div className="settings-toggle-list"><label className="toggle-row"><span>{t.launchMaximized}</span><input type="checkbox" checked={appSettings.general.launchMaximized} onChange={(event) => updateAppSettings("general", { launchMaximized: event.target.checked })} /><i /></label><label className="toggle-row"><span>{t.confirmClose}</span><input type="checkbox" checked={appSettings.general.confirmClose} onChange={(event) => updateAppSettings("general", { confirmClose: event.target.checked })} /><i /></label></div>
          </section>
          <ThemeColor value={appSettings.general.accentColor} language={language} onChange={(accentColor) => updateAppSettings("general", { accentColor })} />
          <section className="settings-section settings-extra"><div className="settings-section-heading"><h2>{t.conversionSettings}</h2></div>
            <div className="settings-form-grid">
              <label className="control-field"><span>{st.after}</span><select value={appSettings.conversion.afterSuccess} onChange={(event) => updateAppSettings("conversion", { afterSuccess: event.target.value })}><option value="none">{st.none}</option><option value="docx">{st.docx}</option><option value="folder">{st.folder}</option></select></label>
              <label className="control-field"><span>{st.images}</span><select value={appSettings.conversion.missingImages} onChange={(event) => updateAppSettings("conversion", { missingImages: event.target.value })}><option value="warning">{st.warning}</option><option value="stop">{st.stop}</option></select></label>
              <label className="control-field"><span>{t.conflictPolicy}</span><select value={appSettings.conversion.onConflict} onChange={(event) => updateAppSettings("conversion", { onConflict: event.target.value })}><option value="ask">{t.conflictAsk}</option><option value="overwrite">{t.conflictOverwrite}</option><option value="rename">{t.conflictRename}</option><option value="skip">{t.conflictSkip}</option><option value="fail">{t.conflictFail}</option></select></label>
              <label className="control-field"><span>{t.batchErrors}</span><select value={appSettings.conversion.batchErrors} onChange={(event) => updateAppSettings("conversion", { batchErrors: event.target.value })}><option value="continue">{t.batchContinue}</option><option value="stop">{t.batchStop}</option></select></label>
              <label className="control-field"><span>{t.defaultOutput}</span><div className="inline-path"><span title={appSettings.conversion.defaultOutputDirectory}>{appSettings.conversion.defaultOutputDirectory || "—"}</span><button className="button outline" type="button" onClick={chooseDefaultOutputDirectory}>{t.chooseDirectory}</button></div></label>
            </div>
            <div className="settings-toggle-list"><label className="toggle-row"><span>{t.preflight}</span><input type="checkbox" checked={appSettings.conversion.preflight} onChange={(event) => updateAppSettings("conversion", { preflight: event.target.checked })} /><i /></label></div>
          </section>
          <section className="settings-section settings-extra"><div className="settings-section-heading"><h2>{st.files}</h2></div><div className="settings-toggle-list"><label className="toggle-row"><span>{st.drag}</span><input type="checkbox" checked={appSettings.files.dragDrop} onChange={(event) => updateAppSettings("files", { dragDrop: event.target.checked })} /><i /></label><label className="toggle-row"><span>{st.recursive}</span><input type="checkbox" checked={appSettings.files.recursive} onChange={(event) => updateAppSettings("files", { recursive: event.target.checked })} /><i /></label></div></section>
          <section className="settings-section settings-extra"><div className="settings-section-heading"><h2>{st.operations}</h2></div><div className="settings-toggle-list"><label className="toggle-row"><span>{st.reset}</span><input type="checkbox" checked={appSettings.general.confirmReset} onChange={(event) => updateAppSettings("general", { confirmReset: event.target.checked })} /><i /></label><label className="toggle-row"><span>{st.shortcuts}</span><input type="checkbox" checked={appSettings.general.shortcutsEnabled} onChange={(event) => updateAppSettings("general", { shortcutsEnabled: event.target.checked })} /><i /></label></div><p className="settings-shortcuts">Ctrl+O · {t.addFile}　 Ctrl+S · {st.saveCurrent}　 Ctrl+Enter · {t.start}</p></section>
        </section>}

        {activePage === "settings" && settingsSection === "runtime" && <section className="settings-subpage">
          <button className="settings-back" type="button" onClick={returnToSettingsHome}><Icon name="back" />{t.back}</button>
          <section className="settings-section"><div className="settings-section-heading"><h2>{t.runtimeSettings}</h2><button className="icon-button" type="button" title={t.refresh} aria-label={t.refresh} onClick={refreshRuntime}><Icon name="refresh" /></button></div>
            {[['python', t.python, 'MD2DOCX_PYTHON · runtime/python'], ['pandoc', t.pandoc, 'MD2DOCX_PANDOC · runtime/pandoc'], ['pythonDocx', t.pythonDocx, 'python -m pip show python-docx'], ['lxml', t.lxml, 'python -m pip show lxml']].map(([name, label, fallback]) => { const item = runtime?.[name]; return <div className="runtime-row" key={name}><span className={`runtime-state ${item?.available ? "ready" : "missing"}`}>{item?.available ? <Icon name="check" /> : <Icon name="warning" />}</span><strong>{label}</strong><span className={`runtime-label ${item?.available ? "ready" : "missing"}`}>{item?.version || t.missing}</span><code title={item?.path}>{item?.path || fallback}</code></div>; })}
          </section>
        </section>}

        {activePage === "settings" && settingsSection === "logs" && <section className="settings-subpage">
          <button className="settings-back" type="button" onClick={returnToSettingsHome}><Icon name="back" />{t.back}</button>
          <section className="settings-section"><div className="settings-section-heading"><h2>{t.logSettings}</h2><button className="icon-button" type="button" title={t.refresh} aria-label={t.refresh} onClick={openLogs}><Icon name="refresh" /></button></div>
            <div className="log-settings-grid">
              <label className="control-field"><span>{st.limit}</span><select value={logSettings.displayLimit || 200} onChange={(event) => updateLogSettings({ displayLimit: Number(event.target.value) })}>{[200, 500, 1000].map((limit) => <option key={limit} value={limit}>{limit}</option>)}</select></label>
              <label className="toggle-row"><span>{t.logEnabled}</span><input type="checkbox" checked={Boolean(logSettings.enabled)} onChange={(event) => updateLogSettings({ enabled: event.target.checked })} /><i /></label>
              <label className="control-field"><span>{t.logLevel}</span><select value={logSettings.level} onChange={(event) => updateLogSettings({ level: event.target.value })}><option value="INFO">{t.logLevelInfo}</option><option value="DEBUG">{t.logLevelDebug}</option></select></label>
              <label className="control-field"><span>{t.retentionDays}</span><input type="number" min="1" max="3650" value={logSettings.retentionDays} onChange={(event) => updateLogSettings({ retentionDays: Number(event.target.value) || 7 })} /></label>
              <label className="toggle-row"><span>{t.autoCleanup}</span><input type="checkbox" checked={Boolean(logSettings.autoCleanup)} onChange={(event) => updateLogSettings({ autoCleanup: event.target.checked })} /><i /></label>
            </div>
            <div className="log-actions"><button className="button outline" type="button" onClick={() => api.openLogsDir?.()}>{t.openLogs}</button><button className="button outline" type="button" onClick={exportDiagnostics}>{t.exportDiagnostics}</button><button className="button subtle" type="button" onClick={clearLogs}>{t.clearLogs}</button></div>
            <div className="log-filters"><label className="control-field"><span>{language === "zh" ? "筛选级别" : "Filter level"}</span><select value={logLevelFilter} onChange={(event) => setLogLevelFilter(event.target.value)}><option value="all">{language === "zh" ? "全部级别" : "All levels"}</option>{["DEBUG", "INFO", "WARNING", "ERROR", "FATAL"].map((level) => <option key={level} value={level}>{level}</option>)}</select></label><label className="control-field"><span>{language === "zh" ? "任务" : "Job"}</span><select value={logJobFilter} onChange={(event) => setLogJobFilter(event.target.value)}><option value="all">{language === "zh" ? "全部任务" : "All jobs"}</option>{logJobIds.map((id) => <option key={id} value={id}>{id}</option>)}</select></label><small>{t.logCount(visibleLogs.length)}</small></div>
            <div className="log-list">{visibleLogs.length ? visibleLogs.map((record, index) => <div className={`log-row log-${String(record.level || "INFO").toLowerCase()}`} key={`${record.timestamp}-${index}`} title={[record.jobId, record.code, record.message].filter(Boolean).join(" · ")}><span>{record.level}</span><code>{record.timestamp}</code><strong>{record.stage || record.event}</strong><small>{record.code ? `${record.code} · ` : ""}{record.message || ""}</small></div>) : <div className="log-empty">{t.noLogs}</div>}</div>
          </section>
        </section>}

        {activePage === "settings" && settingsSection === "about" && <section className="settings-subpage">
          <button className="settings-back" type="button" onClick={returnToSettingsHome}><Icon name="back" />{t.back}</button>
          <section className="settings-section about-section"><div className="settings-section-heading"><h2>{t.aboutSettings}</h2></div>
            <div className="about-content"><span className="about-mark"><Icon name="brand" /></span><div><strong>MD2DOCX</strong><p>{t.title}</p><small>{t.appVersion}: 0.2.0</small><small>{t.schemaNote}</small></div></div>
          </section>
        </section>}

        {activePage === "results" && results.length === 0 && <section className="results-page results-empty"><Icon name="results" /><h2>{conversionTask?.status === "cancelled" ? (language === "zh" ? "转换已取消" : "Conversion cancelled") : (language === "zh" ? "暂无转换结果" : "No conversion results yet")}</h2><p>{conversionTask?.status === "cancelled" ? (language === "zh" ? `已处理 ${conversionTask.processed}/${conversionTask.total} 个文件。` : `${conversionTask.processed}/${conversionTask.total} files processed.`) : (language === "zh" ? "添加文档并转换后，结果会显示在这里。" : "Convert a document to see the results here.")}</p><button className="button outline" type="button" onClick={() => navigatePage("document")}>{language === "zh" ? "前往文档" : "Go to documents"}</button></section>}
        {activePage === "results" && results.length > 0 && <section className="results-page">
          <div className="results-header"><div><h2>{t.results}</h2><span>{t.resultCount(succeededCount, conversionTask?.total || results.length)}</span></div><div className="results-tools"><button className="button outline" type="button" onClick={() => api.openPath(outputDirectory)}>{t.openOutput}</button><button className="button primary" type="button" disabled={busy} onClick={convert}><Icon name="refresh" />{t.convertAgain}</button></div></div>
          {conversionTask?.unprocessed > 0 && <div className="stale-label"><Icon name="warning" />{language === "zh" ? `${conversionTask.unprocessed} 个文件未处理` : `${conversionTask.unprocessed} file(s) were not processed`}</div>}
          {resultsStale && <div className="stale-label"><Icon name="warning" />{t.unsaved}</div>}
          <div className="result-metrics"><div><strong>{succeededCount}</strong><span>{t.succeeded}</span></div><div><strong>{failedCount}</strong><span>{t.failed}</span></div><div><strong>{skippedCount}</strong><span>{t.skipped}</span></div><div><strong>{warningCount}</strong><span>{t.warnings(warningCount)}</span></div></div>
          <div className="results-diagnostics"><button className="button outline" type="button" onClick={exportDiagnostics}>{t.exportDiagnostics}</button><button className="button subtle" type="button" onClick={() => { openSettingsSection("logs"); openLogs(); }}>{t.logSettings}</button></div>
          <div className="result-list">{results.map((item) => <article className="result-row" key={`${item.source}-${item.output}`}><span className={`result-state ${item.ok ? "ready" : "missing"}`}>{item.ok ? <Icon name="check" /> : <Icon name="warning" />}</span><div className="result-main"><strong>{displayName(item.source, item.source)}</strong><span>{item.output || item.error}</span>{item.error && <p>{item.error}</p>}{item.errorObject && <p className="result-error-meta">{item.errorObject.code} · {item.errorObject.stage}{item.errorObject.suggestions?.length ? ` · ${item.errorObject.suggestions[0]}` : ""}</p>}{item.report?.warnings?.map((warning, index) => <p className="result-warning" key={`${item.source}-${index}`}>{warning.message}</p>)}</div><span className={`result-status ${item.ok ? "ready" : item.skipped ? "skipped" : "missing"}`}>{item.ok ? t.succeeded : item.skipped ? t.skipped : t.failed}</span>{item.ok && <button className="button subtle" type="button" onClick={() => api.openPath(item.output)}>{t.openDocx}<Icon name="next" /></button>}</article>)}</div>
        </section>}
      </main>
    </section>
    <ToastViewport toasts={toasts} onDismiss={dismissToast} />
    <ConfirmationDialog confirmation={confirmation} closeLabel={t.close} onFinish={finishConfirmation} />
    <ProfileDialog action={profileAction} actionText={profileActionText} text={t} onChange={updateProfileAction} onComplete={completeProfileAction} onClose={() => setProfileAction(null)} />
  </div>;
}

