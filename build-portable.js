import fs from 'fs';
import path from 'path';
import os from 'os';
import { fileURLToPath } from 'url';
import { execSync } from 'child_process';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const src = __dirname;
const out = path.join(src, '..', 'wagentgui');
const nm = path.join(src, 'node_modules');

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

log('Output: ' + out);
rmrf(out);
fs.mkdirSync(out, { recursive: true });

log('Compiling Windows executable...');
execSync(
  `"${path.join(os.homedir(), '.bun', 'bin', 'bun')}" build --compile --target=bun-windows-x64 --outfile="${path.join(out, 'agentgui.exe')}" "${path.join(src, 'portable-entry.js')}"`,
  { stdio: 'inherit', cwd: src }
);

const exeSize = fs.statSync(path.join(out, 'agentgui.exe')).size;
const buf = Buffer.alloc(2);
const fd = fs.openSync(path.join(out, 'agentgui.exe'), 'r');
fs.readSync(fd, buf, 0, 2, 0);
fs.closeSync(fd);
if (buf[0] !== 0x4D || buf[1] !== 0x5A) throw new Error('Output exe is not a valid PE file (bad MZ magic)');
log(`Exe compiled: ${Math.round(exeSize / 1024 / 1024)}MB (valid PE)`);

log('Copying static files...');
copyDir(path.join(src, 'static'), path.join(out, 'static'));

const destNm = path.join(out, 'node_modules');

function collectDeps(pkgName, visited = new Set()) {
  if (visited.has(pkgName)) return;
  visited.add(pkgName);
  const pkgJson = path.join(nm, pkgName, 'package.json');
  if (!fs.existsSync(pkgJson)) return;
  const p = JSON.parse(fs.readFileSync(pkgJson, 'utf8'));
  for (const dep of Object.keys(p.dependencies || {})) collectDeps(dep, visited);
  return visited;
}

function copyPkg(pkgName) {
  const src2 = path.join(nm, pkgName);
  const dest2 = path.join(destNm, pkgName);
  if (!fs.existsSync(src2) || fs.existsSync(dest2)) return;
  copyDir(src2, dest2);
}

log('Copying runtime JS deps (express, fsbrowse, busboy, ws, better-sqlite3 trees)...');
const runtimeRoots = ['express', 'fsbrowse', 'busboy', 'ws', 'better-sqlite3'];
const allDeps = new Set();
for (const root of runtimeRoots) collectDeps(root, allDeps);
for (const dep of allDeps) copyPkg(dep);
log(`Copied ${allDeps.size} runtime dep packages`);

log('Copying @huggingface/transformers (dist + win32 natives)...');
const hfSrc = path.join(nm, '@huggingface', 'transformers');
const hfDest = path.join(destNm, '@huggingface', 'transformers');
copyFile(path.join(hfSrc, 'package.json'), path.join(hfDest, 'package.json'));
copyDir(path.join(hfSrc, 'dist'), path.join(hfDest, 'dist'));
const hfNmSrc = path.join(hfSrc, 'node_modules');
const hfNmDest = path.join(hfDest, 'node_modules');
const onnxNestedSrc = path.join(hfNmSrc, 'onnxruntime-node');
const onnxRootSrc = path.join(nm, 'onnxruntime-node');
const hfOnnxSrc = fs.existsSync(onnxNestedSrc) ? onnxNestedSrc : onnxRootSrc;
const hfOnnxDest = path.join(hfNmDest, 'onnxruntime-node');
copyFile(path.join(hfOnnxSrc, 'package.json'), path.join(hfOnnxDest, 'package.json'));
copyDir(path.join(hfOnnxSrc, 'dist'), path.join(hfOnnxDest, 'dist'));
copyDir(path.join(hfOnnxSrc, 'lib'), path.join(hfOnnxDest, 'lib'));
copyDir(path.join(hfOnnxSrc, 'bin', 'napi-v3', 'win32', 'x64'), path.join(hfOnnxDest, 'bin', 'napi-v3', 'win32', 'x64'));
const onnxCommonNestedSrc = path.join(hfNmSrc, 'onnxruntime-common');
const onnxCommonRootSrc = path.join(nm, 'onnxruntime-common');
const onnxCommonSrc = fs.existsSync(onnxCommonNestedSrc) ? onnxCommonNestedSrc : onnxCommonRootSrc;
copyDir(onnxCommonSrc, path.join(hfNmDest, 'onnxruntime-common'));

log('Copying webtalk...');
copyDir(path.join(nm, 'webtalk'), path.join(destNm, 'webtalk'));

log('Copying audio-decode...');
copyDir(path.join(nm, 'audio-decode'), path.join(destNm, 'audio-decode'));
const audioDeps = new Set();
collectDeps('audio-decode', audioDeps);
for (const dep of audioDeps) copyPkg(dep);

log('Copying @anthropic-ai/claude-code ripgrep (win32)...');
const claudeSrc = path.join(nm, '@anthropic-ai', 'claude-code');
const claudeDest = path.join(destNm, '@anthropic-ai', 'claude-code');
copyFile(path.join(claudeSrc, 'package.json'), path.join(claudeDest, 'package.json'));
copyDir(path.join(claudeSrc, 'vendor', 'ripgrep', 'x64-win32'), path.join(claudeDest, 'vendor', 'ripgrep', 'x64-win32'));

log('Creating data directory...');
fs.mkdirSync(path.join(out, 'data'), { recursive: true });

if (process.env.NO_BUNDLE_MODELS === 'true') {
  log('Skipping model bundling (NO_BUNDLE_MODELS=true) - models will download on first use');
} else {
  log('Bundling AI models...');
    // Get models from AnEntrypoint/models or local cache
  let modelsDir = process.env.MODELS_SOURCE_DIR || path.join(os.homedir(), '.gmgui', 'models');
  
  // If models not present and we're in CI, clone from GitHub
  if (!fs.existsSync(modelsDir) && process.env.CI) {
    console.log('[BUILD] Models not found, cloning from GitHub...');
    const ciModelsDir = path.join(os.tmpdir(), 'models-clone');
    try {
      require('child_process').execSync(`git clone https://github.com/AnEntrypoint/models.git "${ciModelsDir}" --depth 1`, { stdio: 'inherit' });
      modelsDir = ciModelsDir;
    } catch (e) {
      console.error('[BUILD] Failed to clone models from GitHub:', e.message);
    }
  }
  if (fs.existsSync(modelsDir)) {
    copyDir(modelsDir, path.join(out, 'models'));
    log(`Models bundled: ${Math.round(sizeOf(path.join(out, 'models')) / 1024 / 1024)}MB`);
  } else {
    log(`WARNING: No models found at ${modelsDir} - portable build will download on first use`);
  }
}

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

// Output the build directory path for GitHub Actions
if (process.env.GITHUB_OUTPUT) {
  const outPath = path.resolve(out);
  fs.appendFileSync(process.env.GITHUB_OUTPUT, `portable-path=${outPath}\n`);
  log(`GitHub Actions output: portable-path=${outPath}`);
}
