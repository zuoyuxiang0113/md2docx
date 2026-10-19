export function createBrowserApi({ defaults, appDefaults, mergeDefaults, mergeAppSettings, profileIdPattern }) {
  const profileKey = "md2docx-browser-profiles-v2";
  const draftKey = "md2docx-browser-drafts-v2";
  const settingsKey = "md2docx-browser-settings-v2";
  const settingsDraftKey = "md2docx-browser-settings-draft-v2";
  const readStore = (key, fallback) => { try { return JSON.parse(localStorage.getItem(key)) || fallback; } catch { return fallback; } };
  const writeStore = (key, value) => localStorage.setItem(key, JSON.stringify(value));
  const cleanProject = (value, id) => {
    const project = mergeDefaults({ ...value, id, updatedAt: new Date().toISOString() });
    delete project.files; delete project.outputDirectory; delete project.projectPath; delete project.name; delete project.elements;
    return project;
  };
  const profiles = () => {
    const items = readStore(profileKey, {});
    if (!items.default) { items.default = cleanProject(defaults, "default"); writeStore(profileKey, items); }
    return items;
  };
  const profileResult = (project) => ({ ...project, files: [], outputDirectory: "", projectPath: `browser://profiles/${project.id}.json` });
  const pickJson = () => new Promise((resolve, reject) => {
    const input = document.createElement("input"); input.type = "file"; input.accept = ".json,application/json";
    input.onchange = async () => { const file = input.files?.[0]; if (!file) return resolve(null); try { resolve({ fileName: file.name, data: JSON.parse(await file.text()) }); } catch (error) { reject(error); } };
    input.click();
  });
  writeStore(settingsDraftKey, { dirty: false, updatedAt: new Date().toISOString(), settings: mergeAppSettings(readStore(settingsKey, appDefaults)) });
  return {
    setLanguage: () => {}, onLanguage: () => () => {}, onMenuAction: () => () => {}, popupAppMenu: async () => {}, onProgress: () => () => {},
    selectFiles: async () => [], selectOutputDir: async () => null,
    loadTaskState: async () => readStore("md2docx-browser-task", null), saveTaskState: async (value) => { writeStore("md2docx-browser-task", value); return true; }, listProfileBackups: async () => [],
    listProfiles: async () => Object.values(profiles()).map((item) => ({ id: item.id, updatedAt: item.updatedAt, valid: true })).sort((a, b) => a.id.localeCompare(b.id)),
    loadProfile: async (id) => { const item = profiles()[id]; return item ? profileResult(item) : null; },
    saveProfile: async (value) => { const items = profiles(); const project = cleanProject(value, value.id); items[project.id] = project; writeStore(profileKey, items); return profileResult(project); },
    saveProfileAs: async (value, id) => { if (!profileIdPattern.test(id)) throw new Error("配置 ID 只能包含小写字母、数字、下划线和短横线。"); const items = profiles(); if (items[id]) throw new Error("目标配置 ID 已存在。"); const project = cleanProject(value, id); items[id] = project; writeStore(profileKey, items); return profileResult(project); },
    exportProfile: async (value) => { const project = cleanProject(value, value.id); const blob = new Blob([`${JSON.stringify(project, null, 2)}\n`], { type: "application/json" }); const url = URL.createObjectURL(blob); const link = document.createElement("a"); link.href = url; link.download = `${project.id}.json`; link.click(); URL.revokeObjectURL(url); return { ...profileResult(project), projectPath: link.download }; },
    renameProfile: async (oldId, newId) => { if (!profileIdPattern.test(newId)) throw new Error("配置 ID 只能包含小写字母、数字、下划线和短横线。"); const items = profiles(); if (!items[oldId]) throw new Error("配置不存在。"); if (items[newId]) throw new Error("目标配置 ID 已存在。"); const project = cleanProject(items[oldId], newId); delete items[oldId]; items[newId] = project; writeStore(profileKey, items); const drafts = readStore(draftKey, {}); if (drafts[oldId]) { drafts[newId] = { ...drafts[oldId], id: newId, config: cleanProject(drafts[oldId].config, newId) }; delete drafts[oldId]; writeStore(draftKey, drafts); } return profileResult(project); },
    importProfile: async (options = {}) => { const picked = options.sourceData ? { fileName: options.fileName, data: options.sourceData } : await pickJson(); if (!picked) return null; const sourceId = String(picked.fileName || "profile.json").replace(/\.json$/i, ""); const id = String(options.id || (profileIdPattern.test(sourceId) && sourceId !== "default" ? sourceId : "imported-profile")); const items = profiles(); if (items[id] && !options.overwrite) return { conflict: true, id, fileName: picked.fileName, sourceData: picked.data }; const project = cleanProject(picked.data, id); items[id] = project; writeStore(profileKey, items); return profileResult(project); },
    deleteProfile: async (id) => { const items = profiles(); if (id === "default") throw new Error("默认配置不能删除。"); delete items[id]; writeStore(profileKey, items); const drafts = readStore(draftKey, {}); delete drafts[id]; writeStore(draftKey, drafts); return true; },
    openProfilesDir: async () => false,
    listEditingDrafts: async () => Object.values(readStore(draftKey, {})).map(({ id, dirty, updatedAt }) => ({ id, dirty, updatedAt })),
    loadEditingDraft: async (id) => readStore(draftKey, {})[id] || null,
    prepareEditingDraft: async (id) => { const drafts = readStore(draftKey, {}); if (drafts[id]?.dirty) return drafts[id]; const project = profiles()[id]; if (!project) return null; drafts[id] = { id, dirty: false, updatedAt: new Date().toISOString(), config: project, files: drafts[id]?.files || [], outputDirectory: drafts[id]?.outputDirectory || "" }; writeStore(draftKey, drafts); return drafts[id]; },
    saveEditingDraft: async (id, value) => { const drafts = readStore(draftKey, {}); drafts[id] = { id, dirty: value.dirty === true, updatedAt: new Date().toISOString(), config: cleanProject(value.config || value, id), files: value.files || [], outputDirectory: value.outputDirectory || "" }; writeStore(draftKey, drafts); return true; },
    deleteEditingDraft: async (id) => { const drafts = readStore(draftKey, {}); delete drafts[id]; writeStore(draftKey, drafts); return true; },
    getRuntimeStatus: async () => ({ ready: false, python: { available: false }, pandoc: { available: false } }),
    getAppSettings: async () => mergeAppSettings(readStore(settingsKey, appDefaults)),
    saveAppSettings: async (next) => { const current = readStore(settingsKey, {}); const saved = mergeAppSettings({ ...current, ...next, general: { ...(current.general || {}), ...(next.general || {}) }, conversion: { ...(current.conversion || {}), ...(next.conversion || {}) }, logs: { ...(current.logs || {}), ...(next.logs || {}) }, files: { ...(current.files || {}), ...(next.files || {}) } }); writeStore(settingsKey, saved); return saved; },
    loadAppSettingsDraft: async () => readStore(settingsDraftKey, null),
    saveAppSettingsDraft: async (next) => { const existing = readStore(settingsDraftKey, null); const base = existing?.settings || readStore(settingsKey, appDefaults); const settings = mergeAppSettings({ ...base, ...next, general: { ...(base.general || {}), ...(next.general || {}) }, conversion: { ...(base.conversion || {}), ...(next.conversion || {}) }, logs: { ...(base.logs || {}), ...(next.logs || {}) }, files: { ...(base.files || {}), ...(next.files || {}) } }); const draft = { dirty: true, updatedAt: new Date().toISOString(), settings }; writeStore(settingsDraftKey, draft); return draft; },
    commitAppSettingsDraft: async (next) => { const settings = mergeAppSettings(next || readStore(settingsDraftKey, null)?.settings || readStore(settingsKey, appDefaults)); writeStore(settingsKey, settings); writeStore(settingsDraftKey, { dirty: false, updatedAt: new Date().toISOString(), settings }); return settings; },
    discardAppSettingsDraft: async () => { const settings = mergeAppSettings(readStore(settingsKey, appDefaults)); writeStore(settingsDraftKey, { dirty: false, updatedAt: new Date().toISOString(), settings }); return settings; },
    setTitlebarTheme: async () => false,
    convertFiles: async (payload) => ({ status: "failed", total: payload.files.length, processed: payload.files.length, unprocessed: 0, items: payload.files.map((source) => ({ source, ok: false, error: "Electron bridge unavailable" })) }),
    cancelConversion: async () => false,
    openPath: async () => {}, onConfirmationRequest: () => () => {}, respondConfirmation: () => {}, onCloseRequest: () => () => {}, allowClose: () => {}, cancelClose: () => {},
  };
}
