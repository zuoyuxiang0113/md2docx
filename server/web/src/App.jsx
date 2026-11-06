import React, { useEffect, useRef, useState } from 'react';
import StyleEditor from './components/StyleEditor.jsx';
import defaults from './config/defaults.json';
import messages from './messages.js';
import { request, jsonPost, relativePath, validateFiles, submissionForm, terminal, downloadArtifact, saveBlob } from './api.js';

const t = messages.zh;
const labels = { queued: '排队中', running: '转换中', cancelling: '正在取消', succeeded: '转换成功', partially_succeeded: '部分完成', failed: '转换失败', cancelled: '已取消', timed_out: '已超时', pending: '等待中', skipped: '已跳过', unprocessed: '未处理' };
const phases = { queued: '等待处理', preflight: '检查文档', pandoc: '转换文档', postprocess: '应用排版', validate: '校验结果', 'write-output': '生成文件', completed: '已完成' };
const readLocal = (key, fallback) => { try { return JSON.parse(localStorage.getItem(key)) ?? fallback; } catch { return fallback; } };
const writeLocal = (key, value) => { try { localStorage.setItem(key, JSON.stringify(value)); } catch { /* Local storage can be disabled; conversion still works. */ } };
const formatBytes = n => n >= 1048576 ? `${(n / 1048576).toFixed(1)} MB` : `${Math.ceil(n / 1024)} KB`;
function merge(base, extra) {
  if (!extra || typeof extra !== 'object' || Array.isArray(extra)) return structuredClone(base);
  return Object.fromEntries(Object.entries(base).map(([key, value]) => [key,
    value && typeof value === 'object' && !Array.isArray(value) ? merge(value, extra[key]) : extra[key] ?? value,
  ]));
}
const initialProfile = () => merge(defaults, readLocal('md2docx-cloud-profile', null));

