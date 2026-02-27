import fs from 'fs';
import os from 'os';
import path from 'path';
import { execSync, spawn } from 'child_process';

function spawnScript(cmd, args, convId, scriptName, agentId, deps) {
  const { activeScripts, broadcastSync, modelCache } = deps;
  if (activeScripts.has(convId)) throw { code: 409, message: 'Process already running' };
  const child = spawn(cmd, args, {
    stdio: ['pipe', 'pipe', 'pipe'],
    env: { ...process.env, FORCE_COLOR: '1' },
    shell: os.platform() === 'win32'
  });
  activeScripts.set(convId, { process: child, script: scriptName, startTime: Date.now() });
  broadcastSync({ type: 'script_started', conversationId: convId, script: scriptName, agentId, timestamp: Date.now() });
  const relay = (stream) => (chunk) => {
    broadcastSync({ type: 'script_output', conversationId: convId, data: chunk.toString(), stream, timestamp: Date.now() });
  };
  child.stdout.on('data', relay('stdout'));
  child.stderr.on('data', relay('stderr'));
  child.on('error', (err) => {
    activeScripts.delete(convId);
    broadcastSync({ type: 'script_stopped', conversationId: convId, code: 1, error: err.message, timestamp: Date.now() });
  });
  child.on('close', (code) => {
    activeScripts.delete(convId);
    if (modelCache && agentId) modelCache.delete(agentId);
    broadcastSync({ type: 'script_stopped', conversationId: convId, code: code || 0, timestamp: Date.now() });
  });
  return child.pid;
}

function readJson(filePath) {
  try { return fs.existsSync(filePath) ? JSON.parse(fs.readFileSync(filePath, 'utf-8')) : null; } catch { return null; }
}

function checkAgentAuth(agent) {
  const s = { id: agent.id, name: agent.name, authenticated: false, detail: '' };
  try {
    if (agent.id === 'claude-code') {
      const creds = readJson(path.join(os.homedir(), '.claude', '.credentials.json'));
      if (creds?.claudeAiOauth?.expiresAt > Date.now()) {
        s.authenticated = true;
        s.detail = creds.claudeAiOauth.subscriptionType || 'authenticated';
      } else { s.detail = creds ? 'expired' : 'no credentials'; }
    } else if (agent.id === 'gemini') {
      const oauth = readJson(path.join(os.homedir(), '.gemini', 'oauth_creds.json'));
      const accts = readJson(path.join(os.homedir(), '.gemini', 'google_accounts.json'));
      const hasOAuth = !!(oauth?.refresh_token || oauth?.access_token);
      if (accts?.active) { s.authenticated = true; s.detail = accts.active; }
      else if (hasOAuth) { s.authenticated = true; s.detail = 'oauth'; }
      else { s.detail = accts ? 'logged out' : 'no credentials'; }
    } else if (agent.id === 'opencode') {
      const out = execSync('opencode auth list 2>&1', { encoding: 'utf-8', timeout: 5000 });
      const m = out.match(/(\d+)\s+credentials?/);
      if (m && parseInt(m[1], 10) > 0) { s.authenticated = true; s.detail = m[1] + ' credential(s)'; }
      else { s.detail = 'no credentials'; }
    } else { s.detail = 'unknown'; }
  } catch { s.detail = 'check failed'; }
  return s;
}

async function acpFetch(port, path, body = null) {
  const opts = { headers: { 'Content-Type': 'application/json' }, signal: AbortSignal.timeout(3000) };
  if (body !== null) { opts.method = 'POST'; opts.body = JSON.stringify(body); }
  const res = await fetch(`http://localhost:${port}${path}`, opts);
  if (!res.ok) return null;
  return res.json();
}

