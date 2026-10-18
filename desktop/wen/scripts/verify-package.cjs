const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const assert = require('node:assert/strict');
const asar = require('@electron/asar');
const root = path.resolve(__dirname, '..');
const { version } = require('../package.json');
const release = path.join(root, 'release');
const unpacked = path.join(release, 'win-unpacked');
const archive = path.join(unpacked, 'resources/app.asar');
const digest = (data) => crypto.createHash('sha256').update(data).digest('hex');
const files = asar.listPackage(archive);
const packagedManifest = JSON.parse(asar.extractFile(archive, 'package.json').toString('utf8'));
assert.equal(digest(asar.extractFile(archive, 'shared/education.js')), digest(fs.readFileSync(path.join(root, 'shared/education.js'))), 'Stale shared education metadata');
assert.equal(packagedManifest.version, version, 'Incorrect packaged application version');
assert.equal(packagedManifest.main, 'electron/main.cjs', 'Incorrect packaged entry point');
for (const relative of ['electron/main.cjs', 'electron/backend.cjs', 'electron/preload.cjs', 'electron/accounts.cjs', 'electron/exams.cjs', 'electron/document-worker.cjs', 'electron/image-dimensions.cjs', 'dist/index.html', 'assets/icon.png']) {
  assert.equal(digest(asar.extractFile(archive, relative)), digest(fs.readFileSync(path.join(root, relative))), `Stale packaged file: ${relative}`);
}
for (const name of fs.readdirSync(path.join(root, 'dist', 'assets'))) {
  const relative = `dist/assets/${name}`;
  assert.equal(digest(asar.extractFile(archive, path.normalize(relative))), digest(fs.readFileSync(path.join(root, relative))), `Stale renderer asset: ${relative}`);
}
assert.ok(!files.some(file => /[/\\](auth\.json|study\.json|accounts\.json|exam\.json|deepseek-key\.bin|test-results)[/\\]?$/.test(file)), 'User data accidentally included');
for (const dependency of ['pdfjs-dist', '@napi-rs/canvas']) assert.ok(files.some(file => file.replaceAll('\\', '/').endsWith(`/node_modules/${dependency}/package.json`)), `Missing document dependency ${dependency}`);
const codexRelative = 'codex/bin/codex.exe';
assert.equal(digest(fs.readFileSync(path.join(unpacked, 'resources', codexRelative))), digest(fs.readFileSync(path.join(root, 'vendor', codexRelative))), 'Codex binary differs from published package');
if (process.argv.includes('--unpacked-only')) { console.log(JSON.stringify({ version, passed: true, checks: ['all desktop source and renderer hashes', 'valid package entry', 'PDF dependencies present', 'no user credentials bundled', 'official Codex binary'] }, null, 2)); process.exit(0); }
const exe = path.join(release, `Wenxi-Setup-${version}-x64.exe`);
const bytes = fs.readFileSync(exe);
assert.equal(bytes.subarray(0, 2).toString(), 'MZ', 'Installer is not a Windows executable');
const result = { product:'温习', version, platform:'Windows x64', createdAt:new Date().toISOString(), installer:path.basename(exe), bytes:bytes.length, sha256:digest(bytes), checks:['current renderer and backend packaged', 'PDF rendering dependencies packaged', 'icon packaged', 'no user credentials or study data bundled', 'official Codex executable unchanged', 'Windows PE installer header'] };
fs.writeFileSync(path.join(release, 'verification.json'), JSON.stringify(result, null, 2));
fs.writeFileSync(path.join(release, 'SHA256SUMS.txt'), `${result.sha256}  ${path.basename(exe)}\n`);
console.log(JSON.stringify(result, null, 2));
