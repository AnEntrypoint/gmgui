import path from 'path';
import { fileURLToPath } from 'url';
import fs from 'fs';
import { spawn } from 'child_process';

function getExeDir() {
  if (process.execPath && process.execPath !== process.argv[0]) {
    return path.dirname(process.execPath);
  }
  if (process.argv[1]) {
    const argv1 = path.resolve(process.argv[1]);
    if (fs.existsSync(argv1) || fs.existsSync(argv1 + '.exe')) {
      return path.dirname(argv1);
    }
  }
  return process.cwd();
}

const exeDir = getExeDir();
const dataDir = path.join(exeDir, 'data');

if (!fs.existsSync(dataDir)) fs.mkdirSync(dataDir, { recursive: true });

process.env.PORTABLE_DATA_DIR = dataDir;
process.env.PORTABLE_EXE_DIR = exeDir;
process.env.BASE_URL = process.env.BASE_URL || '/gm';
process.env.PORT = process.env.PORT || '3000';
process.env.STARTUP_CWD = process.env.STARTUP_CWD || exeDir;

const port = process.env.PORT;
const baseUrl = process.env.BASE_URL;
const url = `http://localhost:${port}${baseUrl}/`;

console.log(`[AgentGUI Portable] Exe directory: ${exeDir}`);
console.log(`[AgentGUI Portable] Data directory: ${dataDir}`);
console.log(`[AgentGUI Portable] Server starting on ${url}`);

setTimeout(() => {
  const cmd = process.platform === 'win32' ? 'start' : process.platform === 'darwin' ? 'open' : 'xdg-open';
  spawn(cmd, [url], { shell: true, detached: true, stdio: 'ignore' }).unref();
}, 1500);

await import('./server.js');
