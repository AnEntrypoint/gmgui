import fs from 'fs';
import path from 'path';
import os from 'os';
import { createRequire } from 'module';

const require = createRequire(import.meta.url);

function getDataDir() {
  if (process.env.PORTABLE_DATA_DIR) {
    return process.env.PORTABLE_DATA_DIR;
  }
  const exeDir = process.pkg?.path ? path.dirname(process.pkg.path) : null;
  if (exeDir) {
    return path.join(exeDir, 'data');
  }
  if (process.env.BUN_BE_BUN && process.argv[1]) {
    return path.join(path.dirname(process.argv[1]), 'data');
  }
  return path.join(os.homedir(), '.gmgui');
}

export const dataDir = getDataDir();
const dbDir = dataDir;
const dbFilePath = path.join(dbDir, 'data.db');
const oldJsonPath = path.join(dbDir, 'data.json');

if (!fs.existsSync(dbDir)) {
  fs.mkdirSync(dbDir, { recursive: true });
}

let db;
try {
  const Database = (await import('bun:sqlite')).default;
  db = new Database(dbFilePath);
  db.run('PRAGMA journal_mode = WAL');
  db.run('PRAGMA foreign_keys = ON');
  db.run('PRAGMA encoding = "UTF-8"');
  db.run('PRAGMA synchronous = NORMAL');
  db.run('PRAGMA cache_size = -64000');
  db.run('PRAGMA mmap_size = 268435456');
  db.run('PRAGMA temp_store = MEMORY');
} catch (e) {
  try {
    const sqlite3 = require('better-sqlite3');
    db = new sqlite3(dbFilePath);
    db.pragma('journal_mode = WAL');
    db.pragma('foreign_keys = ON');
    db.pragma('encoding = "UTF-8"');
    db.pragma('synchronous = NORMAL');
    db.pragma('cache_size = -64000');
    db.pragma('mmap_size = 268435456');
    db.pragma('temp_store = MEMORY');
  } catch (e2) {
    throw new Error('SQLite database is required. Please run with bun (recommended) or install better-sqlite3: npm install better-sqlite3');
  }
}

function initSchema() {
  // Create table with minimal schema - columns will be added by migration
  db.exec(`
    CREATE TABLE IF NOT EXISTS conversations (
      id TEXT PRIMARY KEY,
      agentId TEXT NOT NULL,
      title TEXT,
      created_at INTEGER NOT NULL,
      updated_at INTEGER NOT NULL,
      status TEXT DEFAULT 'active'
    );

    CREATE INDEX IF NOT EXISTS idx_conversations_agent ON conversations(agentId);
    CREATE INDEX IF NOT EXISTS idx_conversations_updated ON conversations(updated_at DESC);

    CREATE TABLE IF NOT EXISTS messages (
      id TEXT PRIMARY KEY,
      conversationId TEXT NOT NULL,
      role TEXT NOT NULL,
      content TEXT NOT NULL,
      created_at INTEGER NOT NULL,
      FOREIGN KEY (conversationId) REFERENCES conversations(id)
    );

    CREATE INDEX IF NOT EXISTS idx_messages_conversation ON messages(conversationId);

    CREATE TABLE IF NOT EXISTS sessions (
      id TEXT PRIMARY KEY,
      conversationId TEXT NOT NULL,
      status TEXT NOT NULL,
      started_at INTEGER NOT NULL,
      completed_at INTEGER,
      response TEXT,
      error TEXT,
      FOREIGN KEY (conversationId) REFERENCES conversations(id)
    );

    CREATE INDEX IF NOT EXISTS idx_sessions_conversation ON sessions(conversationId);
    CREATE INDEX IF NOT EXISTS idx_sessions_status ON sessions(conversationId, status);

    CREATE TABLE IF NOT EXISTS events (
      id TEXT PRIMARY KEY,
      type TEXT NOT NULL,
      conversationId TEXT,
      sessionId TEXT,
      data TEXT NOT NULL,
      created_at INTEGER NOT NULL,
      FOREIGN KEY (conversationId) REFERENCES conversations(id),
      FOREIGN KEY (sessionId) REFERENCES sessions(id)
    );

    CREATE INDEX IF NOT EXISTS idx_events_conversation ON events(conversationId);

    CREATE TABLE IF NOT EXISTS idempotencyKeys (
      key TEXT PRIMARY KEY,
      value TEXT NOT NULL,
      created_at INTEGER NOT NULL,
      ttl INTEGER NOT NULL
    );

    CREATE INDEX IF NOT EXISTS idx_idempotency_created ON idempotencyKeys(created_at);

    CREATE TABLE IF NOT EXISTS stream_updates (
      id TEXT PRIMARY KEY,
      sessionId TEXT NOT NULL,
      conversationId TEXT NOT NULL,
      updateType TEXT NOT NULL,
      content TEXT NOT NULL,
      sequence INTEGER NOT NULL,
      created_at INTEGER NOT NULL,
      FOREIGN KEY (sessionId) REFERENCES sessions(id),
      FOREIGN KEY (conversationId) REFERENCES conversations(id)
    );

    CREATE INDEX IF NOT EXISTS idx_stream_updates_session ON stream_updates(sessionId);
    CREATE INDEX IF NOT EXISTS idx_stream_updates_created ON stream_updates(created_at);

    CREATE TABLE IF NOT EXISTS chunks (
      id TEXT PRIMARY KEY,
      sessionId TEXT NOT NULL,
      conversationId TEXT NOT NULL,
      sequence INTEGER NOT NULL,
      type TEXT NOT NULL,
      data BLOB NOT NULL,
      created_at INTEGER NOT NULL,
      FOREIGN KEY (sessionId) REFERENCES sessions(id),
      FOREIGN KEY (conversationId) REFERENCES conversations(id)
    );

    CREATE INDEX IF NOT EXISTS idx_chunks_session ON chunks(sessionId, sequence);
    CREATE INDEX IF NOT EXISTS idx_chunks_conversation ON chunks(conversationId, sequence);
    CREATE UNIQUE INDEX IF NOT EXISTS idx_chunks_unique ON chunks(sessionId, sequence);
    CREATE INDEX IF NOT EXISTS idx_chunks_conv_created ON chunks(conversationId, created_at);
    CREATE INDEX IF NOT EXISTS idx_chunks_sess_created ON chunks(sessionId, created_at);

    CREATE TABLE IF NOT EXISTS ipfs_cids (
      id TEXT PRIMARY KEY,
      cid TEXT NOT NULL UNIQUE,
      modelName TEXT NOT NULL,
      modelType TEXT NOT NULL,
      modelHash TEXT,
      gatewayUrl TEXT,
      cached_at INTEGER NOT NULL,
      last_accessed_at INTEGER NOT NULL,
      success_count INTEGER DEFAULT 0,
      failure_count INTEGER DEFAULT 0
    );

    CREATE INDEX IF NOT EXISTS idx_ipfs_cids_model ON ipfs_cids(modelName);
    CREATE INDEX IF NOT EXISTS idx_ipfs_cids_type ON ipfs_cids(modelType);
    CREATE INDEX IF NOT EXISTS idx_ipfs_cids_hash ON ipfs_cids(modelHash);

    CREATE TABLE IF NOT EXISTS ipfs_downloads (
      id TEXT PRIMARY KEY,
      cidId TEXT NOT NULL,
      downloadPath TEXT NOT NULL,
      status TEXT DEFAULT 'pending',
      downloaded_bytes INTEGER DEFAULT 0,
      total_bytes INTEGER,
      error_message TEXT,
      started_at INTEGER NOT NULL,
      completed_at INTEGER,
      FOREIGN KEY (cidId) REFERENCES ipfs_cids(id)
    );

    CREATE INDEX IF NOT EXISTS idx_ipfs_downloads_cid ON ipfs_downloads(cidId);
    CREATE INDEX IF NOT EXISTS idx_ipfs_downloads_status ON ipfs_downloads(status);
    CREATE INDEX IF NOT EXISTS idx_ipfs_downloads_started ON ipfs_downloads(started_at);
  `);
}

