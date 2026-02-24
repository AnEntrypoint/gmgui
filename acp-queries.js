import { randomUUID } from 'crypto';
const gid = (p) => `${p}-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`;
const uuid = () => randomUUID();
const iso = (t) => new Date(t).toISOString();
const j = (o) => JSON.stringify(o);
const jp = (s) => { try { return JSON.parse(s); } catch { return {}; } };

export function createACPQueries(db, prep) {
  return {
    createThread(metadata = {}) {
      const id = uuid(), now = Date.now();
      prep('INSERT INTO conversations (id, agentId, title, created_at, updated_at, status, metadata) VALUES (?, ?, ?, ?, ?, ?, ?)').run(id, 'unknown', null, now, now, 'idle', j(metadata));
      return { thread_id: id, created_at: iso(now), updated_at: iso(now), metadata, status: 'idle' };
    },
    getThread(tid) {
      const r = prep('SELECT * FROM conversations WHERE id = ?').get(tid);
      if (!r) return null;
      return { thread_id: r.id, created_at: iso(r.created_at), updated_at: iso(r.updated_at), metadata: jp(r.metadata), status: r.status || 'idle' };
    },
    patchThread(tid, upd) {
      const t = this.getThread(tid);
      if (!t) throw new Error('Thread not found');
      const now = Date.now(), meta = upd.metadata !== undefined ? upd.metadata : t.metadata, stat = upd.status !== undefined ? upd.status : t.status;
      prep('UPDATE conversations SET metadata = ?, status = ?, updated_at = ? WHERE id = ?').run(j(meta), stat, now, tid);
      return { thread_id: tid, created_at: t.created_at, updated_at: iso(now), metadata: meta, status: stat };
    },
    deleteThread(tid) {
      const pr = prep('SELECT COUNT(*) as count FROM run_metadata WHERE thread_id = ? AND status = ?').get(tid, 'pending');
      if (pr && pr.count > 0) throw new Error('Cannot delete thread with pending runs');
      db.transaction(() => {
        prep('DELETE FROM thread_states WHERE thread_id = ?').run(tid);
        prep('DELETE FROM checkpoints WHERE thread_id = ?').run(tid);
        prep('DELETE FROM run_metadata WHERE thread_id = ?').run(tid);
        prep('DELETE FROM sessions WHERE conversationId = ?').run(tid);
        prep('DELETE FROM messages WHERE conversationId = ?').run(tid);
        prep('DELETE FROM chunks WHERE conversationId = ?').run(tid);
        prep('DELETE FROM events WHERE conversationId = ?').run(tid);
        prep('DELETE FROM conversations WHERE id = ?').run(tid);
      })();
      return true;
    },
    saveThreadState(tid, cid, sd) {
      const id = gid('state'), now = Date.now();
      prep('INSERT INTO thread_states (id, thread_id, checkpoint_id, state_data, created_at) VALUES (?, ?, ?, ?, ?)').run(id, tid, cid, j(sd), now);
      return { id, thread_id: tid, checkpoint_id: cid, created_at: iso(now) };
    },
    getThreadState(tid, cid = null) {
      const r = cid ? prep('SELECT * FROM thread_states WHERE thread_id = ? AND checkpoint_id = ? ORDER BY created_at DESC LIMIT 1').get(tid, cid) : prep('SELECT * FROM thread_states WHERE thread_id = ? ORDER BY created_at DESC LIMIT 1').get(tid);
      if (!r) return null;
      const sd = jp(r.state_data);
      return { checkpoint: { checkpoint_id: r.checkpoint_id }, values: sd.values || {}, messages: sd.messages || [], metadata: sd.metadata || {} };
    },
    getThreadHistory(tid, lim = 50, off = 0) {
      const tot = prep('SELECT COUNT(*) as count FROM thread_states WHERE thread_id = ?').get(tid).count;
      const rows = prep('SELECT * FROM thread_states WHERE thread_id = ? ORDER BY created_at DESC LIMIT ? OFFSET ?').all(tid, lim, off);
      const states = rows.map(r => { const sd = jp(r.state_data); return { checkpoint: { checkpoint_id: r.checkpoint_id }, values: sd.values || {}, messages: sd.messages || [], metadata: sd.metadata || {} }; });
      return { states, total: tot, limit: lim, offset: off, hasMore: off + lim < tot };
    },
    copyThread(stid) {
      const st = this.getThread(stid);
      if (!st) throw new Error('Source thread not found');
      const ntid = uuid(), now = Date.now();
      db.transaction(() => {
        prep('INSERT INTO conversations (id, agentId, title, created_at, updated_at, status, metadata, workingDirectory) SELECT ?, agentId, title || \' (copy)\', ?, ?, status, metadata, workingDirectory FROM conversations WHERE id = ?').run(ntid, now, now, stid);
        const cps = prep('SELECT * FROM checkpoints WHERE thread_id = ? ORDER BY sequence ASC').all(stid);
        cps.forEach(cp => prep('INSERT INTO checkpoints (id, thread_id, checkpoint_name, sequence, created_at) VALUES (?, ?, ?, ?, ?)').run(uuid(), ntid, cp.checkpoint_name, cp.sequence, now));
        const sts = prep('SELECT * FROM thread_states WHERE thread_id = ? ORDER BY created_at ASC').all(stid);
        sts.forEach(s => prep('INSERT INTO thread_states (id, thread_id, checkpoint_id, state_data, created_at) VALUES (?, ?, ?, ?, ?)').run(gid('state'), ntid, s.checkpoint_id, s.state_data, now));
        const msgs = prep('SELECT * FROM messages WHERE conversationId = ? ORDER BY created_at ASC').all(stid);
        msgs.forEach(m => prep('INSERT INTO messages (id, conversationId, role, content, created_at) VALUES (?, ?, ?, ?, ?)').run(gid('msg'), ntid, m.role, m.content, now));
      })();
      return this.getThread(ntid);
    },
    createCheckpoint(tid, name = null) {
      const id = uuid(), now = Date.now();
      const ms = prep('SELECT MAX(sequence) as max FROM checkpoints WHERE thread_id = ?').get(tid);
      const seq = (ms?.max ?? -1) + 1;
      prep('INSERT INTO checkpoints (id, thread_id, checkpoint_name, sequence, created_at) VALUES (?, ?, ?, ?, ?)').run(id, tid, name, seq, now);
      return { checkpoint_id: id, thread_id: tid, checkpoint_name: name, sequence: seq, created_at: iso(now) };
    },
    getCheckpoint(cid) {
      const r = prep('SELECT * FROM checkpoints WHERE id = ?').get(cid);
      if (!r) return null;
      return { checkpoint_id: r.id, thread_id: r.thread_id, checkpoint_name: r.checkpoint_name, sequence: r.sequence, created_at: iso(r.created_at) };
    },
    listCheckpoints(tid, lim = 50, off = 0) {
      const tot = prep('SELECT COUNT(*) as count FROM checkpoints WHERE thread_id = ?').get(tid).count;
      const rows = prep('SELECT * FROM checkpoints WHERE thread_id = ? ORDER BY sequence DESC LIMIT ? OFFSET ?').all(tid, lim, off);
      const cps = rows.map(r => ({ checkpoint_id: r.id, thread_id: r.thread_id, checkpoint_name: r.checkpoint_name, sequence: r.sequence, created_at: iso(r.created_at) }));
      return { checkpoints: cps, total: tot, limit: lim, offset: off, hasMore: off + lim < tot };
    },
    createRun(aid, tid = null, inp = null, cfg = null, wh = null) {
      const rid = uuid(), now = Date.now(), mid = gid('runmeta');
      let atid = tid;
      if (!tid) {
        atid = uuid();
        prep('INSERT INTO conversations (id, agentId, title, created_at, updated_at, status, metadata) VALUES (?, ?, ?, ?, ?, ?, ?)').run(atid, aid, 'Stateless Run', now, now, 'idle', '{"stateless":true}');
      }
      prep('INSERT INTO sessions (id, conversationId, status, started_at, completed_at, response, error) VALUES (?, ?, ?, ?, ?, ?, ?)').run(rid, atid, 'pending', now, null, null, null);
      prep('INSERT INTO run_metadata (id, run_id, thread_id, agent_id, status, input, config, webhook_url, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)').run(mid, rid, tid, aid, 'pending', inp ? j(inp) : null, cfg ? j(cfg) : null, wh, now, now);
      return { run_id: rid, thread_id: tid, agent_id: aid, status: 'pending', created_at: iso(now), updated_at: iso(now) };
    },
    getRun(rid) {
      const r = prep('SELECT * FROM run_metadata WHERE run_id = ?').get(rid);
      if (!r) return null;
      return { run_id: r.run_id, thread_id: r.thread_id, agent_id: r.agent_id, status: r.status, created_at: iso(r.created_at), updated_at: iso(r.updated_at) };
    },
    updateRunStatus(rid, stat) {
      const now = Date.now();
      prep('UPDATE run_metadata SET status = ?, updated_at = ? WHERE run_id = ?').run(stat, now, rid);
      prep('UPDATE sessions SET status = ? WHERE id = ?').run(stat, rid);
      return this.getRun(rid);
    },
    cancelRun(rid) {
      const r = this.getRun(rid);
      if (!r) throw new Error('Run not found');
      if (['success', 'error', 'cancelled'].includes(r.status)) throw new Error('Run already completed or cancelled');
      return this.updateRunStatus(rid, 'cancelled');
    },
    deleteRun(rid) {
      db.transaction(() => {
        prep('DELETE FROM chunks WHERE sessionId = ?').run(rid);
        prep('DELETE FROM events WHERE sessionId = ?').run(rid);
        prep('DELETE FROM run_metadata WHERE run_id = ?').run(rid);
        prep('DELETE FROM sessions WHERE id = ?').run(rid);
      })();
      return true;
    },
    getThreadRuns(tid, lim = 50, off = 0) {
      const tot = prep('SELECT COUNT(*) as count FROM run_metadata WHERE thread_id = ?').get(tid).count;
      const rows = prep('SELECT * FROM run_metadata WHERE thread_id = ? ORDER BY created_at DESC LIMIT ? OFFSET ?').all(tid, lim, off);
      const runs = rows.map(r => ({ run_id: r.run_id, thread_id: r.thread_id, agent_id: r.agent_id, status: r.status, created_at: iso(r.created_at), updated_at: iso(r.updated_at) }));
      return { runs, total: tot, limit: lim, offset: off, hasMore: off + lim < tot };
    },
    searchThreads(flt = {}) {
      const { metadata, status, dateRange, limit = 50, offset = 0 } = flt;
      let wh = "status != 'deleted'", prm = [];
      if (status) { wh += ' AND status = ?'; prm.push(status); }
      if (dateRange?.start) { wh += ' AND created_at >= ?'; prm.push(new Date(dateRange.start).getTime()); }
      if (dateRange?.end) { wh += ' AND created_at <= ?'; prm.push(new Date(dateRange.end).getTime()); }
      if (metadata) { for (const [k, v] of Object.entries(metadata)) { wh += ' AND metadata LIKE ?'; prm.push(`%"${k}":"${v}"%`); } }
      const tot = prep(`SELECT COUNT(*) as count FROM conversations WHERE ${wh}`).get(...prm).count;
      const rows = prep(`SELECT * FROM conversations WHERE ${wh} ORDER BY updated_at DESC LIMIT ? OFFSET ?`).all(...prm, limit, offset);
      const ths = rows.map(r => ({ thread_id: r.id, created_at: iso(r.created_at), updated_at: iso(r.updated_at), metadata: jp(r.metadata), status: r.status || 'idle' }));
      return { threads: ths, total: tot, limit, offset, hasMore: offset + limit < tot };
    },
    searchAgents(agents, flt = {}) {
      const { name, version, capabilities, limit = 50, offset = 0 } = flt;
      let results = agents;
      if (name) {
        const n = name.toLowerCase();
        results = results.filter(a => a.name.toLowerCase().includes(n) || a.id.toLowerCase().includes(n));
      }
      if (capabilities) {
        results = results.filter(a => {
          const desc = this.getAgentDescriptor ? this.getAgentDescriptor(a.id) : null;
          if (!desc) return false;
          const caps = desc.specs?.capabilities || {};
          if (capabilities.streaming !== undefined && !caps.streaming) return false;
          if (capabilities.threads !== undefined && caps.threads !== capabilities.threads) return false;
          if (capabilities.interrupts !== undefined && caps.interrupts !== capabilities.interrupts) return false;
          return true;
        });
      }
      const total = results.length;
      const paginated = results.slice(offset, offset + limit);
      const agents_list = paginated.map(a => ({ agent_id: a.id, name: a.name, version: version || '1.0.0', path: a.path }));
      return { agents: agents_list, total, limit, offset, hasMore: offset + limit < total };
    },
    searchRuns(flt = {}) {
      const { agent_id, thread_id, status, limit = 50, offset = 0 } = flt;
      let wh = '1=1', prm = [];
      if (agent_id) { wh += ' AND agent_id = ?'; prm.push(agent_id); }
      if (thread_id) { wh += ' AND thread_id = ?'; prm.push(thread_id); }
      if (status) { wh += ' AND status = ?'; prm.push(status); }
      const tot = prep(`SELECT COUNT(*) as count FROM run_metadata WHERE ${wh}`).get(...prm).count;
      const rows = prep(`SELECT * FROM run_metadata WHERE ${wh} ORDER BY created_at DESC LIMIT ? OFFSET ?`).all(...prm, limit, offset);
      const runs = rows.map(r => ({ run_id: r.run_id, thread_id: r.thread_id, agent_id: r.agent_id, status: r.status, created_at: iso(r.created_at), updated_at: iso(r.updated_at) }));
      return { runs, total: tot, limit, offset, hasMore: offset + limit < tot };
    }
  };
}
