// Same-origin HTTP only. The anonymous session remains in an HttpOnly cookie.
export async function request(path, options = {}) {
  const response = await fetch(path, { credentials: 'same-origin', ...options });
  if (response.status === 204) return null;
  const body = await response.json().catch(() => null);
  if (!response.ok || !body?.success) {
    const error = new Error(body?.error?.message || `服务请求失败（HTTP ${response.status}）`);
    error.status = response.status;
    error.code = body?.error?.code;
    error.fields = body?.error?.fields || [];
    error.requestId = body?.requestId;
    error.retryAfter = Number(response.headers.get('Retry-After')) || 5;
    throw error;
  }
  return body.data;
}

export const jsonPost = (path, body) => request(path, {
  method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body),
});

export function relativePath(file) {
  return file.webkitRelativePath || file.name;
}

export function validateFiles(files, limits) {
  const paths = new Set();
  let documents = 0, resources = 0, total = 0;
  for (const file of files) {
    const path = relativePath(file);
    if (/^[a-z]:/i.test(path) || path.includes('\\') || path.split('/').some(x => !x || x === '.' || x === '..') || /[\x00-\x1f\x7f]/.test(path)) throw new Error(`文件路径不支持：${path}`);
    if (paths.has(path.toLowerCase())) throw new Error(`文件路径重复：${path}`);
    paths.add(path.toLowerCase());
    if (/\.(md|markdown)$/i.test(path)) {
      documents++;
      if (file.size > limits.maxMarkdownBytes) throw new Error(`Markdown 超过大小限制：${path}`);
    } else if (/\.(png|jpe?g)$/i.test(path)) {
      resources++;
      if (file.size > limits.maxImageBytes) throw new Error(`图片超过大小限制：${path}`);
    } else throw new Error(`不支持的文件：${path}，请上传 Markdown、PNG 或 JPEG。`);
    total += file.size;
  }
  if (!documents) throw new Error('请至少添加一个 Markdown 文件。');
  if (documents > limits.maxDocuments) throw new Error(`每次最多转换 ${limits.maxDocuments} 份文档。`);
  if (resources > limits.maxResources) throw new Error(`每次最多上传 ${limits.maxResources} 张图片。`);
  // Multipart headers also count; the server remains authoritative about the exact total.
  if (total > limits.maxRequestBytes) throw new Error('上传文件总大小超过服务限制。');
}

export function submissionForm(files, profile, execution) {
  const form = new FormData();
  const manifest = { documents: [], resources: [], config: { profile }, execution };
  files.forEach((file, index) => {
    const part = `file${index}`;
    const path = relativePath(file);
    if (/\.(md|markdown)$/i.test(path)) manifest.documents.push({ id: `doc${index}`, path, part });
    else manifest.resources.push({ path, part });
    form.append(part, file, file.name);
  });
  form.append('request', JSON.stringify(manifest));
  return form;
}

export async function verifyArtifact(blob, artifact, digest = globalThis.crypto?.subtle) {
  if (blob.size !== artifact.sizeBytes) throw new Error('下载文件不完整，请重新下载。');
  // Web Crypto is unavailable on HTTP LAN origins. HTTPS additionally verifies SHA-256.
  if (digest) {
    const hash = await digest.digest('SHA-256', await blob.arrayBuffer());
    const hex = Array.from(new Uint8Array(hash), b => b.toString(16).padStart(2, '0')).join('');
    if (hex !== artifact.sha256) throw new Error('下载文件校验失败，请重新下载。');
  }
}

export async function downloadArtifact(jobId, artifact) {
  const response = await fetch(`/v1/jobs/${encodeURIComponent(jobId)}/artifacts/${encodeURIComponent(artifact.id)}`, { credentials: 'same-origin' });
  if (!response.ok) {
    const body = await response.json().catch(() => null);
    throw new Error(body?.error?.message || `下载失败（HTTP ${response.status}）`);
  }
  const blob = await response.blob();
  await verifyArtifact(blob, artifact);
  saveBlob(blob, artifact.filename);
}

export function saveBlob(blob, name) {
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.href = url; link.download = name; document.body.appendChild(link); link.click(); link.remove();
  setTimeout(() => URL.revokeObjectURL(url), 30000);
}

export const terminal = status => ['succeeded', 'partially_succeeded', 'failed', 'cancelled', 'timed_out'].includes(status);