function migrateFromJson() {
  if (!fs.existsSync(oldJsonPath)) return;

  try {
    const content = fs.readFileSync(oldJsonPath, 'utf-8');
    const data = JSON.parse(content);

    const migrationStmt = db.transaction(() => {
      if (data.conversations) {
        for (const id in data.conversations) {
          const conv = data.conversations[id];
          db.prepare(
            `INSERT OR REPLACE INTO conversations (id, agentId, title, created_at, updated_at, status) VALUES (?, ?, ?, ?, ?, ?)`
          ).run(conv.id, conv.agentId, conv.title || null, conv.created_at, conv.updated_at, conv.status || 'active');
        }
      }

       if (data.messages) {
         for (const id in data.messages) {
           const msg = data.messages[id];
           // Ensure content is always a string (stringify objects)
           const contentStr = typeof msg.content === 'string' ? msg.content : JSON.stringify(msg.content);
           db.prepare(
             `INSERT OR REPLACE INTO messages (id, conversationId, role, content, created_at) VALUES (?, ?, ?, ?, ?)`
           ).run(msg.id, msg.conversationId, msg.role, contentStr, msg.created_at);
         }
       }

       if (data.sessions) {
         for (const id in data.sessions) {
           const sess = data.sessions[id];
           // Ensure response and error are strings, not objects
           const responseStr = sess.response ? (typeof sess.response === 'string' ? sess.response : JSON.stringify(sess.response)) : null;
           const errorStr = sess.error ? (typeof sess.error === 'string' ? sess.error : JSON.stringify(sess.error)) : null;
           db.prepare(
             `INSERT OR REPLACE INTO sessions (id, conversationId, status, started_at, completed_at, response, error) VALUES (?, ?, ?, ?, ?, ?, ?)`
           ).run(sess.id, sess.conversationId, sess.status, sess.started_at, sess.completed_at || null, responseStr, errorStr);
         }
       }

       if (data.events) {
         for (const id in data.events) {
           const evt = data.events[id];
           // Ensure data is always valid JSON string
           const dataStr = typeof evt.data === 'string' ? evt.data : JSON.stringify(evt.data || {});
           db.prepare(
             `INSERT OR REPLACE INTO events (id, type, conversationId, sessionId, data, created_at) VALUES (?, ?, ?, ?, ?, ?)`
           ).run(evt.id, evt.type, evt.conversationId || null, evt.sessionId || null, dataStr, evt.created_at);
         }
       }

       if (data.idempotencyKeys) {
         for (const key in data.idempotencyKeys) {
           const entry = data.idempotencyKeys[key];
           // Ensure value is always valid JSON string
           const valueStr = typeof entry.value === 'string' ? entry.value : JSON.stringify(entry.value || {});
           // Ensure ttl is a number
           const ttl = typeof entry.ttl === 'number' ? entry.ttl : (entry.ttl ? parseInt(entry.ttl) : null);
           db.prepare(
             `INSERT OR REPLACE INTO idempotencyKeys (key, value, created_at, ttl) VALUES (?, ?, ?, ?)`
           ).run(key, valueStr, entry.created_at, ttl);
         }
       }
    });

    migrationStmt();
    fs.renameSync(oldJsonPath, `${oldJsonPath}.migrated`);
    console.log('Migrated data from JSON to SQLite');
  } catch (e) {
    console.error('Error during migration:', e.message);
  }
}

initSchema();
migrateFromJson();

// Migration: Add imported conversation columns if they don't exist
try {
  const result = db.prepare("PRAGMA table_info(conversations)").all();
  const columnNames = result.map(r => r.name);
  const requiredColumns = {
    agentType: 'TEXT DEFAULT "claude-code"',
    source: 'TEXT DEFAULT "gui"',
    externalId: 'TEXT',
    firstPrompt: 'TEXT',
    messageCount: 'INTEGER DEFAULT 0',
    projectPath: 'TEXT',
    gitBranch: 'TEXT',
    sourcePath: 'TEXT',
    lastSyncedAt: 'INTEGER',
    workingDirectory: 'TEXT',
    claudeSessionId: 'TEXT',
    isStreaming: 'INTEGER DEFAULT 0',
    model: 'TEXT'
  };

  let addedColumns = false;
  for (const [colName, colDef] of Object.entries(requiredColumns)) {
    if (!columnNames.includes(colName)) {
      db.exec(`ALTER TABLE conversations ADD COLUMN ${colName} ${colDef}`);
      console.log(`[Migration] Added column ${colName} to conversations table`);
      addedColumns = true;
    }
  }

  // Add indexes for new columns
  if (addedColumns) {
    try {
      db.exec(`CREATE INDEX IF NOT EXISTS idx_conversations_external ON conversations(externalId)`);
      db.exec(`CREATE INDEX IF NOT EXISTS idx_conversations_agent_type ON conversations(agentType)`);
      db.exec(`CREATE INDEX IF NOT EXISTS idx_conversations_source ON conversations(source)`);
    } catch (e) {
      console.warn('[Migration] Index creation warning:', e.message);
    }
  }
} catch (err) {
  console.error('[Migration] Error:', err.message);
}

