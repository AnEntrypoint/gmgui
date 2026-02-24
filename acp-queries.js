// ACP-Compatible Data Layer
// Provides query functions that return ACP v0.2.3 compatible data structures

import { randomUUID } from 'crypto';

// Helper to generate IDs
function generateId(prefix) {
  return `${prefix}-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`;
}

// Helper to generate UUID
function generateUUID() {
  return randomUUID();
}

// Helper to convert timestamp to ISO date string
function toISOString(timestamp) {
  return new Date(timestamp).toISOString();
}

export function createACPQueries(db, prep) {
  return {
    // ============ THREAD CRUD ============

    createThread(metadata = {}) {
      const threadId = generateUUID();
      const now = Date.now();

      const stmt = prep(
        `INSERT INTO conversations (id, agentId, title, created_at, updated_at, status, metadata)
         VALUES (?, ?, ?, ?, ?, ?, ?)`
      );
      stmt.run(threadId, 'unknown', null, now, now, 'idle', JSON.stringify(metadata));

      return {
        thread_id: threadId,
        created_at: toISOString(now),
        updated_at: toISOString(now),
        metadata,
        status: 'idle'
      };
    },

    getThread(threadId) {
      const stmt = prep('SELECT * FROM conversations WHERE id = ?');
      const row = stmt.get(threadId);

      if (!row) return null;

      let metadata = {};
      if (row.metadata) {
        try {
          metadata = JSON.parse(row.metadata);
        } catch (e) {}
      }

      return {
        thread_id: row.id,
        created_at: toISOString(row.created_at),
        updated_at: toISOString(row.updated_at),
        metadata,
        status: row.status || 'idle'
      };
    },

    patchThread(threadId, updates) {
      const thread = this.getThread(threadId);
      if (!thread) {
        throw new Error('Thread not found');
      }

      const now = Date.now();
      const newMetadata = updates.metadata !== undefined ? updates.metadata : thread.metadata;
      const newStatus = updates.status !== undefined ? updates.status : thread.status;

      const stmt = prep(
        `UPDATE conversations SET metadata = ?, status = ?, updated_at = ? WHERE id = ?`
      );
      stmt.run(JSON.stringify(newMetadata), newStatus, now, threadId);

      return {
        thread_id: threadId,
        created_at: thread.created_at,
        updated_at: toISOString(now),
        metadata: newMetadata,
        status: newStatus
      };
    },

    deleteThread(threadId) {
      // Check for pending runs
      const pendingRuns = prep(
        `SELECT COUNT(*) as count FROM run_metadata WHERE thread_id = ? AND status = 'pending'`
      ).get(threadId);

      if (pendingRuns && pendingRuns.count > 0) {
        throw new Error('Cannot delete thread with pending runs');
      }

      const deleteStmt = db.transaction(() => {
        prep('DELETE FROM thread_states WHERE thread_id = ?').run(threadId);
        prep('DELETE FROM checkpoints WHERE thread_id = ?').run(threadId);
        prep('DELETE FROM run_metadata WHERE thread_id = ?').run(threadId);
        prep('DELETE FROM sessions WHERE conversationId = ?').run(threadId);
        prep('DELETE FROM messages WHERE conversationId = ?').run(threadId);
        prep('DELETE FROM chunks WHERE conversationId = ?').run(threadId);
        prep('DELETE FROM events WHERE conversationId = ?').run(threadId);
        prep('DELETE FROM conversations WHERE id = ?').run(threadId);
      });

      deleteStmt();
      return true;
    },

    // ============ THREAD STATE MANAGEMENT ============

    saveThreadState(threadId, checkpointId, stateData) {
      const id = generateId('state');
      const now = Date.now();

      const stmt = prep(
        `INSERT INTO thread_states (id, thread_id, checkpoint_id, state_data, created_at)
         VALUES (?, ?, ?, ?, ?)`
      );
      stmt.run(id, threadId, checkpointId, JSON.stringify(stateData), now);

      return {
        id,
        thread_id: threadId,
        checkpoint_id: checkpointId,
        created_at: toISOString(now)
      };
    },

    getThreadState(threadId, checkpointId = null) {
      let stmt, row;

      if (checkpointId) {
        stmt = prep(
          `SELECT * FROM thread_states WHERE thread_id = ? AND checkpoint_id = ? ORDER BY created_at DESC LIMIT 1`
        );
        row = stmt.get(threadId, checkpointId);
      } else {
        stmt = prep(
          `SELECT * FROM thread_states WHERE thread_id = ? ORDER BY created_at DESC LIMIT 1`
        );
        row = stmt.get(threadId);
      }

      if (!row) return null;

      let stateData = {};
      try {
        stateData = JSON.parse(row.state_data);
      } catch (e) {}

      return {
        checkpoint: { checkpoint_id: row.checkpoint_id },
        values: stateData.values || {},
        messages: stateData.messages || [],
        metadata: stateData.metadata || {}
      };
    },

    getThreadHistory(threadId, limit = 50, offset = 0) {
      const countStmt = prep('SELECT COUNT(*) as count FROM thread_states WHERE thread_id = ?');
      const total = countStmt.get(threadId).count;

      const stmt = prep(
        `SELECT * FROM thread_states WHERE thread_id = ? ORDER BY created_at DESC LIMIT ? OFFSET ?`
      );
      const rows = stmt.all(threadId, limit, offset);

      const states = rows.map(row => {
        let stateData = {};
        try {
          stateData = JSON.parse(row.state_data);
        } catch (e) {}

        return {
          checkpoint: { checkpoint_id: row.checkpoint_id },
          values: stateData.values || {},
          messages: stateData.messages || [],
          metadata: stateData.metadata || {}
        };
      });

      return {
        states,
        total,
        limit,
        offset,
        hasMore: offset + limit < total
      };
    },

    copyThread(sourceThreadId) {
      const sourceThread = this.getThread(sourceThreadId);
      if (!sourceThread) {
        throw new Error('Source thread not found');
      }

      const newThreadId = generateUUID();
      const now = Date.now();

      const copyStmt = db.transaction(() => {
        // Copy thread
        prep(
          `INSERT INTO conversations (id, agentId, title, created_at, updated_at, status, metadata, workingDirectory)
           SELECT ?, agentId, title || ' (copy)', ?, ?, status, metadata, workingDirectory
           FROM conversations WHERE id = ?`
        ).run(newThreadId, now, now, sourceThreadId);

        // Copy checkpoints
        const checkpoints = prep('SELECT * FROM checkpoints WHERE thread_id = ? ORDER BY sequence ASC').all(sourceThreadId);
        for (const checkpoint of checkpoints) {
          const newCheckpointId = generateUUID();
          prep(
            `INSERT INTO checkpoints (id, thread_id, checkpoint_name, sequence, created_at)
             VALUES (?, ?, ?, ?, ?)`
          ).run(newCheckpointId, newThreadId, checkpoint.checkpoint_name, checkpoint.sequence, now);
        }

        // Copy thread states
        const states = prep('SELECT * FROM thread_states WHERE thread_id = ? ORDER BY created_at ASC').all(sourceThreadId);
        for (const state of states) {
          prep(
            `INSERT INTO thread_states (id, thread_id, checkpoint_id, state_data, created_at)
             VALUES (?, ?, ?, ?, ?)`
          ).run(generateId('state'), newThreadId, state.checkpoint_id, state.state_data, now);
        }

        // Copy messages
        const messages = prep('SELECT * FROM messages WHERE conversationId = ? ORDER BY created_at ASC').all(sourceThreadId);
        for (const msg of messages) {
          prep(
            `INSERT INTO messages (id, conversationId, role, content, created_at)
             VALUES (?, ?, ?, ?, ?)`
          ).run(generateId('msg'), newThreadId, msg.role, msg.content, now);
        }
      });

      copyStmt();
      return this.getThread(newThreadId);
    },

    // ============ CHECKPOINT FUNCTIONS ============

    createCheckpoint(threadId, checkpointName = null) {
      const id = generateUUID();
      const now = Date.now();

      // Get next sequence number
      const maxSeq = prep('SELECT MAX(sequence) as max FROM checkpoints WHERE thread_id = ?').get(threadId);
      const sequence = (maxSeq?.max ?? -1) + 1;

      const stmt = prep(
        `INSERT INTO checkpoints (id, thread_id, checkpoint_name, sequence, created_at)
         VALUES (?, ?, ?, ?, ?)`
      );
      stmt.run(id, threadId, checkpointName, sequence, now);

      return {
        checkpoint_id: id,
        thread_id: threadId,
        checkpoint_name: checkpointName,
        sequence,
        created_at: toISOString(now)
      };
    },

    getCheckpoint(checkpointId) {
      const stmt = prep('SELECT * FROM checkpoints WHERE id = ?');
      const row = stmt.get(checkpointId);

      if (!row) return null;

      return {
        checkpoint_id: row.id,
        thread_id: row.thread_id,
        checkpoint_name: row.checkpoint_name,
        sequence: row.sequence,
        created_at: toISOString(row.created_at)
      };
    },

    listCheckpoints(threadId, limit = 50, offset = 0) {
      const countStmt = prep('SELECT COUNT(*) as count FROM checkpoints WHERE thread_id = ?');
      const total = countStmt.get(threadId).count;

      const stmt = prep(
        `SELECT * FROM checkpoints WHERE thread_id = ? ORDER BY sequence DESC LIMIT ? OFFSET ?`
      );
      const rows = stmt.all(threadId, limit, offset);

      const checkpoints = rows.map(row => ({
        checkpoint_id: row.id,
        thread_id: row.thread_id,
        checkpoint_name: row.checkpoint_name,
        sequence: row.sequence,
        created_at: toISOString(row.created_at)
      }));

      return {
        checkpoints,
        total,
        limit,
        offset,
        hasMore: offset + limit < total
      };
    },

    // ============ RUN MANAGEMENT ============

    createRun(agentId, threadId = null, input = null, config = null, webhookUrl = null) {
      const runId = generateUUID();
      const now = Date.now();

      // Create session first
      const sessionStmt = prep(
        `INSERT INTO sessions (id, conversationId, status, started_at, completed_at, response, error)
         VALUES (?, ?, ?, ?, ?, ?, ?)`
      );
      sessionStmt.run(runId, threadId || 'stateless', 'pending', now, null, null, null);

      // Create run metadata
      const runStmt = prep(
        `INSERT INTO run_metadata (run_id, thread_id, agent_id, status, input, config, webhook_url, created_at, updated_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`
      );
      runStmt.run(
        runId,
        threadId,
        agentId,
        'pending',
        input ? JSON.stringify(input) : null,
        config ? JSON.stringify(config) : null,
        webhookUrl,
        now,
        now
      );

      return {
        run_id: runId,
        thread_id: threadId,
        agent_id: agentId,
        status: 'pending',
        created_at: toISOString(now),
        updated_at: toISOString(now)
      };
    },

    getRun(runId) {
      const stmt = prep('SELECT * FROM run_metadata WHERE run_id = ?');
      const row = stmt.get(runId);

      if (!row) return null;

      return {
        run_id: row.run_id,
        thread_id: row.thread_id,
        agent_id: row.agent_id,
        status: row.status,
        created_at: toISOString(row.created_at),
        updated_at: toISOString(row.updated_at)
      };
    },

    updateRunStatus(runId, status) {
      const now = Date.now();

      const stmt = prep(
        `UPDATE run_metadata SET status = ?, updated_at = ? WHERE run_id = ?`
      );
      stmt.run(status, now, runId);

      // Also update session
      prep('UPDATE sessions SET status = ? WHERE id = ?').run(status, runId);

      return this.getRun(runId);
    },

    cancelRun(runId) {
      const run = this.getRun(runId);
      if (!run) {
        throw new Error('Run not found');
      }

      if (['success', 'error', 'cancelled'].includes(run.status)) {
        throw new Error('Run already completed or cancelled');
      }

      return this.updateRunStatus(runId, 'cancelled');
    },

    deleteRun(runId) {
      const deleteStmt = db.transaction(() => {
        prep('DELETE FROM chunks WHERE sessionId = ?').run(runId);
        prep('DELETE FROM events WHERE sessionId = ?').run(runId);
        prep('DELETE FROM run_metadata WHERE run_id = ?').run(runId);
        prep('DELETE FROM sessions WHERE id = ?').run(runId);
      });

      deleteStmt();
      return true;
    },

    getThreadRuns(threadId, limit = 50, offset = 0) {
      const countStmt = prep('SELECT COUNT(*) as count FROM run_metadata WHERE thread_id = ?');
      const total = countStmt.get(threadId).count;

      const stmt = prep(
        `SELECT * FROM run_metadata WHERE thread_id = ? ORDER BY created_at DESC LIMIT ? OFFSET ?`
      );
      const rows = stmt.all(threadId, limit, offset);

      const runs = rows.map(row => ({
        run_id: row.run_id,
        thread_id: row.thread_id,
        agent_id: row.agent_id,
        status: row.status,
        created_at: toISOString(row.created_at),
        updated_at: toISOString(row.updated_at)
      }));

      return {
        runs,
        total,
        limit,
        offset,
        hasMore: offset + limit < total
      };
    },

    // ============ SEARCH FUNCTIONS ============

    searchThreads(filters = {}) {
      const { metadata, status, dateRange, limit = 50, offset = 0 } = filters;

      let whereClause = "status != 'deleted'";
      const params = [];

      if (status) {
        whereClause += ' AND status = ?';
        params.push(status);
      }

      if (dateRange?.start) {
        whereClause += ' AND created_at >= ?';
        params.push(new Date(dateRange.start).getTime());
      }

      if (dateRange?.end) {
        whereClause += ' AND created_at <= ?';
        params.push(new Date(dateRange.end).getTime());
      }

      if (metadata) {
        // Simple metadata filter - check if JSON contains key-value pairs
        for (const [key, value] of Object.entries(metadata)) {
          whereClause += ` AND metadata LIKE ?`;
          params.push(`%"${key}":"${value}"%`);
        }
      }

      const countStmt = prep(`SELECT COUNT(*) as count FROM conversations WHERE ${whereClause}`);
      const total = countStmt.get(...params).count;

      const stmt = prep(
        `SELECT * FROM conversations WHERE ${whereClause} ORDER BY updated_at DESC LIMIT ? OFFSET ?`
      );
      const rows = stmt.all(...params, limit, offset);

      const threads = rows.map(row => {
        let metadata = {};
        if (row.metadata) {
          try { metadata = JSON.parse(row.metadata); } catch (e) {}
        }
        return {
          thread_id: row.id,
          created_at: toISOString(row.created_at),
          updated_at: toISOString(row.updated_at),
          metadata,
          status: row.status || 'idle'
        };
      });

      return {
        threads,
        total,
        limit,
        offset,
        hasMore: offset + limit < total
      };
    },

    searchAgents(filters = {}) {
      // This would integrate with the agent discovery system
      // For now, return empty array as agents are discovered dynamically
      return [];
    },

    searchRuns(filters = {}) {
      const { agent_id, thread_id, status, limit = 50, offset = 0 } = filters;

      let whereClause = '1=1';
      const params = [];

      if (agent_id) {
        whereClause += ' AND agent_id = ?';
        params.push(agent_id);
      }

      if (thread_id) {
        whereClause += ' AND thread_id = ?';
        params.push(thread_id);
      }

      if (status) {
        whereClause += ' AND status = ?';
        params.push(status);
      }

      const countStmt = prep(`SELECT COUNT(*) as count FROM run_metadata WHERE ${whereClause}`);
      const total = countStmt.get(...params).count;

      const stmt = prep(
        `SELECT * FROM run_metadata WHERE ${whereClause} ORDER BY created_at DESC LIMIT ? OFFSET ?`
      );
      const rows = stmt.all(...params, limit, offset);

      const runs = rows.map(row => ({
        run_id: row.run_id,
        thread_id: row.thread_id,
        agent_id: row.agent_id,
        status: row.status,
        created_at: toISOString(row.created_at),
        updated_at: toISOString(row.updated_at)
      }));

      return {
        runs,
        total,
        limit,
        offset,
        hasMore: offset + limit < total
      };
    }
  };
}
