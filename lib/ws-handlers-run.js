function err(code, message) { const e = new Error(message); e.code = code; throw e; }
function need(p, key) { if (!p[key]) err(400, `Missing required param: ${key}`); return p[key]; }

function register(router, deps) {
  const { queries, discoveredAgents, activeExecutions, activeProcessesByRunId, broadcastSync, processMessageWithStreaming } = deps;

  function findAgent(id) { const a = discoveredAgents.find(x => x.id === id); if (!a) err(404, 'Agent not found'); return a; }
  function getRunOrThrow(id) { const r = queries.getRun(id); if (!r) err(404, 'Run not found'); return r; }
  function getThreadOrThrow(id) { const t = queries.getThread(id); if (!t) err(404, 'Thread not found'); return t; }

  function killExecution(threadId, runId) {
    const ex = activeExecutions.get(threadId);
    if (ex?.pid) {
      try { process.kill(-ex.pid, 'SIGTERM'); } catch { try { process.kill(ex.pid, 'SIGTERM'); } catch {} }
      setTimeout(() => { try { process.kill(-ex.pid, 'SIGKILL'); } catch { try { process.kill(ex.pid, 'SIGKILL'); } catch {} } }, 3000);
    }
    if (ex?.sessionId) queries.updateSession(ex.sessionId, { status: 'error', error: 'Cancelled by user', completed_at: Date.now() });
    activeExecutions.delete(threadId);
    activeProcessesByRunId.delete(runId);
    queries.setIsStreaming(threadId, false);
    return ex;
  }

  function startExecution(runId, threadId, agentId, input, config) {
    const conv = queries.getConversation(threadId);
    if (!conv || !input?.content) return;
    const session = queries.createSession(threadId);
    queries.updateRunStatus(runId, 'active');
    activeExecutions.set(threadId, { pid: null, startTime: Date.now(), sessionId: session.id, lastActivity: Date.now() });
    activeProcessesByRunId.set(runId, { threadId, sessionId: session.id });
    queries.setIsStreaming(threadId, true);
    processMessageWithStreaming(threadId, null, session.id, input.content, agentId, config?.model || null)
      .then(() => { queries.updateRunStatus(runId, 'success'); activeProcessesByRunId.delete(runId); })
      .catch(() => { queries.updateRunStatus(runId, 'error'); activeProcessesByRunId.delete(runId); });
  }

  router.handle('run.new', async (p) => {
    findAgent(need(p, 'agent_id'));
    return queries.createRun(p.agent_id, p.thread_id || null, p.input || null, p.config || null, p.webhook_url || null);
  });

  router.handle('run.get', async (p) => getRunOrThrow(need(p, 'id')));

  router.handle('run.del', async (p) => {
    try { queries.deleteRun(need(p, 'id')); } catch { err(404, 'Run not found'); }
    return { deleted: true };
  });

  router.handle('run.resume', async (p) => {
    const id = need(p, 'id'), run = getRunOrThrow(id);
    if (run.status !== 'pending') err(409, 'Run is not resumable');
    if (run.thread_id) startExecution(id, run.thread_id, run.agent_id, p.input, p.config);
    return queries.getRun(id) || run;
  });

  router.handle('run.cancel', async (p) => {
    const id = need(p, 'id'), run = getRunOrThrow(id);
    if (['success', 'error', 'cancelled'].includes(run.status)) err(409, 'Run already completed or cancelled');
    const cancelled = queries.cancelRun(id);
    if (run.thread_id) {
      const ex = killExecution(run.thread_id, id);
      broadcastSync({ type: 'streaming_cancelled', sessionId: ex?.sessionId || id, conversationId: run.thread_id, runId: id, timestamp: Date.now() });
    }
    return cancelled;
  });

  router.handle('run.search', async (p) => queries.searchRuns(p));

  router.handle('run.wait', async (p) => {
    const id = need(p, 'id');
    getRunOrThrow(id);
    const timeout = p.timeout || 30000, start = Date.now();
    return new Promise((resolve) => {
      const poll = setInterval(() => {
        const cur = queries.getRun(id);
        if (cur && ['success', 'error', 'cancelled'].includes(cur.status)) { clearInterval(poll); resolve(cur); }
        else if (Date.now() - start > timeout) { clearInterval(poll); resolve({ error: 'Run still pending', run_id: id, status: cur?.status }); }
      }, 500);
    });
  });

  router.handle('run.stream', async (p) => {
    const agent_id = need(p, 'agent_id');
    findAgent(agent_id);
    const run = queries.createRun(agent_id, null, p.input, p.config);
    const threadId = queries.getRun(run.run_id)?.thread_id;
    if (threadId) startExecution(run.run_id, threadId, agent_id, p.input, p.config);
    return run;
  });

  router.handle('run.stream.get', async (p) => getRunOrThrow(need(p, 'id')));

  router.handle('thread.new', async (p) => queries.createThread(p.metadata || {}));
  router.handle('thread.search', async (p) => queries.searchThreads(p));
  router.handle('thread.get', async (p) => getThreadOrThrow(need(p, 'id')));

  router.handle('thread.upd', async (p) => {
    try { return queries.patchThread(need(p, 'id'), p); } catch (e) {
      if (e.message.includes('not found')) err(404, e.message);
      throw e;
    }
  });

  router.handle('thread.del', async (p) => {
    try { queries.deleteThread(need(p, 'id')); return { deleted: true }; } catch (e) {
      if (e.message.includes('not found')) err(404, e.message);
      if (e.message.includes('pending runs')) err(409, e.message);
      throw e;
    }
  });

  router.handle('thread.history', async (p) => {
    const id = need(p, 'id'), limit = p.limit || 50, offset = p.before ? parseInt(p.before, 10) : 0;
    const result = queries.getThreadHistory(id, limit, offset);
    return { states: result.states, next_cursor: result.hasMore ? String(offset + limit) : null };
  });

  router.handle('thread.copy', async (p) => {
    try {
      const nt = queries.copyThread(need(p, 'id'));
      return p.metadata ? queries.patchThread(nt.thread_id, { metadata: p.metadata }) : nt;
    } catch (e) {
      if (e.message.includes('not found')) err(404, e.message);
      throw e;
    }
  });

  router.handle('thread.run.stream', async (p) => {
    const threadId = need(p, 'id'), agent_id = need(p, 'agent_id');
    const thread = getThreadOrThrow(threadId);
    if (thread.status !== 'idle') err(409, 'Thread has pending runs');
    findAgent(agent_id);
    const run = queries.createRun(agent_id, threadId, p.input, p.config);
    startExecution(run.run_id, threadId, agent_id, p.input, p.config);
    return run;
  });

  router.handle('thread.run.cancel', async (p) => {
    const threadId = need(p, 'id'), runId = need(p, 'runId'), run = getRunOrThrow(runId);
    if (run.thread_id !== threadId) err(400, 'Run does not belong to specified thread');
    if (['success', 'error', 'cancelled'].includes(run.status)) err(409, 'Run already completed or cancelled');
    const cancelled = queries.cancelRun(runId);
    const ex = killExecution(threadId, runId);
    broadcastSync({ type: 'run_cancelled', runId, threadId, sessionId: ex?.sessionId, timestamp: Date.now() });
    return cancelled;
  });

  router.handle('thread.run.stream.get', async (p) => {
    const threadId = need(p, 'id'), runId = need(p, 'runId');
    getThreadOrThrow(threadId);
    const run = queries.getRun(runId);
    if (!run || run.thread_id !== threadId) err(404, 'Run not found on thread');
    return run;
  });
}

export { register };