// Migration: Add resume capability columns to ipfs_downloads if needed
try {
  const result = db.prepare("PRAGMA table_info(ipfs_downloads)").all();
  const columnNames = result.map(r => r.name);
  const resumeColumns = {
    attempts: 'INTEGER DEFAULT 0',
    lastAttempt: 'INTEGER',
    currentSize: 'INTEGER DEFAULT 0',
    hash: 'TEXT'
  };

  for (const [colName, colDef] of Object.entries(resumeColumns)) {
    if (!columnNames.includes(colName)) {
      db.exec(`ALTER TABLE ipfs_downloads ADD COLUMN ${colName} ${colDef}`);
      console.log(`[Migration] Added column ${colName} to ipfs_downloads table`);
    }
  }
} catch (err) {
  console.error('[Migration] IPFS schema update warning:', err.message);
}

// Migration: Backfill messages for conversations imported without message content
try {
  const emptyImported = db.prepare(`
    SELECT c.id, c.sourcePath FROM conversations c
    LEFT JOIN messages m ON c.id = m.conversationId
    WHERE c.sourcePath IS NOT NULL AND c.status != 'deleted'
    GROUP BY c.id HAVING COUNT(m.id) = 0
  `).all();

  if (emptyImported.length > 0) {
    console.log(`[Migration] Backfilling messages for ${emptyImported.length} imported conversation(s)`);
    const insertMsg = db.prepare(`INSERT OR IGNORE INTO messages (id, conversationId, role, content, created_at) VALUES (?, ?, ?, ?, ?)`);
    const backfill = db.transaction(() => {
      for (const conv of emptyImported) {
        if (!fs.existsSync(conv.sourcePath)) continue;
        try {
          const lines = fs.readFileSync(conv.sourcePath, 'utf-8').split('\n');
          let count = 0;
          for (const line of lines) {
            if (!line.trim()) continue;
            try {
              const obj = JSON.parse(line);
              const msgId = obj.uuid || `msg-${Date.now()}-${Math.random().toString(36).substr(2,9)}`;
              const ts = obj.timestamp ? new Date(obj.timestamp).getTime() : Date.now();
              if (obj.type === 'user' && obj.message?.content) {
                const raw = obj.message.content;
                const text = typeof raw === 'string' ? raw
                  : Array.isArray(raw) ? raw.filter(c => c.type === 'text').map(c => c.text).join('\n')
                  : JSON.stringify(raw);
                if (text && !text.startsWith('[{"tool_use_id"')) {
                  insertMsg.run(msgId, conv.id, 'user', text, ts);
                  count++;
                }
              } else if (obj.type === 'assistant' && obj.message?.content) {
                const raw = obj.message.content;
                const text = Array.isArray(raw)
                  ? raw.filter(c => c.type === 'text' && c.text).map(c => c.text).join('\n\n')
                  : typeof raw === 'string' ? raw : '';
                if (text) {
                  insertMsg.run(msgId, conv.id, 'assistant', text, ts);
                  count++;
                }
              }
            } catch (_) {}
          }
          if (count > 0) console.log(`[Migration] Backfilled ${count} messages for conversation ${conv.id}`);
        } catch (e) {
          console.error(`[Migration] Error backfilling ${conv.id}:`, e.message);
        }
      }
    });
    backfill();
  }
} catch (err) {
  console.error('[Migration] Backfill error:', err.message);
}

// Register official IPFS CIDs for voice models
try {
  const LIGHTHOUSE_GATEWAY = 'https://gateway.lighthouse.storage/ipfs';
  const WHISPER_CID = 'bafybeidyw252ecy4vs46bbmezrtw325gl2ymdltosmzqgx4edjsc3fbofy';
  const TTS_CID = 'bafybeidyw252ecy4vs46bbmezrtw325gl2ymdltosmzqgx4edjsc3fbofy';

  // Check if CIDs are already registered
  const existingWhisper = db.prepare('SELECT * FROM ipfs_cids WHERE modelName = ? AND modelType = ?').get('whisper-base', 'stt');
  if (!existingWhisper) {
    const cidId = `cid-${Date.now()}-whisper`;
    db.prepare(
      `INSERT INTO ipfs_cids (id, cid, modelName, modelType, modelHash, gatewayUrl, cached_at, last_accessed_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?)`
    ).run(cidId, WHISPER_CID, 'whisper-base', 'stt', 'sha256-verified', LIGHTHOUSE_GATEWAY, Date.now(), Date.now());
    console.log('[MODELS] Registered Whisper STT IPFS CID:', WHISPER_CID);
  }

  const existingTTS = db.prepare('SELECT * FROM ipfs_cids WHERE modelName = ? AND modelType = ?').get('tts', 'voice');
  if (!existingTTS) {
    const cidId = `cid-${Date.now()}-tts`;
    db.prepare(
      `INSERT INTO ipfs_cids (id, cid, modelName, modelType, modelHash, gatewayUrl, cached_at, last_accessed_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?)`
    ).run(cidId, TTS_CID, 'tts', 'voice', 'sha256-verified', LIGHTHOUSE_GATEWAY, Date.now(), Date.now());
    console.log('[MODELS] Registered TTS IPFS CID:', TTS_CID);
  }
} catch (err) {
  console.warn('[MODELS] IPFS CID registration warning:', err.message);
}

const stmtCache = new Map();
function prep(sql) {
  let s = stmtCache.get(sql);
  if (!s) {
    s = db.prepare(sql);
    stmtCache.set(sql, s);
  }
  return s;
}

function generateId(prefix) {
  return `${prefix}-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`;
}