export default function App() {
  const [page, setPage] = useState('convert');
  const [files, setFiles] = useState([]);
  const [mode, setMode] = useState('files');
  const [text, setText] = useState('');
  const [textName, setTextName] = useState('文档.md');
  const [config, setConfig] = useState(initialProfile);
  const [section, setSection] = useState('body');
  const [styleKey, setStyleKey] = useState('normal');
  const [caps, setCaps] = useState(null);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  const [sending, setSending] = useState(false);
  const [job, setJob] = useState(null);
  const [pollingPaused, setPollingPaused] = useState(false);
  const [working, setWorking] = useState(false);
  const [batchErrors, setBatchErrors] = useState('continue');
  const [missingImages, setMissingImages] = useState('warning');
  const [profiles, setProfiles] = useState(() => readLocal('md2docx-cloud-profiles', {}));
  const [profileName, setProfileName] = useState('我的配置');
  const fileInput = useRef(null), folderInput = useRef(null), profileInput = useRef(null);
  const retrySubmission = useRef(null), sendingLock = useRef(false);
  const active = job && !terminal(job.status);
  const busy = sending || active || working;

  function report(err) {
    const fields = err.fields?.map(f => `${f.path}：${f.message}`).join('；');
    setError(`${err.message || '操作失败'}${fields ? `（${fields}）` : ''}${err.requestId ? ` · 请求编号 ${err.requestId}` : ''}`);
  }
  async function loadService() {
    try { setError(''); setCaps(await request('/v1/capabilities')); } catch (err) { report(err); }
  }
  useEffect(() => {
    loadService();
    const id = readLocal('md2docx-cloud-last-job', null);
    if (id) request(`/v1/jobs/${encodeURIComponent(id)}`).then(setJob).catch(err => {
      if ([401, 404, 410].includes(err.status)) writeLocal('md2docx-cloud-last-job', null);
      else report(err);
    });
  }, []);
  useEffect(() => { writeLocal('md2docx-cloud-profile', config); }, [config]);
  useEffect(() => {
    if (!job || terminal(job.status) || pollingPaused) return;
    let disposed = false, timer, failures = 0;
    const controller = new AbortController();
    async function poll() {
      try {
        const next = await request(`/v1/jobs/${encodeURIComponent(job.jobId)}`, { signal: controller.signal });
        if (disposed) return;
        failures = 0; setJob(next);
        if (!terminal(next.status)) timer = setTimeout(poll, 1600);
      } catch (err) {
        if (disposed) return;
        if ([401, 404, 410].includes(err.status) || ++failures >= 5) { report(err); setPollingPaused(true); return; }
        timer = setTimeout(poll, Math.max(err.retryAfter || 0, Math.min(15, failures * 3)) * 1000);
      }
    }
    timer = setTimeout(poll, 1000);
    return () => { disposed = true; controller.abort(); clearTimeout(timer); };
  }, [job?.jobId, pollingPaused]);

  function changeGroup(path, key, value) {
    setConfig(previous => {
      const next = structuredClone(previous);
      const group = path.split('.').reduce((item, part) => item[part], next);
      group[key] = value;
      return next;
    });
  }
  function addFiles(selected) {
    if (busy || retrySubmission.current) return;
    const supported = Array.from(selected).filter(f => /\.(md|markdown|png|jpe?g)$/i.test(f.name));
    const unsupported = selected.length - supported.length;
    setFiles(previous => {
      const next = new Map(previous.map(f => [relativePath(f).toLowerCase(), f]));
      supported.forEach(f => next.set(relativePath(f).toLowerCase(), f));
      return [...next.values()];
    });
    if (unsupported) setNotice(`已忽略 ${unsupported} 个不支持的文件，只接受 Markdown、PNG 和 JPEG。`);
    setError('');
  }
  async function ensureSession() {
    try { await request('/v1/sessions/current'); }
    catch (err) {
      if (err.status !== 401) throw err;
      await request('/v1/sessions', { method: 'POST' });
      await request('/v1/sessions/current');
    }
  }
  async function submit(retry = false) {
    if (sendingLock.current || active) return;
    sendingLock.current = true;
    setError(''); setNotice(''); setSending(true);
    try {
      let pending = retry ? retrySubmission.current : null;
      if (!pending) {
        if (!caps?.conversionReady) throw new Error('服务暂未就绪，请先重新检查连接。');
        const documents = mode === 'text'
          ? [new File([text], /\.(md|markdown)$/i.test(textName) ? textName : `${textName || '文档'}.md`, { type: 'text/markdown' })]
          : files;
        if (mode === 'text' && !text.trim()) throw new Error('请先输入 Markdown 内容。');
        validateFiles(documents, caps.limits);
        await jsonPost('/v1/config/validate', { config: { profile: config } });
        await ensureSession();
        // No crypto.randomUUID dependency: LAN HTTP is not a secure browser context.
        const bytes = crypto.getRandomValues(new Uint8Array(24));
        const key = Array.from(bytes, b => b.toString(16).padStart(2, '0')).join('');
        pending = { key, form: submissionForm(documents, config, { missingImages, batchErrors }) };
        retrySubmission.current = pending;
      }
      const next = await request('/v1/jobs', { method: 'POST', headers: { 'Idempotency-Key': pending.key }, body: pending.form });
      retrySubmission.current = null;
      writeLocal('md2docx-cloud-last-job', next.jobId);
      setJob(next); setPollingPaused(false); setPage('convert');
    } catch (err) {
      // Keep an uncertain submission's key and bytes for a safe retry in this tab.
      if (err.status && err.status < 500 && err.status !== 429) retrySubmission.current = null;
      report(err);
    } finally { sendingLock.current = false; setSending(false); }
  }
  async function action(kind) {
    if (!job || working) return;
    setWorking(true); setError('');
    try {
      if (kind === 'delete') {
        if (!window.confirm('删除云端的任务和结果文件？已下载到电脑的文件不受影响。')) return;
        await request(`/v1/jobs/${job.jobId}`, { method: 'DELETE' });
        writeLocal('md2docx-cloud-last-job', null); setJob(null); setNotice('云端任务和结果文件已删除。');
      } else {
        setJob(await request(`/v1/jobs/${job.jobId}/cancel`, { method: 'POST' }));
        setPollingPaused(false);
      }
    } catch (err) { report(err); } finally { setWorking(false); }
  }
  async function download(item) {
    setWorking(true); setError('');
    try { await downloadArtifact(job.jobId, item.artifact); setNotice('已交给浏览器保存，请查看浏览器下载记录。'); }
    catch (err) { report(err); } finally { setWorking(false); }
  }
  async function importProfile(file) {
    if (!file) return;
    try {
      if (file.size > 60000) throw new Error('配置文件过大，请选择小于 60 KB 的 JSON 配置。');
      const profile = JSON.parse(await file.text());
      const result = await jsonPost('/v1/config/validate', { config: { profile } });
      setConfig(result.normalizedConfig); setNotice('配置已导入，并通过服务校验。'); setError('');
    } catch (err) { report(err); }
  }
  function saveProfile() {
    const name = profileName.trim();
    if (!name || name.length > 64) { setError('配置名称应为 1–64 个字符。'); return; }
    const next = { ...profiles, [name]: config };
    setProfiles(next); writeLocal('md2docx-cloud-profiles', next); setNotice('配置已保存在当前浏览器。');
  }
  const locked = busy || Boolean(retrySubmission.current);
  const limits = caps?.limits;
  return <div className="cloud-app">
    <aside className="cloud-sidebar">
      <a className="cloud-brand" href="/">M<span>MD2DOCX<small>在线转换</small></span></a>
      <nav aria-label="主导航">{[['convert', '文档转换'], ['styles', '排版配置'], ['help', '使用说明']].map(([id, title]) => <button key={id} aria-current={page === id ? 'page' : undefined} className={page === id ? 'selected' : ''} onClick={() => setPage(id)}>{title}<span>↗</span></button>)}</nav>
      <div className="cloud-sidebar-note"><strong>免费 · 免登录</strong><p>转换在服务器完成<br />无需安装转换环境</p></div>
    </aside>
    <main className="cloud-main">
      <header className="cloud-topbar"><span>Markdown → Word</span><span className={caps?.conversionReady ? 'connection ready' : 'connection'}>{caps ? caps.conversionReady ? '服务已就绪' : '服务暂不可用' : '正在连接服务'}<button onClick={loadService} aria-label="重新检查服务连接">↻</button></span></header>
      <div className="cloud-content">
        <div className="cloud-heading"><div><span className="cloud-eyebrow">{page === 'styles' ? 'YOUR DOCUMENT, YOUR STYLE' : page === 'help' ? 'GETTING STARTED' : 'MARKDOWN TO DOCX'}</span><h1>{page === 'styles' ? '把排版调成你喜欢的样子' : page === 'help' ? '从 Markdown 到 Word' : '写作交给你，排版交给我们'}</h1><p>{page === 'styles' ? '沿用桌面版的样式配置，调整后直接用于下一次转换。' : page === 'help' ? '上传、转换、下载，三个步骤完成文档交付。' : '上传 Markdown，保留表格、图片与公式，生成可编辑的 Word 文档。'}</p></div></div>
        {error && <div className="cloud-alert error" role="alert">{error}<button aria-label="关闭错误提示" onClick={() => setError('')}>×</button></div>}
        {notice && <div className="cloud-alert" role="status">{notice}<button aria-label="关闭提示" onClick={() => setNotice('')}>×</button></div>}
        {retrySubmission.current && !sending && <div className="cloud-alert">提交结果尚未确认。请使用同一份请求重试，避免重复创建任务。<button onClick={() => submit(true)} disabled={busy}>重试原提交</button><button disabled={busy} onClick={() => { if (window.confirm('放弃后重新提交可能产生重复任务。确定放弃？')) { retrySubmission.current = null; setNotice('已放弃原提交，请检查任务结果后再重新转换。'); } }}>放弃</button></div>}
        {page === 'convert' && <>
          <section className="cloud-card">
            <div className="cloud-card-heading"><h2>01 <span>添加文档</span></h2><div className="cloud-segment"><button disabled={locked} className={mode === 'files' ? 'selected' : ''} onClick={() => setMode('files')}>上传文件</button><button disabled={locked} className={mode === 'text' ? 'selected' : ''} onClick={() => setMode('text')}>粘贴文本</button></div></div>
            {mode === 'files' ? <>
              <div className="cloud-drop" onDragOver={e => e.preventDefault()} onDrop={e => { e.preventDefault(); addFiles(e.dataTransfer.files); }}>
                <div className="cloud-upload-icon">↑</div><h3>将 Markdown 和图片拖到这里</h3><p>也可以选择文件，或选择包含文档与图片的文件夹</p><div className="cloud-actions"><button className="button primary" disabled={locked} onClick={() => fileInput.current.click()}>选择文件</button><button className="button outline" disabled={locked} onClick={() => folderInput.current.click()}>选择文件夹</button></div>
                <input ref={fileInput} hidden type="file" multiple accept=".md,.markdown,.png,.jpg,.jpeg" onChange={e => { addFiles(e.target.files); e.target.value = ''; }} />
                <input ref={folderInput} hidden type="file" multiple webkitdirectory="" onChange={e => { addFiles(e.target.files); e.target.value = ''; }} />
              </div>
              {files.length > 0 && <ul className="cloud-files">{files.map((file, index) => <li key={relativePath(file)}><span className="cloud-file-type">{/\.(md|markdown)$/i.test(file.name) ? 'MD' : 'IMG'}</span><span className="cloud-file-name">{relativePath(file)}</span><small>{formatBytes(file.size)}</small><button disabled={locked} aria-label={`移除 ${relativePath(file)}`} onClick={() => setFiles(previous => previous.filter((_, i) => i !== index))}>×</button></li>)}</ul>}
              <p className="cloud-hint">含图片时，建议选择整个文件夹以保留相对路径。只上传文件时，请将 Markdown 与图片放在同一级目录。</p>
            </> : <div className="cloud-text-input"><label>文件名<input value={textName} disabled={locked} onChange={e => setTextName(e.target.value)} /></label><label>Markdown 内容<textarea value={text} disabled={locked} placeholder={'# 文档标题\n\n在这里粘贴 Markdown…'} onChange={e => setText(e.target.value)} /></label><button className="button subtle" disabled={locked} onClick={() => { setTextName('转换示例.md'); setText('# 2026 年度报告\n\n这是一份 **Markdown** 转换示例。\n\n| 项目 | 数量 |\n| --- | --- |\n| 文档 | 1 |\n\n公式：$x^2 + y^2 = z^2$\n\n```python\nprint("Hello, Word!")\n```\n'); }}>填入示例</button><p className="cloud-hint">粘贴模式用于纯文本、表格、代码与公式。含本地图片的文档请使用上传模式。</p></div>}
          </section>
          <section className="cloud-card"><div className="cloud-card-heading"><h2>02 <span>确认转换设置</span></h2><button className="button subtle" onClick={() => setPage('styles')}>编辑排版 →</button></div>
            <div className="cloud-options"><label>图片缺失时<select value={missingImages} disabled={locked} onChange={e => setMissingImages(e.target.value)}><option value="warning">继续并提示</option><option value="stop">停止当前文档</option></select></label><label>批量出错时<select disabled={locked} value={batchErrors} onChange={e => setBatchErrors(e.target.value)}><option value="continue">继续其他文档</option><option value="stop">停止后续文档</option></select></label><div className="cloud-style-summary"><strong>{config.page.preset} · {config.styles.normal.eastAsia} · {config.styles.normal.sizePt} pt</strong><span>正文样式 · {config.numbering.enabled ? '自动编号已开启' : '自动编号已关闭'}</span></div></div>
            {config.numbering.stripExisting && <p className="cloud-warning">当前配置会清理标题已有编号，可能影响标题中的年份等数字。需要保留原文数字，可在「排版配置 → 编号」关闭「去除已有编号」。</p>}
            <div className="cloud-submit"><span>{limits ? `每次最多 ${limits.maxDocuments} 份文档 · 单份 Markdown ${formatBytes(limits.maxMarkdownBytes)} · 总上传 ${formatBytes(limits.maxRequestBytes)}` : '正在读取服务限制…'}</span><button className="button primary" disabled={locked || !caps?.conversionReady} onClick={() => submit()}>{sending ? '正在上传…' : active ? '正在处理任务…' : '开始转换 →'}</button></div>
          </section>
          {job && <section className="cloud-card" aria-live="polite"><div className="cloud-card-heading"><h2>03 <span>{labels[job.status] || job.status}</span></h2><div className="cloud-actions">{active ? <button className="button outline" disabled={working || job.status === 'cancelling'} onClick={() => action('cancel')}>取消任务</button> : <button className="button subtle" disabled={working} onClick={() => action('delete')}>删除云端结果</button>}</div></div>
            <p className="cloud-hint">成功 {job.summary.succeeded} / {job.summary.total} · 失败 {job.summary.failed} · 未处理 {job.summary.unprocessed} · 任务 {job.jobId}</p>
            {pollingPaused && active && <button className="button outline" onClick={() => { setError(''); setPollingPaused(false); }}>恢复查询任务</button>}
            <div className="cloud-results">{job.items.map(item => <article key={item.documentId}><span className={`cloud-result-symbol ${item.status === 'succeeded' ? 'ok' : ''}`}>{item.status === 'succeeded' ? '✓' : item.status === 'failed' ? '!' : '·'}</span><div><strong>{item.path}</strong><p>{labels[item.status] || item.status}{item.stage ? ` · ${phases[item.stage] || item.stage}` : ''}{item.artifact ? ` · ${formatBytes(item.artifact.sizeBytes)}` : ''}</p>{item.error && <p className="cloud-warning">{item.error.message}（{item.error.code}）</p>}{item.warnings?.map((warning, i) => <p className="cloud-warning" key={i}>{warning.message || warning.code}</p>)}</div>{item.artifact && <button className="button outline" disabled={working} onClick={() => download(item)}>下载 DOCX</button>}</article>)}</div>
            {job.error && <p className="cloud-warning">{job.error.message}</p>}
            {job.expiresAt && <p className="cloud-hint">结果保留至 {new Date(job.expiresAt).toLocaleString()}。关闭网页不会自动取消任务；同一浏览器刷新后可恢复最近任务。</p>}
          </section>}
        </>}
        {page === 'styles' && <section className="cloud-card">
          <div className="cloud-profile-toolbar"><label>浏览器配置<select disabled={locked} defaultValue="" onChange={e => { if (profiles[e.target.value]) setConfig(merge(defaults, profiles[e.target.value])); e.target.value = ''; }}><option value="">选择已保存配置</option>{Object.keys(profiles).map(name => <option key={name} value={name}>{name}</option>)}</select></label><label>配置名称<input value={profileName} disabled={locked} maxLength={64} onChange={e => setProfileName(e.target.value)} /></label><button className="button outline" disabled={locked} onClick={saveProfile}>保存配置</button><button className="button subtle" disabled={locked || !Object.hasOwn(profiles, profileName)} onClick={() => { if (window.confirm(`删除浏览器中的配置「${profileName}」？`)) { const next = { ...profiles }; delete next[profileName]; setProfiles(next); writeLocal('md2docx-cloud-profiles', next); } }}>删除配置</button><button className="button subtle" disabled={locked} onClick={() => profileInput.current.click()}>导入 JSON</button><button className="button subtle" onClick={() => saveBlob(new Blob([JSON.stringify(config, null, 2)], { type: 'application/json' }), 'md2docx-profile.json')}>导出 JSON</button><input ref={profileInput} hidden type="file" accept=".json" onChange={e => { importProfile(e.target.files[0]); e.target.value = ''; }} /></div>
          <StyleEditor config={config} section={section} setSection={setSection} styleKey={styleKey} setStyleKey={setStyleKey} updateGroup={changeGroup} updateStyle={(key, value) => changeGroup(`styles.${section === 'body' ? 'normal' : styleKey}`, key, value)} updateConfig={patch => setConfig(previous => ({ ...previous, ...patch }))} busy={locked} language="zh" t={t} onReset={() => { if (window.confirm('恢复当前分类的默认排版？')) { const groups = { page: ['page'], body: ['styles.normal'], heading: [`styles.${styleKey}`], table: ['styles.table'], code: ['styles.codeBlock'], image: ['options.images', 'styles.caption'], math: ['options.math', 'options.mathFallback'], numbering: ['numbering'] }; setConfig(previous => { const next = structuredClone(previous); for (const path of groups[section]) { const parts = path.split('.'); const key = parts.pop(); const target = parts.reduce((item, part) => item[part], next); target[key] = structuredClone(path.split('.').reduce((item, part) => item[part], defaults)); } return next; }); } }} />
          <details className="cloud-advanced"><summary>完整配置（包含引用等高级字段）</summary><p>导入和导出兼容 schemaVersion 2 的配置。以下内容只读，高级字段可编辑 JSON 后重新导入。</p><pre>{JSON.stringify(config, null, 2)}</pre></details>
          <p className="cloud-hint">样式预览仅供参考，最终效果请以下载的 Word 文档为准。配置保存在当前浏览器，不会跨设备同步。</p>
        </section>}
        {page === 'help' && <section className="cloud-card cloud-help"><h2>如何转换</h2><ol><li>添加 .md 或 .markdown 文件，也可以直接粘贴内容。</li><li>在「排版配置」调整页面、字体、标题、表格、代码、图片、公式及编号。</li><li>点击「开始转换」，完成后逐份下载 DOCX。</li></ol><h2>文档里的图片怎么办？</h2><p>支持 PNG / JPEG。选择文件夹会保留子目录，适合引用 images/chart.png 的文档。拖放区支持文件；文件夹请使用「选择文件夹」。服务器不会访问电脑上的绝对路径，也不会联网抓取远程图片。不支持 SVG、动画图片、ZIP 和 Mermaid 渲染。</p><h2>文件与隐私</h2><p>文档会上传到服务器。输入文件在任务结束后清理；转换结果默认保留 {limits ? Math.round(limits.outputRetentionSeconds / 3600) : 24} 小时，也可以在结果区主动删除。系统自动使用临时会话保护任务，无需注册或填写 Key。请使用同一浏览器访问结果；清除 Cookie 或更换地址后可能无法恢复任务。</p><h2>刷新与重试</h2><p>同一浏览器刷新后会尝试恢复最近任务，尚未提交的文件和粘贴文本不会保存。关闭网页不会取消正在运行的任务。网络中断时请优先重试原提交，避免重复任务。</p><h2>Agent 调用</h2><p>Agent 与网页共用 HTTP API，无需安装 Python 或 Pandoc。接口定义：<a href="/openapi.json" target="_blank" rel="noreferrer">OpenAPI 3.1</a>。临时会话仅用于保护本次任务的访问。</p></section>}
        <footer className="cloud-footer"><span>MD2DOCX · 让 Markdown 成为可交付的文档</span><span>免费转换 · 结果请及时下载</span></footer>
      </div>
    </main>
  </div>;
}
