import { spawn } from 'child_process';
import path from 'path';
import os from 'os';
import fs from 'fs';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const projectRoot = path.resolve(__dirname, '..');
const isWindows = os.platform() === 'win32';

const ACP_TOOLS = [
  { id: 'opencode', cmd: 'opencode', args: ['acp'], port: 18100, npxPkg: 'opencode-ai' },
  { id: 'kilo', cmd: 'kilo', args: ['acp'], port: 18101, npxPkg: '@kilocode/cli' },
];

const MAX_RESTARTS = 10;
const RESTART_WINDOW_MS = 300000;
const HEALTH_INTERVAL_MS = 30000;
const STARTUP_GRACE_MS = 5000;
const IDLE_TIMEOUT_MS = 120000;
const processes = new Map();
let healthTimer = null;
let shuttingDown = false;

function log(msg) { console.log('[ACP] ' + msg); }

function resolveBinary(cmd) {
  const ext = isWindows ? '.cmd' : '';
  const localBin = path.join(projectRoot, 'node_modules', '.bin', cmd + ext);
  if (fs.existsSync(localBin)) return localBin;
  return cmd;
}

function startProcess(tool) {
  if (shuttingDown) return null;
  const existing = processes.get(tool.id);
  if (existing?.process && !existing.process.killed) return existing;

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

  proc.on('close', (code) => {
    entry.healthy = false;
    if (shuttingDown || entry._stopping) return;
    log(tool.id + ' exited code ' + code);
    scheduleRestart(tool, entry.restarts);
  });

  processes.set(tool.id, entry);
  log(tool.id + ' started port ' + tool.port + ' pid ' + proc.pid);
  setTimeout(() => checkHealth(tool.id), STARTUP_GRACE_MS);
  resetIdleTimer(tool.id);
  return entry;
}

function resetIdleTimer(toolId) {
  const entry = processes.get(toolId);
  if (!entry) return;
  entry.lastUsed = Date.now();
  if (entry.idleTimer) clearTimeout(entry.idleTimer);
  entry.idleTimer = setTimeout(() => stopTool(toolId), IDLE_TIMEOUT_MS);
}

function stopTool(toolId) {
  const entry = processes.get(toolId);
  if (!entry) return;
  log(toolId + ' idle, stopping to free RAM');
  entry._stopping = true;
  if (entry.idleTimer) clearTimeout(entry.idleTimer);
  try { entry.process.kill('SIGTERM'); } catch (_) {}
  setTimeout(() => { try { entry.process.kill('SIGKILL'); } catch (_) {} }, 5000);
  processes.delete(toolId);
}

function scheduleRestart(tool, prevRestarts = []) {
  if (shuttingDown) return;
  const now = Date.now();
  const recent = prevRestarts.filter(t => now - t < RESTART_WINDOW_MS);
  if (recent.length >= MAX_RESTARTS) {
    log(tool.id + ' exceeded restart limit, giving up');
    processes.delete(tool.id);
    return;
  }
  const delay = Math.min(1000 * Math.pow(2, recent.length), 30000);
  log(tool.id + ' restarting in ' + delay + 'ms');
  setTimeout(() => {
    if (shuttingDown) return;
    const entry = startProcess(tool);
    if (entry) entry.restarts = [...recent, Date.now()];
  }, delay);
}

async function checkHealth(toolId) {
  const entry = processes.get(toolId);
  if (!entry || shuttingDown) return;
  try {
    const res = await fetch('http://127.0.0.1:' + entry.port + '/provider', {
      signal: AbortSignal.timeout(3000), headers: { 'Accept': 'application/json' }
    });
    entry.healthy = res.ok;
  } catch (_) { entry.healthy = false; }
  entry.lastHealthCheck = Date.now();
}

export async function ensureRunning(agentId) {
  const tool = ACP_TOOLS.find(t => t.id === agentId);
  if (!tool) return null;
  let entry = processes.get(agentId);
  if (entry?.healthy) { resetIdleTimer(agentId); return entry.port; }
  if (!entry || entry._stopping) {
    entry = startProcess(tool);
    if (!entry) return null;
  }
  for (let i = 0; i < 20; i++) {
    await new Promise(r => setTimeout(r, 500));
    await checkHealth(agentId);
    if (processes.get(agentId)?.healthy) { resetIdleTimer(agentId); return tool.port; }
  }
  return null;
}

export function touch(agentId) {
  const entry = processes.get(agentId);
  if (entry) resetIdleTimer(agentId);
}

export async function startAll() {
  log('ACP tools available (on-demand start)');
  healthTimer = setInterval(() => {
    for (const [id] of processes) checkHealth(id);
  }, HEALTH_INTERVAL_MS);
}

export async function stopAll() {
  shuttingDown = true;
  if (healthTimer) { clearInterval(healthTimer); healthTimer = null; }
  const kills = [];
  for (const [id, entry] of processes) {
    if (entry.idleTimer) clearTimeout(entry.idleTimer);
    log('stopping ' + id + ' pid ' + entry.pid);
    kills.push(new Promise(resolve => {
      const t = setTimeout(() => { try { entry.process.kill('SIGKILL'); } catch (_) {} resolve(); }, 5000);
      entry.process.on('close', () => { clearTimeout(t); resolve(); });
      try { entry.process.kill('SIGTERM'); } catch (_) {}
    }));
  }
  await Promise.all(kills);
  processes.clear();
  log('all stopped');
}

export function getStatus() {
  return ACP_TOOLS.map(tool => {
    const e = processes.get(tool.id);
    return {
      id: tool.id, port: tool.port, running: !!e, healthy: e?.healthy || false,
      pid: e?.pid, uptime: e ? Date.now() - e.startedAt : 0,
      restartCount: e?.restarts.length || 0, idleMs: e ? Date.now() - e.lastUsed : 0,
    };
  });
}

export function getPort(agentId) {
  const e = processes.get(agentId);
  return e?.healthy ? e.port : null;
}

export function getRunningPorts() {
  const ports = {};
  for (const [id, e] of processes) if (e.healthy) ports[id] = e.port;
  return ports;
}

export async function restart(agentId) {
  const tool = ACP_TOOLS.find(t => t.id === agentId);
  if (!tool) return false;
  stopTool(agentId);
  startProcess(tool);
  return true;
}

export async function queryModels(agentId) {
  const port = await ensureRunning(agentId);
  if (!port) return [];
  try {
    const res = await fetch('http://127.0.0.1:' + port + '/provider', {
      signal: AbortSignal.timeout(5000), headers: { 'Accept': 'application/json' }
    });
    if (!res.ok) return [];
    const data = await res.json();
    const models = [];
    for (const prov of (data.all || [])) {
      for (const m of Object.values(prov.models || {})) {
        models.push({ id: m.id, label: m.name || m.id, provider: prov.name || prov.id });
      }
    }
    return models;
  } catch (_) { return []; }
}

export function isAvailable(agentId) {
  const tool = ACP_TOOLS.find(t => t.id === agentId);
  if (!tool) return false;
  const bin = resolveBinary(tool.cmd);
  return bin !== tool.cmd || fs.existsSync(bin);
}

export const ACP_TOOL_CONFIGS = ACP_TOOLS;