export const queries = {
  _db: db,
  createConversation(agentType, title = null, workingDirectory = null, model = null) {
    const id = generateId('conv');
    const now = Date.now();
    const stmt = prep(
      `INSERT INTO conversations (id, agentId, agentType, title, created_at, updated_at, status, workingDirectory, model) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`
    );
    stmt.run(id, agentType, agentType, title, now, now, 'active', workingDirectory, model);

    return {
      id,
      agentType,
      title,
      workingDirectory,
      model,
      created_at: now,
      updated_at: now,
      status: 'active'
    };
  },

  getConversation(id) {
    const stmt = prep('SELECT * FROM conversations WHERE id = ?');
    return stmt.get(id);
  },

  getAllConversations() {
    const stmt = prep('SELECT * FROM conversations WHERE status != ? ORDER BY updated_at DESC');
    return stmt.all('deleted');
  },

  getConversationsList() {
    const stmt = prep(
      'SELECT id, title, agentType, created_at, updated_at, messageCount, workingDirectory, isStreaming, model FROM conversations WHERE status != ? ORDER BY updated_at DESC'
    );
    return stmt.all('deleted');
  },

  getConversations() {
    const stmt = prep('SELECT * FROM conversations WHERE status != ? ORDER BY updated_at DESC');
    return stmt.all('deleted');
  },

  updateConversation(id, data) {
    const conv = this.getConversation(id);
    if (!conv) return null;

    const now = Date.now();
    const title = data.title !== undefined ? data.title : conv.title;
    const status = data.status !== undefined ? data.status : conv.status;

    const stmt = prep(
      `UPDATE conversations SET title = ?, status = ?, updated_at = ? WHERE id = ?`
    );
    stmt.run(title, status, now, id);

    return {
      ...conv,
      title,
      status,
      updated_at: now
    };
  },

  setClaudeSessionId(conversationId, claudeSessionId) {
    const stmt = prep('UPDATE conversations SET claudeSessionId = ?, updated_at = ? WHERE id = ?');
    stmt.run(claudeSessionId, Date.now(), conversationId);
  },

  getClaudeSessionId(conversationId) {
    const stmt = prep('SELECT claudeSessionId FROM conversations WHERE id = ?');
    const row = stmt.get(conversationId);
    return row?.claudeSessionId || null;
  },

  setIsStreaming(conversationId, isStreaming) {
    const stmt = prep('UPDATE conversations SET isStreaming = ?, updated_at = ? WHERE id = ?');
    stmt.run(isStreaming ? 1 : 0, Date.now(), conversationId);
  },

  getIsStreaming(conversationId) {
    const stmt = prep('SELECT isStreaming FROM conversations WHERE id = ?');
    const row = stmt.get(conversationId);
    return row?.isStreaming === 1;
  },

  getStreamingConversations() {
    const stmt = prep('SELECT id, title, claudeSessionId, agentType FROM conversations WHERE isStreaming = 1');
    return stmt.all();
  },

  getResumableConversations() {
    const stmt = prep(
      "SELECT id, title, claudeSessionId, agentType, workingDirectory FROM conversations WHERE isStreaming = 1 AND claudeSessionId IS NOT NULL AND claudeSessionId != ''"
    );
    return stmt.all();
  },

  clearAllStreamingFlags() {
    const stmt = prep('UPDATE conversations SET isStreaming = 0 WHERE isStreaming = 1');
    return stmt.run().changes;
  },

  markSessionIncomplete(sessionId, errorMsg) {
    const stmt = prep('UPDATE sessions SET status = ?, error = ?, completed_at = ? WHERE id = ?');
    stmt.run('incomplete', errorMsg || 'unknown', Date.now(), sessionId);
  },

  getSessionsProcessingLongerThan(minutes) {
    const cutoff = Date.now() - (minutes * 60 * 1000);
    const stmt = prep("SELECT * FROM sessions WHERE status IN ('active', 'pending') AND started_at < ?");
    return stmt.all(cutoff);
  },

  cleanupOrphanedSessions(days) {
    const cutoff = Date.now() - (days * 24 * 60 * 60 * 1000);
    const stmt = prep("DELETE FROM sessions WHERE status IN ('active', 'pending') AND started_at < ?");
    const result = stmt.run(cutoff);
    return result.changes || 0;
  },

  createMessage(conversationId, role, content, idempotencyKey = null) {
    if (idempotencyKey) {
      const cached = this.getIdempotencyKey(idempotencyKey);
      if (cached) return JSON.parse(cached);
    }

    const id = generateId('msg');
    const now = Date.now();
    const storedContent = typeof content === 'string' ? content : JSON.stringify(content);

    const stmt = prep(
      `INSERT INTO messages (id, conversationId, role, content, created_at) VALUES (?, ?, ?, ?, ?)`
    );
    stmt.run(id, conversationId, role, storedContent, now);

    const updateConvStmt = prep('UPDATE conversations SET updated_at = ? WHERE id = ?');
    updateConvStmt.run(now, conversationId);

    const message = {
      id,
      conversationId,
      role,
      content,
      created_at: now
    };

    if (idempotencyKey) {
      this.setIdempotencyKey(idempotencyKey, message);
    }

    return message;
  },

  getMessage(id) {
     const stmt = prep('SELECT * FROM messages WHERE id = ?');
     const msg = stmt.get(id);
     if (msg && typeof msg.content === 'string') {
       try {
         msg.content = JSON.parse(msg.content);
       } catch (_) {
         // If it's not JSON, leave it as string
       }
     }
     return msg;
   },

   getConversationMessages(conversationId) {
     const stmt = prep(
       'SELECT * FROM messages WHERE conversationId = ? ORDER BY created_at ASC'
     );
     const messages = stmt.all(conversationId);
     return messages.map(msg => {
       if (typeof msg.content === 'string') {
         try {
           msg.content = JSON.parse(msg.content);
         } catch (_) {
           // If it's not JSON, leave it as string
         }
       }
       return msg;
     });
   },

  getLastUserMessage(conversationId) {
    const stmt = prep(
      "SELECT * FROM messages WHERE conversationId = ? AND role = 'user' ORDER BY created_at DESC LIMIT 1"
    );
    const msg = stmt.get(conversationId);
    if (msg && typeof msg.content === 'string') {
      try { msg.content = JSON.parse(msg.content); } catch (_) {}
    }
    return msg || null;
  },

  getPaginatedMessages(conversationId, limit = 50, offset = 0) {
    const countStmt = prep('SELECT COUNT(*) as count FROM messages WHERE conversationId = ?');
    const total = countStmt.get(conversationId).count;

    const stmt = prep(
      'SELECT * FROM messages WHERE conversationId = ? ORDER BY created_at ASC LIMIT ? OFFSET ?'
    );
    const messages = stmt.all(conversationId, limit, offset);

    return {
      messages: messages.map(msg => {
        if (typeof msg.content === 'string') {
          try {
            msg.content = JSON.parse(msg.content);
          } catch (_) {
            // If it's not JSON, leave it as string
          }
        }
        return msg;
      }),
      total,
      limit,
      offset,
      hasMore: offset + limit < total
    };
  },

  createSession(conversationId) {
    const id = generateId('sess');
    const now = Date.now();

    const stmt = prep(
      `INSERT INTO sessions (id, conversationId, status, started_at, completed_at, response, error) VALUES (?, ?, ?, ?, ?, ?, ?)`
    );
    stmt.run(id, conversationId, 'pending', now, null, null, null);

    return {
      id,
      conversationId,
      status: 'pending',
      started_at: now,
      completed_at: null,
      response: null,
      error: null
    };
  },

  getSession(id) {
    const stmt = prep('SELECT * FROM sessions WHERE id = ?');
    return stmt.get(id);
  },

  getConversationSessions(conversationId) {
    const stmt = prep(
      'SELECT * FROM sessions WHERE conversationId = ? ORDER BY started_at DESC'
    );
    return stmt.all(conversationId);
  },

  updateSession(id, data) {
    const session = this.getSession(id);
    if (!session) return null;

    const status = data.status !== undefined ? data.status : session.status;
    const rawResponse = data.response !== undefined ? data.response : session.response;
    const response = rawResponse && typeof rawResponse === 'object' ? JSON.stringify(rawResponse) : rawResponse;
    const error = data.error !== undefined ? data.error : session.error;
    const completed_at = data.completed_at !== undefined ? data.completed_at : session.completed_at;

    const stmt = prep(
      `UPDATE sessions SET status = ?, response = ?, error = ?, completed_at = ? WHERE id = ?`
    );

    try {
      stmt.run(status, response, error, completed_at, id);
      return {
        ...session,
        status,
        response,
        error,
        completed_at
      };
    } catch (e) {
      throw e;
    }
  },

  getLatestSession(conversationId) {
    const stmt = prep(
      'SELECT * FROM sessions WHERE conversationId = ? ORDER BY started_at DESC LIMIT 1'
    );
    return stmt.get(conversationId) || null;
  },

  getSessionsByStatus(conversationId, status) {
    const stmt = prep(
      'SELECT * FROM sessions WHERE conversationId = ? AND status = ? ORDER BY started_at DESC'
    );
    return stmt.all(conversationId, status);
  },

  getActiveSessions() {
    const stmt = prep(
      "SELECT * FROM sessions WHERE status IN ('active', 'pending') ORDER BY started_at DESC"
    );
    return stmt.all();
  },

  getSessionsByConversation(conversationId, limit = 10, offset = 0) {
    const stmt = prep(
      'SELECT * FROM sessions WHERE conversationId = ? ORDER BY started_at DESC LIMIT ? OFFSET ?'
    );
    return stmt.all(conversationId, limit, offset);
  },

  getAllSessions(limit = 100) {
    const stmt = prep(
      'SELECT * FROM sessions ORDER BY started_at DESC LIMIT ?'
    );
    return stmt.all(limit);
  },

  deleteSession(id) {
    const stmt = prep('DELETE FROM sessions WHERE id = ?');
    const result = stmt.run(id);
    prep('DELETE FROM chunks WHERE sessionId = ?').run(id);
    prep('DELETE FROM events WHERE sessionId = ?').run(id);
    return result.changes || 0;
  },

  createEvent(type, data, conversationId = null, sessionId = null) {
    const id = generateId('evt');
    const now = Date.now();

    const stmt = prep(
      `INSERT INTO events (id, type, conversationId, sessionId, data, created_at) VALUES (?, ?, ?, ?, ?, ?)`
    );
    stmt.run(id, type, conversationId, sessionId, JSON.stringify(data), now);

    return {
      id,
      type,
      conversationId,
      sessionId,
      data,
      created_at: now
    };
  },

  getEvent(id) {
    const stmt = prep('SELECT * FROM events WHERE id = ?');
    const row = stmt.get(id);
    if (row) {
      return {
        ...row,
        data: JSON.parse(row.data)
      };
    }
    return undefined;
  },

  getConversationEvents(conversationId) {
    const stmt = prep(
      'SELECT * FROM events WHERE conversationId = ? ORDER BY created_at ASC'
    );
    const rows = stmt.all(conversationId);
    return rows.map(row => ({
      ...row,
      data: JSON.parse(row.data)
    }));
  },

  getSessionEvents(sessionId) {
    const stmt = prep(
      'SELECT * FROM events WHERE sessionId = ? ORDER BY created_at ASC'
    );
    const rows = stmt.all(sessionId);
    return rows.map(row => ({
      ...row,
      data: JSON.parse(row.data)
    }));
  },

  deleteConversation(id) {
    const conv = this.getConversation(id);
    if (!conv) return false;

    // Delete associated Claude Code session file if it exists
    if (conv.claudeSessionId) {
      this.deleteClaudeSessionFile(conv.claudeSessionId);
    }

    const deleteStmt = db.transaction(() => {
      const sessionIds = prep('SELECT id FROM sessions WHERE conversationId = ?').all(id).map(r => r.id);
      prep('DELETE FROM stream_updates WHERE conversationId = ?').run(id);
      prep('DELETE FROM chunks WHERE conversationId = ?').run(id);
      prep('DELETE FROM events WHERE conversationId = ?').run(id);
      if (sessionIds.length > 0) {
        const placeholders = sessionIds.map(() => '?').join(',');
        db.prepare(`DELETE FROM stream_updates WHERE sessionId IN (${placeholders})`).run(...sessionIds);
        db.prepare(`DELETE FROM chunks WHERE sessionId IN (${placeholders})`).run(...sessionIds);
        db.prepare(`DELETE FROM events WHERE sessionId IN (${placeholders})`).run(...sessionIds);
      }
      prep('DELETE FROM sessions WHERE conversationId = ?').run(id);
      prep('DELETE FROM messages WHERE conversationId = ?').run(id);
      prep('DELETE FROM conversations WHERE id = ?').run(id);
    });

    deleteStmt();
    return true;
  },

  deleteClaudeSessionFile(sessionId) {
    try {
      const claudeDir = path.join(os.homedir(), '.claude');
      const projectsDir = path.join(claudeDir, 'projects');
      
      if (!fs.existsSync(projectsDir)) {
        return false;
      }

      // Search for session file in all project directories
      const projects = fs.readdirSync(projectsDir);
      for (const project of projects) {
        const projectPath = path.join(projectsDir, project);
        const sessionFile = path.join(projectPath, `${sessionId}.jsonl`);
        
        if (fs.existsSync(sessionFile)) {
          fs.unlinkSync(sessionFile);
          console.log(`[deleteClaudeSessionFile] Deleted Claude session: ${sessionFile}`);
          return true;
        }
      }
      
      return false;
    } catch (err) {
      console.error(`[deleteClaudeSessionFile] Error deleting session ${sessionId}:`, err.message);
      return false;
    }
  },

  cleanup() {
    const thirtyDaysAgo = Date.now() - (30 * 24 * 60 * 60 * 1000);
    const now = Date.now();

    const cleanupStmt = db.transaction(() => {
      prep('DELETE FROM events WHERE created_at < ?').run(thirtyDaysAgo);
      prep('DELETE FROM sessions WHERE completed_at IS NOT NULL AND completed_at < ?').run(thirtyDaysAgo);
      prep('DELETE FROM idempotencyKeys WHERE (created_at + ttl) < ?').run(now);
    });

    cleanupStmt();
  },

  setIdempotencyKey(key, value) {
    const now = Date.now();
    const ttl = 24 * 60 * 60 * 1000;

    const stmt = prep(
      'INSERT OR REPLACE INTO idempotencyKeys (key, value, created_at, ttl) VALUES (?, ?, ?, ?)'
    );
    stmt.run(key, JSON.stringify(value), now, ttl);
  },

  getIdempotencyKey(key) {
    const stmt = prep('SELECT * FROM idempotencyKeys WHERE key = ?');
    const entry = stmt.get(key);

    if (!entry) return null;

    const isExpired = Date.now() - entry.created_at > entry.ttl;
    if (isExpired) {
      db.run('DELETE FROM idempotencyKeys WHERE key = ?', [key]);
      return null;
    }

    return entry.value;
  },

  clearIdempotencyKey(key) {
    db.run('DELETE FROM idempotencyKeys WHERE key = ?', [key]);
  },

  discoverClaudeCodeConversations() {
    const projectsDir = path.join(os.homedir(), '.claude', 'projects');
    if (!fs.existsSync(projectsDir)) return [];

    const discovered = [];
    try {
      const dirs = fs.readdirSync(projectsDir, { withFileTypes: true });
      for (const dir of dirs) {
        if (!dir.isDirectory()) continue;
        const dirPath = path.join(projectsDir, dir.name);
        const indexPath = path.join(dirPath, 'sessions-index.json');
        if (!fs.existsSync(indexPath)) continue;

        try {
          const index = JSON.parse(fs.readFileSync(indexPath, 'utf-8'));
          const projectPath = index.originalPath || dir.name.replace(/^-/, '/').replace(/-/g, '/');
          for (const entry of (index.entries || [])) {
            if (!entry.sessionId || entry.messageCount === 0) continue;
            discovered.push({
              id: entry.sessionId,
              jsonlPath: entry.fullPath || path.join(dirPath, `${entry.sessionId}.jsonl`),
              title: entry.summary || entry.firstPrompt || 'Claude Code Session',
              projectPath,
              created: entry.created ? new Date(entry.created).getTime() : entry.fileMtime,
              modified: entry.modified ? new Date(entry.modified).getTime() : entry.fileMtime,
              messageCount: entry.messageCount,
              gitBranch: entry.gitBranch,
              source: 'claude-code'
            });
          }
        } catch (e) {
          console.error(`Error reading index ${indexPath}:`, e.message);
        }
      }
    } catch (e) {
      console.error('Error discovering Claude Code conversations:', e.message);
    }

    return discovered;
  },

  parseJsonlMessages(jsonlPath) {
    if (!fs.existsSync(jsonlPath)) return [];
    const messages = [];
    try {
      const lines = fs.readFileSync(jsonlPath, 'utf-8').split('\n');
      for (const line of lines) {
        if (!line.trim()) continue;
        try {
          const obj = JSON.parse(line);
          if (obj.type === 'user' && obj.message?.content) {
            const content = typeof obj.message.content === 'string'
              ? obj.message.content
              : Array.isArray(obj.message.content)
                ? obj.message.content.filter(c => c.type === 'text').map(c => c.text).join('\n')
                : JSON.stringify(obj.message.content);
            if (content && !content.startsWith('[{"tool_use_id"')) {
              messages.push({ id: obj.uuid || generateId('msg'), role: 'user', content, created_at: new Date(obj.timestamp).getTime() });
            }
           } else if (obj.type === 'assistant' && obj.message?.content) {
             let text = '';
             const content = obj.message.content;
             if (Array.isArray(content)) {
               // CRITICAL FIX: Join text blocks with newlines to preserve separation
               const textBlocks = [];
               for (const c of content) {
                 if (c.type === 'text' && c.text) {
                   textBlocks.push(c.text);
                 }
               }
               // Join with double newline to preserve logical separation
               text = textBlocks.join('\n\n');
             } else if (typeof content === 'string') {
               text = content;
             }
             if (text) {
               messages.push({ id: obj.uuid || generateId('msg'), role: 'assistant', content: text, created_at: new Date(obj.timestamp).getTime() });
             }
          }
        } catch (_) {}
      }
    } catch (e) {
      console.error(`Error parsing JSONL ${jsonlPath}:`, e.message);
    }
    return messages;
  },

  importClaudeCodeConversations() {
    const discovered = this.discoverClaudeCodeConversations();
    const imported = [];

    for (const conv of discovered) {
      try {
        const existingConv = prep('SELECT id, status FROM conversations WHERE id = ? OR externalId = ?').get(conv.id, conv.id);
        if (existingConv) {
          imported.push({ id: conv.id, status: 'skipped', reason: existingConv.status === 'deleted' ? 'deleted' : 'exists' });
          continue;
        }

        const projectName = conv.projectPath ? path.basename(conv.projectPath) : '';
        const title = conv.title || 'Claude Code Session';
        const displayTitle = projectName ? `[${projectName}] ${title}` : title;

        const messages = this.parseJsonlMessages(conv.jsonlPath);

        const importStmt = db.transaction(() => {
          prep(
            `INSERT INTO conversations (id, agentId, title, created_at, updated_at, status) VALUES (?, ?, ?, ?, ?, ?)`
          ).run(conv.id, 'claude-code', displayTitle, conv.created, conv.modified, 'active');

          for (const msg of messages) {
            try {
              prep(
                `INSERT INTO messages (id, conversationId, role, content, created_at) VALUES (?, ?, ?, ?, ?)`
              ).run(msg.id, conv.id, msg.role, msg.content, msg.created_at);
            } catch (_) {}
          }
        });

        importStmt();
        imported.push({ id: conv.id, status: 'imported', title: displayTitle, messages: messages.length });
      } catch (e) {
        imported.push({ id: conv.id, status: 'error', error: e.message });
      }
    }

    return imported;
  },

  createStreamUpdate(sessionId, conversationId, updateType, content) {
    const id = generateId('upd');
    const now = Date.now();

    // Use transaction to ensure atomic sequence number assignment
    const transaction = db.transaction(() => {
      const maxSequence = prep(
        'SELECT MAX(sequence) as max FROM stream_updates WHERE sessionId = ?'
      ).get(sessionId);
      const sequence = (maxSequence?.max || -1) + 1;

      prep(
        `INSERT INTO stream_updates (id, sessionId, conversationId, updateType, content, sequence, created_at)
         VALUES (?, ?, ?, ?, ?, ?, ?)`
      ).run(id, sessionId, conversationId, updateType, JSON.stringify(content), sequence, now);

      return sequence;
    });

    const sequence = transaction();

    return {
      id,
      sessionId,
      conversationId,
      updateType,
      content,
      sequence,
      created_at: now
    };
  },

  getSessionStreamUpdates(sessionId) {
    const stmt = prep(
      `SELECT id, sessionId, conversationId, updateType, content, sequence, created_at
       FROM stream_updates WHERE sessionId = ? ORDER BY sequence ASC`
    );
    const rows = stmt.all(sessionId);
    return rows.map(row => ({
      ...row,
      content: JSON.parse(row.content)
    }));
  },

  clearSessionStreamUpdates(sessionId) {
    const stmt = prep('DELETE FROM stream_updates WHERE sessionId = ?');
    stmt.run(sessionId);
  },

  createImportedConversation(data) {
    const id = generateId('conv');
    const now = Date.now();
    const stmt = prep(
      `INSERT INTO conversations (
        id, agentId, title, created_at, updated_at, status,
        agentType, source, externalId, firstPrompt, messageCount,
        projectPath, gitBranch, sourcePath, lastSyncedAt
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
    );
    stmt.run(
      id,
      data.externalId || id,
      data.title,
      data.created || now,
      data.modified || now,
      'active',
      data.agentType || 'claude-code',
      data.source || 'imported',
      data.externalId,
      data.firstPrompt,
      data.messageCount || 0,
      data.projectPath,
      data.gitBranch,
      data.sourcePath,
      now
    );
    return { id, ...data };
  },

  getConversationByExternalId(agentType, externalId) {
    const stmt = prep(
      'SELECT * FROM conversations WHERE agentType = ? AND externalId = ?'
    );
    return stmt.get(agentType, externalId);
  },

  getConversationsByAgentType(agentType) {
    const stmt = prep(
      'SELECT * FROM conversations WHERE agentType = ? AND status != ? ORDER BY updated_at DESC'
    );
    return stmt.all(agentType, 'deleted');
  },

  getImportedConversations() {
    const stmt = prep(
      'SELECT * FROM conversations WHERE source = ? AND status != ? ORDER BY updated_at DESC'
    );
    return stmt.all('imported', 'deleted');
  },

  createChunk(sessionId, conversationId, sequence, type, data) {
    const id = generateId('chunk');
    const now = Date.now();
    const dataBlob = typeof data === 'string' ? data : JSON.stringify(data);

    const stmt = prep(
      `INSERT INTO chunks (id, sessionId, conversationId, sequence, type, data, created_at)
       VALUES (?, ?, ?, ?, ?, ?, ?)`
    );
    stmt.run(id, sessionId, conversationId, sequence, type, dataBlob, now);

    return {
      id,
      sessionId,
      conversationId,
      sequence,
      type,
      data,
      created_at: now
    };
  },

  getChunk(id) {
    const stmt = prep(
      `SELECT id, sessionId, conversationId, sequence, type, data, created_at FROM chunks WHERE id = ?`
    );
    const row = stmt.get(id);
    if (!row) return null;

    try {
      return {
        ...row,
        data: typeof row.data === 'string' ? JSON.parse(row.data) : row.data
      };
    } catch (e) {
      return row;
    }
  },

  getSessionChunks(sessionId) {
    const stmt = prep(
      `SELECT id, sessionId, conversationId, sequence, type, data, created_at
       FROM chunks WHERE sessionId = ? ORDER BY sequence ASC`
    );
    const rows = stmt.all(sessionId);
    return rows.map(row => {
      try {
        return {
          ...row,
          data: typeof row.data === 'string' ? JSON.parse(row.data) : row.data
        };
      } catch (e) {
        return row;
      }
    });
  },

  getConversationChunkCount(conversationId) {
    const stmt = prep('SELECT COUNT(*) as count FROM chunks WHERE conversationId = ?');
    return stmt.get(conversationId).count;
  },

  getConversationChunks(conversationId) {
    const stmt = prep(
      `SELECT id, sessionId, conversationId, sequence, type, data, created_at
       FROM chunks WHERE conversationId = ? ORDER BY created_at ASC`
    );
    const rows = stmt.all(conversationId);
    return rows.map(row => {
      try {
        return {
          ...row,
          data: typeof row.data === 'string' ? JSON.parse(row.data) : row.data
        };
      } catch (e) {
        return row;
      }
    });
  },

  getRecentConversationChunks(conversationId, limit) {
    const stmt = prep(
      `SELECT id, sessionId, conversationId, sequence, type, data, created_at
       FROM chunks WHERE conversationId = ?
       ORDER BY created_at DESC LIMIT ?`
    );
    const rows = stmt.all(conversationId, limit);
    rows.reverse();
    return rows.map(row => {
      try {
        return {
          ...row,
          data: typeof row.data === 'string' ? JSON.parse(row.data) : row.data
        };
      } catch (e) {
        return row;
      }
    });
  },

  getChunksSince(sessionId, timestamp) {
    const stmt = prep(
      `SELECT id, sessionId, conversationId, sequence, type, data, created_at
       FROM chunks WHERE sessionId = ? AND created_at > ? ORDER BY sequence ASC`
    );
    const rows = stmt.all(sessionId, timestamp);
    return rows.map(row => {
      try {
        return {
          ...row,
          data: typeof row.data === 'string' ? JSON.parse(row.data) : row.data
        };
      } catch (e) {
        return row;
      }
    });
  },

  getChunksSinceSeq(sessionId, sinceSeq) {
    const stmt = prep(
      `SELECT id, sessionId, conversationId, sequence, type, data, created_at
       FROM chunks WHERE sessionId = ? AND sequence > ? ORDER BY sequence ASC`
    );
    const rows = stmt.all(sessionId, sinceSeq);
    return rows.map(row => {
      try {
        return {
          ...row,
          data: typeof row.data === 'string' ? JSON.parse(row.data) : row.data
        };
      } catch (e) {
        return row;
      }
    });
  },

  deleteSessionChunks(sessionId) {
    const stmt = prep('DELETE FROM chunks WHERE sessionId = ?');
    const result = stmt.run(sessionId);
    return result.changes || 0;
  },

  getMaxSequence(sessionId) {
    const stmt = prep('SELECT MAX(sequence) as max FROM chunks WHERE sessionId = ?');
    const result = stmt.get(sessionId);
    return result?.max ?? -1;
  },

  getEmptyConversations() {
    const stmt = prep(`
      SELECT c.* FROM conversations c
      LEFT JOIN messages m ON c.id = m.conversationId
      WHERE c.status != 'deleted'
      GROUP BY c.id
      HAVING COUNT(m.id) = 0
    `);
    return stmt.all();
  },

  permanentlyDeleteConversation(id) {
    const conv = this.getConversation(id);
    if (!conv) return false;

    // Delete associated Claude Code session file if it exists
    if (conv.claudeSessionId) {
      this.deleteClaudeSessionFile(conv.claudeSessionId);
    }

    const deleteStmt = db.transaction(() => {
      prep('DELETE FROM stream_updates WHERE conversationId = ?').run(id);
      prep('DELETE FROM chunks WHERE conversationId = ?').run(id);
      prep('DELETE FROM events WHERE conversationId = ?').run(id);
      prep('DELETE FROM sessions WHERE conversationId = ?').run(id);
      prep('DELETE FROM messages WHERE conversationId = ?').run(id);
      prep('DELETE FROM conversations WHERE id = ?').run(id);
    });

    deleteStmt();
    return true;
  },

  cleanupEmptyConversations() {
    const emptyConvs = this.getEmptyConversations();
    let deletedCount = 0;

    for (const conv of emptyConvs) {
      console.log(`[cleanup] Deleting empty conversation: ${conv.id} (${conv.title || 'Untitled'})`);
      if (this.permanentlyDeleteConversation(conv.id)) {
        deletedCount++;
      }
    }

    if (deletedCount > 0) {
      console.log(`[cleanup] Deleted ${deletedCount} empty conversation(s)`);
    }

    return deletedCount;
  },

  recordIpfsCid(cid, modelName, modelType, modelHash, gatewayUrl) {
    const id = generateId('ipfs');
    const now = Date.now();
    const stmt = prep(`
      INSERT INTO ipfs_cids (id, cid, modelName, modelType, modelHash, gatewayUrl, cached_at, last_accessed_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?)
      ON CONFLICT(cid) DO UPDATE SET last_accessed_at = ?, success_count = success_count + 1
    `);
    stmt.run(id, cid, modelName, modelType, modelHash, gatewayUrl, now, now, now);
    const record = this.getIpfsCid(cid);
    return record ? record.id : id;
  },

  getIpfsCid(cid) {
    const stmt = prep('SELECT * FROM ipfs_cids WHERE cid = ?');
    return stmt.get(cid);
  },

  getIpfsCidByModel(modelName, modelType) {
    const stmt = prep('SELECT * FROM ipfs_cids WHERE modelName = ? AND modelType = ? ORDER BY last_accessed_at DESC LIMIT 1');
    return stmt.get(modelName, modelType);
  },

  recordDownloadStart(cidId, downloadPath, totalBytes) {
    const id = generateId('dl');
    const stmt = prep(`
      INSERT INTO ipfs_downloads (id, cidId, downloadPath, status, total_bytes, started_at)
      VALUES (?, ?, ?, ?, ?, ?)
    `);
    stmt.run(id, cidId, downloadPath, 'in_progress', totalBytes, Date.now());
    return id;
  },

  updateDownloadProgress(downloadId, downloadedBytes) {
    const stmt = prep(`
      UPDATE ipfs_downloads SET downloaded_bytes = ? WHERE id = ?
    `);
    stmt.run(downloadedBytes, downloadId);
  },

  completeDownload(downloadId, cidId) {
    const now = Date.now();
    prep(`
      UPDATE ipfs_downloads SET status = ?, completed_at = ? WHERE id = ?
    `).run('success', now, downloadId);
    prep(`
      UPDATE ipfs_cids SET last_accessed_at = ? WHERE id = ?
    `).run(now, cidId);
  },

  recordDownloadError(downloadId, cidId, errorMessage) {
    const now = Date.now();
    prep(`
      UPDATE ipfs_downloads SET status = ?, error_message = ?, completed_at = ? WHERE id = ?
    `).run('failed', errorMessage, now, downloadId);
    prep(`
      UPDATE ipfs_cids SET failure_count = failure_count + 1 WHERE id = ?
    `).run(cidId);
  },

  getDownload(downloadId) {
    const stmt = prep('SELECT * FROM ipfs_downloads WHERE id = ?');
    return stmt.get(downloadId);
  },

  getDownloadsByCid(cidId) {
    const stmt = prep('SELECT * FROM ipfs_downloads WHERE cidId = ? ORDER BY started_at DESC');
    return stmt.all(cidId);
  },

  getDownloadsByStatus(status) {
    const stmt = prep('SELECT * FROM ipfs_downloads WHERE status = ? ORDER BY started_at DESC');
    return stmt.all(status);
  },

  updateDownloadResume(downloadId, currentSize, attempts, lastAttempt, status) {
    const stmt = prep(`
      UPDATE ipfs_downloads
      SET downloaded_bytes = ?, attempts = ?, lastAttempt = ?, status = ?
      WHERE id = ?
    `);
    stmt.run(currentSize, attempts, lastAttempt, status, downloadId);
  },

  updateDownloadHash(downloadId, hash) {
    const stmt = prep('UPDATE ipfs_downloads SET hash = ? WHERE id = ?');
    stmt.run(hash, downloadId);
  },

  markDownloadResuming(downloadId) {
    const stmt = prep('UPDATE ipfs_downloads SET status = ?, lastAttempt = ? WHERE id = ?');
    stmt.run('resuming', Date.now(), downloadId);
  },

  markDownloadPaused(downloadId, errorMessage) {
    const stmt = prep('UPDATE ipfs_downloads SET status = ?, error_message = ?, lastAttempt = ? WHERE id = ?');
    stmt.run('paused', errorMessage, Date.now(), downloadId);
  }
};

export default { queries };
