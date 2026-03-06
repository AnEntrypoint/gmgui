import { startProcess as startProc, scheduleRestart as scheduleRestart, MAX_RESTARTS, RESTART_WINDOW_MS, IDLE_TIMEOUT_MS } from './acp-process-lifecycle.js';

const ACP_TOOLS = [
  { id: 'opencode', cmd: 'opencode', args: ['acp'], port: 18100, npxPkg: 'opencode-ai' },
  { id: 'kilo', cmd: 'kilo', args: ['acp'], port: 18101, npxPkg: '@kilocode/cli' },
];

const HEALTH_INTERVAL_MS = 30000;
const STARTUP_GRACE_MS = 5000;
const processes = new Map();
let healthTimer = null;
let shuttingDown = false;

function log(msg) { console.log('[ACP] ' + msg); }

function startProcess(tool) {
  if (shuttingDown) return null;
  const existing = processes.get(tool.id);
  if (existing?.process && !existing.process.killed) return existing;

  const entry = startProc(tool, log);
  if (!entry) return null;

  entry.process.on('close', (code) => {
    entry.healthy = false;
    if (shuttingDown || entry._stopping) return;
    log(tool.id + ' exited code ' + code);
    scheduleRestart(tool, entry.restarts, log, startProcess, () => shuttingDown);
  });

  processes.set(tool.id, entry);
  log(tool.id + ' started port ' + tool.port + ' pid ' + entry.process.pid);
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

async function checkHealth(toolId) {
  const entry = processes.get(toolId);
  if (!entry || shuttingDown) return;

  const { fetchACPProvider } = await import('./acp-http-client.js');
  const result = await fetchACPProvider('http://127.0.0.1', entry.port);

  entry.healthy = result.ok;
  entry.lastHealthCheck = Date.now();

  if (result.data) {
    entry.providerInfo = result.data;
  }
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
      providerInfo: e?.providerInfo || null,
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
    const res = await fetch('http://127.0.0.1:' + port + '/models');
    if (!res.ok) return [];
    const data = await res.json();
    return data.models || [];
  } catch (_) { return []; }
}

export function isAvailable(agentId) {
  const tool = ACP_TOOLS.find(t => t.id === agentId);
  return !!tool;
}
