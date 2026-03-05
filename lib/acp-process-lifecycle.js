import { spawn } from 'child_process';
import path from 'path';
import os from 'os';
import fs from 'fs';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const projectRoot = path.resolve(__dirname, '..');
const isWindows = os.platform() === 'win32';

export const MAX_RESTARTS = 10;
export const RESTART_WINDOW_MS = 300000;
export const IDLE_TIMEOUT_MS = 120000;

export function resolveBinary(cmd) {
  const ext = isWindows ? '.cmd' : '';
  const localBin = path.join(projectRoot, 'node_modules', '.bin', cmd + ext);
  if (fs.existsSync(localBin)) return localBin;
  return cmd;
}

export function startProcess(tool, log) {
  const bin = resolveBinary(tool.cmd);
  const args = [...tool.args, '--port', String(tool.port)];
  const opts = { stdio: ['pipe', 'pipe', 'pipe'], cwd: process.cwd() };
  if (isWindows) opts.shell = true;

  let proc;
  try { proc = spawn(bin, args, opts); }
  catch (err) { log(tool.id + ' spawn failed: ' + err.message); return null; }

  const entry = {
    id: tool.id, port: tool.port, process: proc, pid: proc.pid,
    startedAt: Date.now(), restarts: [], healthy: false, lastHealthCheck: 0,
    lastUsed: Date.now(), idleTimer: null,
  };

  proc.stdout.on('data', () => {});
  proc.stderr.on('data', (d) => {
    const t = d.toString().trim();
    if (t) log(tool.id + ': ' + t.substring(0, 200));
  });
  proc.stdout.on('error', () => {});
  proc.stderr.on('error', () => {});
  proc.on('error', (err) => { log(tool.id + ' error: ' + err.message); entry.healthy = false; });

  return entry;
}

export function scheduleRestart(tool, prevRestarts, log, startProcessFn, shuttingDown) {
  if (shuttingDown()) return;
  const now = Date.now();
  const recent = prevRestarts.filter(t => now - t < RESTART_WINDOW_MS);
  if (recent.length >= MAX_RESTARTS) {
    log(tool.id + ' exceeded restart limit, giving up');
    return null;
  }
  const delay = Math.min(1000 * Math.pow(2, recent.length), 30000);
  log(tool.id + ' restarting in ' + delay + 'ms');
  setTimeout(() => {
    if (shuttingDown()) return;
    const entry = startProcessFn(tool);
    if (entry) entry.restarts = [...recent, Date.now()];
  }, delay);
}
