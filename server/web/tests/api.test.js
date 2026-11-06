import test from 'node:test';
import assert from 'node:assert/strict';
import { webcrypto } from 'node:crypto';
import { validateFiles, submissionForm, verifyArtifact } from '../src/api.js';

const limits = { maxDocuments: 2, maxResources: 3, maxMarkdownBytes: 100, maxImageBytes: 100, maxRequestBytes: 200 };
const file = (name, text = '# test', relative = '') => {
  const result = new File([text], name);
  if (relative) Object.defineProperty(result, 'webkitRelativePath', { value: relative });
  return result;
};

test('folder uploads preserve the Markdown/image relationship', async () => {
  const files = [file('a.md', '![chart](images/a.png)', 'report/a.md'), file('a.png', 'image', 'report/images/a.png')];
  validateFiles(files, limits);
  const form = submissionForm(files, { schemaVersion: 2 }, { missingImages: 'stop', batchErrors: 'continue' });
  const manifest = JSON.parse(form.get('request'));
  assert.equal(manifest.documents[0].path, 'report/a.md');
  assert.equal(manifest.resources[0].path, 'report/images/a.png');
  assert.equal(await form.get(manifest.documents[0].part).text(), '![chart](images/a.png)');
});

test('reject ambiguous paths and excessive uploads before network submission', () => {
  assert.throws(() => validateFiles([file('a.md'), file('A.md')], limits), /重复/);
  assert.throws(() => validateFiles([file('a.md', '', '../a.md')], limits), /路径/);
  assert.throws(() => validateFiles([file('a.md', 'x'.repeat(101))], limits), /大小/);
  assert.throws(() => validateFiles([file('a.png')], limits), /至少/);
  assert.throws(() => validateFiles([file('a.md'), file('b.md'), file('c.md')], limits), /最多/);
});

test('HTTPS downloads check SHA-256 and LAN HTTP still checks exact size', async () => {
  const blob = new Blob(['test']);
  const artifact = { sizeBytes: 4, sha256: '9f86d081884c7d659a2feaa0c55ad015a3bf4f1b2b0b822cd15d6c15b0f00a08' };
  await verifyArtifact(blob, artifact, webcrypto.subtle);
  await assert.rejects(verifyArtifact(blob, { ...artifact, sha256: '0'.repeat(64) }, webcrypto.subtle), /校验/);
  await assert.rejects(verifyArtifact(blob, { ...artifact, sizeBytes: 5 }, null), /不完整/);
  await verifyArtifact(blob, artifact, null);
});
