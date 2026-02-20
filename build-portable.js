import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { execSync, execFileSync } from 'child_process';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const src = __dirname;
const out = path.join(src, '..', 'wagentgui');
const nm = path.join(src, 'node_modules');
const BUN_WIN_CACHE = path.join(process.env.HOME, '.bun', 'install', 'cache', 'bun-windows-x64-v1.3.9');

function log(msg) { console.log('[BUILD] ' + msg); }

function rmrf(dir) {
  if (!fs.existsSync(dir)) return;
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const fp = path.join(dir, entry.name);
    if (entry.isDirectory()) fs.rmSync(fp, { recursive: true, force: true });
    else fs.unlinkSync(fp);
  }
}

function copyDir(from, to) {
  if (!fs.existsSync(from)) return;
  fs.mkdirSync(to, { recursive: true });
  for (const entry of fs.readdirSync(from, { withFileTypes: true })) {
    const s = path.join(from, entry.name);
    const d = path.join(to, entry.name);
    if (entry.isDirectory()) copyDir(s, d);
    else fs.copyFileSync(s, d);
  }
}

function copyFile(from, to) {
  fs.mkdirSync(path.dirname(to), { recursive: true });
  fs.copyFileSync(from, to);
}

function sizeOf(dir) {
  if (!fs.existsSync(dir)) return 0;
  let sz = 0;
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    const fp = path.join(dir, e.name);
    sz += e.isDirectory() ? sizeOf(fp) : fs.statSync(fp).size;
  }
  return sz;
}

function ensureWinBun() {
  if (fs.existsSync(BUN_WIN_CACHE)) {
    const stat = fs.statSync(BUN_WIN_CACHE);
    if (stat.size > 50 * 1024 * 1024) {
      // Verify it's a PE file
      const buf = Buffer.alloc(2);
      const fd = fs.openSync(BUN_WIN_CACHE, 'r');
      fs.readSync(fd, buf, 0, 2, 0);
      fs.closeSync(fd);
      if (buf[0] === 0x4D && buf[1] === 0x5A) return BUN_WIN_CACHE;
    }
  }
  log('Downloading Windows Bun binary...');
  execSync(
    `~/.bun/bin/bun build --compile --target=bun-windows-x64 --outfile=/tmp/_bun_trigger.exe /dev/null 2>/dev/null || true`,
    { stdio: 'inherit' }
  );
  if (fs.existsSync(BUN_WIN_CACHE)) return BUN_WIN_CACHE;
  throw new Error(`Windows Bun binary not found at ${BUN_WIN_CACHE}. Run: bun build --compile --target=bun-windows-x64 --outfile=/tmp/x.exe /dev/null`);
}

log('Output: ' + out);
rmrf(out);
fs.mkdirSync(out, { recursive: true });

log('Building JS bundle...');
execSync(
  `~/.bun/bin/bun build --minify --target=bun --outfile=${path.join(out, 'bundle.js')} ${path.join(src, 'portable-entry.js')}`,
  { stdio: 'inherit', cwd: src }
);
const bundleSize = fs.statSync(path.join(out, 'bundle.js')).size;
log(`Bundle: ${Math.round(bundleSize / 1024)}KB`);

log('Locating Windows Bun binary...');
const bunWinPath = ensureWinBun();
log(`Windows Bun: ${bunWinPath} (${Math.round(fs.statSync(bunWinPath).size / 1024 / 1024)}MB)`);

log('Injecting bundle into Windows Bun exe (.bun PE section)...');
const injector = path.join(src, 'scripts', 'inject-pe-section.py');
execFileSync('python3', [
  injector,
  bunWinPath,
  path.join(out, 'bundle.js'),
  path.join(out, 'agentgui.exe')
], { stdio: 'inherit' });
fs.unlinkSync(path.join(out, 'bundle.js'));

const exeSize = fs.statSync(path.join(out, 'agentgui.exe')).size;
// Verify PE magic
const buf = Buffer.alloc(2);
const fd = fs.openSync(path.join(out, 'agentgui.exe'), 'r');
fs.readSync(fd, buf, 0, 2, 0);
fs.closeSync(fd);
if (buf[0] !== 0x4D || buf[1] !== 0x5A) throw new Error('Output exe is not a valid PE file (bad MZ magic)');
log(`Exe compiled: ${Math.round(exeSize / 1024 / 1024)}MB (valid PE)`);

log('Copying static files...');
copyDir(path.join(src, 'static'), path.join(out, 'static'));

const destNm = path.join(out, 'node_modules');

log('Copying @huggingface/transformers (dist + win32 natives)...');
const hfSrc = path.join(nm, '@huggingface', 'transformers');
const hfDest = path.join(destNm, '@huggingface', 'transformers');
copyFile(path.join(hfSrc, 'package.json'), path.join(hfDest, 'package.json'));
copyDir(path.join(hfSrc, 'dist'), path.join(hfDest, 'dist'));
const hfNmSrc = path.join(hfSrc, 'node_modules');
const hfNmDest = path.join(hfDest, 'node_modules');
const hfOnnxSrc = path.join(hfNmSrc, 'onnxruntime-node');
const hfOnnxDest = path.join(hfNmDest, 'onnxruntime-node');
copyFile(path.join(hfOnnxSrc, 'package.json'), path.join(hfOnnxDest, 'package.json'));
copyDir(path.join(hfOnnxSrc, 'dist'), path.join(hfOnnxDest, 'dist'));
copyDir(path.join(hfOnnxSrc, 'lib'), path.join(hfOnnxDest, 'lib'));
copyDir(path.join(hfOnnxSrc, 'bin', 'napi-v3', 'win32', 'x64'), path.join(hfOnnxDest, 'bin', 'napi-v3', 'win32', 'x64'));
copyDir(path.join(hfNmSrc, 'onnxruntime-common'), path.join(hfNmDest, 'onnxruntime-common'));

log('Copying webtalk...');
copyDir(path.join(nm, 'webtalk'), path.join(destNm, 'webtalk'));

log('Copying @anthropic-ai/claude-code ripgrep (win32)...');
const claudeSrc = path.join(nm, '@anthropic-ai', 'claude-code');
const claudeDest = path.join(destNm, '@anthropic-ai', 'claude-code');
copyFile(path.join(claudeSrc, 'package.json'), path.join(claudeDest, 'package.json'));
copyDir(path.join(claudeSrc, 'vendor', 'ripgrep', 'x64-win32'), path.join(claudeDest, 'vendor', 'ripgrep', 'x64-win32'));

log('Creating data directory...');
fs.mkdirSync(path.join(out, 'data'), { recursive: true });

fs.writeFileSync(path.join(out, 'README.txt'), [
  '# AgentGUI Portable',
  '',
  'No installation required. Double-click agentgui.exe to start.',
  '',
  'Web interface: http://localhost:3000/gm/',
  '',
  'Data is stored in the data/ folder next to the executable.',
  '',
  'Requirements: None - fully self-contained.',
].join('\n'));

const totalMB = Math.round(sizeOf(out) / 1024 / 1024);
log(`Build complete! Total: ${totalMB}MB  Output: ${out}`);