export function register(router, deps) {
  const { db, discoveredAgents, modelCache,
    getAgentDescriptor, activeScripts, broadcastSync, startGeminiOAuth,
    geminiOAuthState } = deps;

  router.handle('sess.get', (p) => {
    const sess = db.getSession(p.id);
    if (!sess) throw { code: 404, message: 'Not found' };
    return { session: sess, events: db.getSessionEvents(p.id) };
  });

  router.handle('sess.latest', (p) => {
    const s = db.getLatestSession(p.id);
    if (!s) return { session: null };
    return { session: s, events: db.getSessionEvents(s.id) };
  });

  router.handle('sess.chunks', (p) => {
    if (!db.getSession(p.id)) throw { code: 404, message: 'Session not found' };
    const sinceSeq = parseInt(p.sinceSeq ?? '-1');
    const since = parseInt(p.since ?? '0');
    const chunks = sinceSeq >= 0 ? db.getChunksSinceSeq(p.id, sinceSeq) : db.getChunksSince(p.id, since);
    return { ok: true, chunks };
  });

  router.handle('sess.exec', (p) => {
    const limit = Math.min(parseInt(p.limit || '1000'), 5000);
    const offset = Math.max(parseInt(p.offset || '0'), 0);
    return { sessionId: p.id, events: [], total: 0, limit, offset, hasMore: false, metadata: { status: 'pending', startTime: Date.now(), duration: 0, eventCount: 0 } };
  });

  router.handle('agent.ls', () => ({
    agents: discoveredAgents.map(a => ({
      id: a.id, name: a.name, icon: a.icon, path: a.path,
      protocol: a.protocol || 'unknown', description: a.description || '', status: 'available'
    }))
  }));

  router.handle('agent.subagents', async (p) => {
    const agent = discoveredAgents.find(x => x.id === p.id);
    if (!agent || agent.protocol !== 'acp') return { subAgents: [] };
    try {
      const data = await acpFetch(agent.acpPort || 8080, '/agents/search', {});
      const list = Array.isArray(data) ? data : (data?.agents || []);
      return { subAgents: list.map(a => ({ id: a.agent_id || a.id, name: a.metadata?.ref?.name || a.name || a.agent_id || a.id })) };
    } catch (_) { return { subAgents: [] }; }
  });

  router.handle('agent.get', (p) => {
    const a = discoveredAgents.find(x => x.id === p.id);
    if (!a) throw { code: 404, message: 'Agent not found' };
    return { id: a.id, name: a.name, description: a.description || '', icon: a.icon || null, status: 'available' };
  });

  router.handle('agent.desc', (p) => {
    const d = getAgentDescriptor(p.id);
    if (!d) throw { code: 404, message: 'Agent not found' };
    return d;
  });

  router.handle('agent.models', async (p) => {
    const cached = modelCache.get(p.id);
    if (cached && (Date.now() - cached.ts) < 300000) return { models: cached.models };
    const agent = discoveredAgents.find(x => x.id === p.id);
    if (agent?.protocol === 'acp') {
      const port = agent.acpPort || 8080;
      try {
        const data = await acpFetch(port, '/v1/models');
        const models = (data?.data || data?.models || []).map(m => ({
          id: m.id || m.model_id,
          label: m.name || m.display_name || m.id || m.model_id
        })).filter(m => m.id);
        if (models.length > 0) { modelCache.set(p.id, { models, ts: Date.now() }); return { models }; }
      } catch (_) {}
      try {
        const data = await acpFetch(port, '/agents/search', {});
        const list = Array.isArray(data) ? data : (data?.agents || []);
        const allModels = new Map();
        for (const a of list) {
          const agentId = a.agent_id || a.id;
          const name = a.metadata?.ref?.name || a.name || agentId;
          if (agentId && name) allModels.set(agentId, name);
          for (const m of (a.metadata?.models || a.specs?.models || [])) {
            const id = m.id || m;
            if (id) allModels.set(id, m.name || m.label || id);
          }
          try {
            const desc = await acpFetch(port, `/agents/${agentId}/descriptor`);
            const enumVals = desc?.specs?.config?.properties?.model?.enum || desc?.specs?.input?.properties?.model?.enum || [];
            for (const v of enumVals) allModels.set(v, v);
          } catch (_) {}
        }
        if (allModels.size > 0) {
          const models = Array.from(allModels.entries()).map(([id, label]) => ({ id, label }));
          modelCache.set(p.id, { models, ts: Date.now() });
          return { models };
        }
      } catch (_) {}
    }
    const acpAgents = discoveredAgents.filter(x => x.protocol === 'acp');
    for (const acpAgent of acpAgents) {
      const port = acpAgent.acpPort || 8080;
      try {
        const desc = await acpFetch(port, `/agents/${p.id}/descriptor`);
        if (desc) {
          const enumVals = desc?.specs?.config?.properties?.model?.enum || desc?.specs?.input?.properties?.model?.enum || [];
          if (enumVals.length > 0) {
            const models = enumVals.map(v => ({ id: v, label: v }));
            modelCache.set(p.id, { models, ts: Date.now() });
            return { models };
          }
          const name = desc?.metadata?.ref?.name;
          if (name) { const models = [{ id: p.id, label: name }]; modelCache.set(p.id, { models, ts: Date.now() }); return { models }; }
        }
      } catch (_) {}
    }
    return { models: [] };
  });

  router.handle('agent.search', (p) => db.searchAgents(discoveredAgents, p.query || p));

  router.handle('agent.auth', async (p) => {
    const agentId = p.id;
    if (!discoveredAgents.find(a => a.id === agentId)) throw { code: 404, message: 'Agent not found' };
    if (agentId === 'gemini') {
      const result = await startGeminiOAuth();
      const cid = '__agent_auth__';
      broadcastSync({ type: 'script_started', conversationId: cid, script: 'auth-gemini', agentId: 'gemini', timestamp: Date.now() });
      broadcastSync({ type: 'script_output', conversationId: cid, data: `\x1b[36mOpening Google OAuth...\x1b[0m\r\n\r\nVisit:\r\n${result.authUrl}\r\n`, stream: 'stdout', timestamp: Date.now() });
      const pollId = setInterval(() => {
        const st = geminiOAuthState();
        if (st.status === 'success') {
          clearInterval(pollId);
          broadcastSync({ type: 'script_output', conversationId: cid, data: `\r\n\x1b[32mAuth OK${st.email ? ' (' + st.email + ')' : ''}\x1b[0m\r\n`, stream: 'stdout', timestamp: Date.now() });
          broadcastSync({ type: 'script_stopped', conversationId: cid, code: 0, timestamp: Date.now() });
        } else if (st.status === 'error') {
          clearInterval(pollId);
          broadcastSync({ type: 'script_output', conversationId: cid, data: `\r\n\x1b[31mAuth failed: ${st.error}\x1b[0m\r\n`, stream: 'stderr', timestamp: Date.now() });
          broadcastSync({ type: 'script_stopped', conversationId: cid, code: 1, error: st.error, timestamp: Date.now() });
        }
      }, 1000);
      setTimeout(() => clearInterval(pollId), 5 * 60 * 1000);
      return { ok: true, agentId, authUrl: result.authUrl, mode: result.mode };
    }
    const cmds = { 'claude-code': { cmd: 'claude', args: ['setup-token'] }, 'opencode': { cmd: 'opencode', args: ['auth', 'login'] } };
    const c = cmds[agentId];
    if (!c) throw { code: 400, message: 'No auth command for this agent' };
    const pid = spawnScript(c.cmd, c.args, '__agent_auth__', 'auth-' + agentId, agentId, { activeScripts, broadcastSync });
    return { ok: true, agentId, pid };
  });

  router.handle('agent.authstat', () => ({ agents: discoveredAgents.map(checkAgentAuth) }));

  router.handle('agent.update', (p) => {
    const cmds = { 'claude-code': { cmd: 'claude', args: ['update', '--yes'] } };
    const c = cmds[p.id];
    if (!c) throw { code: 400, message: 'No update command for this agent' };
    const pid = spawnScript(c.cmd, c.args, '__agent_update__', 'update-' + p.id, p.id, { activeScripts, broadcastSync, modelCache });
    return { ok: true, agentId: p.id, pid };
  });
}
