// Bundle the published official Windows binary, without copying any user settings.
const fs = require('node:fs');
const path = require('node:path');
const root = path.resolve(__dirname, '..');
const source = path.join(root, 'node_modules/@openai/codex-win32-x64/vendor/x86_64-pc-windows-msvc');
const target = path.join(root, 'vendor/codex');
if (!fs.existsSync(path.join(source, 'bin/codex.exe'))) {
  throw new Error('Windows x64 Codex binary missing. Run npm ci on Windows x64 with optional dependencies enabled.');
}
fs.mkdirSync(target, { recursive: true });
fs.cpSync(source, target, { recursive: true });
const pkg = JSON.parse(fs.readFileSync(path.join(root, 'node_modules/@openai/codex/package.json'), 'utf8'));
fs.writeFileSync(path.join(target, 'VERSION.txt'), `Official OpenAI Codex CLI ${pkg.version}\nhttps://github.com/openai/codex\nApache-2.0\n`);
const license = path.resolve(root, '../../LICENSE');
fs.copyFileSync(license, path.join(root, 'LICENSE'));
fs.copyFileSync(license, path.join(target, 'LICENSE'));
console.log(`Prepared official Codex ${pkg.version}: ${target}`);
