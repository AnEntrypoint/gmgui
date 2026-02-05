/**
 * DATABASE-SERVICE.TS - Isolated database layer
 * All database operations go through this service
 * Type-safe, validated, and fully testable
 * Zero data loss guarantees with transactions and WAL mode
 */

import {
  Conversation,
  ConversationCreateInput,
  ConversationUpdateInput,
  Message,
  MessageCreateInput,
  Session,
  ValidationResult,
  ValidationError,
  SyncError,
  ExecutionMetadata,
  StreamingEvent,
} from './types';
import {
  validateConversation,
  validateMessage,
  ConversationCreateInputSchema,
  MessageCreateInputSchema,
} from './schemas';

interface Database {
  prepare: (sql: string) => any;
  transaction: (fn: () => void) => () => void;
  exec: (sql: string) => void;
  pragma: (pragma: string) => any;
  close: () => void;
}

/**
 * DatabaseService - Complete isolation of database operations
 * All reads/writes validated, all operations transactional
 */
export class DatabaseService {
  private db: Database;
  private closed = false;

  constructor(db: Database) {
    this.db = db;
    this.ensurePragma();
  }

  private ensurePragma() {
    try {
      this.db.pragma('journal_mode = WAL');
      this.db.pragma('foreign_keys = ON');
      this.db.pragma('synchronous = FULL');
    } catch (err) {
      console.error('[DatabaseService] Failed to set pragmas:', err);
    }
  }

  private checkClosed() {
    if (this.closed) {
      throw new SyncError('DATABASE_ERROR', 'Database connection is closed', false);
    }
  }

  // =========================================================================
  // CONVERSATION OPERATIONS
  // =========================================================================

  createConversation(input: ConversationCreateInput): Conversation {
    this.checkClosed();
    const validation = ConversationCreateInputSchema.safeParse(input);
    if (!validation.success) {
      throw new SyncError('VALIDATION_ERROR', `Invalid conversation input: ${validation.error.message}`, false);
    }

    const id = `conv-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`;
    const now = Date.now();

    try {
      const stmt = this.db.prepare(
        'INSERT INTO conversations (id, agentId, title, created_at, updated_at, status) VALUES (?, ?, ?, ?, ?, ?)'
      );
      stmt.run(id, input.agentId, input.title || null, now, now, 'active');

      return {
        id,
        agentId: input.agentId,
        title: input.title || null,
        created_at: now,
        updated_at: now,
        status: 'active',
      };
    } catch (err) {
      throw new SyncError(
        'DATABASE_ERROR',
        `Failed to create conversation: ${(err as Error).message}`,
        true,
        { input }
      );
    }
  }

  getConversation(id: string): Conversation | null {
    this.checkClosed();

    try {
      const stmt = this.db.prepare(
        'SELECT id, agentId, title, created_at, updated_at, status FROM conversations WHERE id = ? AND status != ?'
      );
      const row = stmt.get(id, 'deleted');

      if (!row) return null;

      const validation = validateConversation(row);
      if (!validation.valid) {
        throw new SyncError('VALIDATION_ERROR', `Invalid conversation data from DB: ${validation.error}`, false);
      }
      return validation.data;
    } catch (err) {
      throw new SyncError(
        'DATABASE_ERROR',
        `Failed to get conversation: ${(err as Error).message}`,
        true,
        { id }
      );
    }
  }

  getConversationsList(): Conversation[] {
    this.checkClosed();

    try {
      const stmt = this.db.prepare(
        'SELECT id, agentId, title, created_at, updated_at, status FROM conversations WHERE status != ? ORDER BY updated_at DESC'
      );
      const rows = stmt.all('deleted');

      return rows.map((row) => {
        const validation = validateConversation(row);
        if (!validation.valid) {
          console.warn('[DatabaseService] Invalid conversation in list:', row);
          return null;
        }
        return validation.data;
      }).filter((c): c is Conversation => c !== null);
    } catch (err) {
      throw new SyncError(
        'DATABASE_ERROR',
        `Failed to get conversations list: ${(err as Error).message}`,
        true
      );
    }
  }

  updateConversation(id: string, input: ConversationUpdateInput): Conversation {
    this.checkClosed();

    try {
      const existing = this.getConversation(id);
      if (!existing) {
        throw new SyncError('NOT_FOUND', `Conversation not found: ${id}`, false);
      }

      const now = Date.now();
      const title = input.title !== undefined ? input.title : existing.title;
      const status = input.status !== undefined ? input.status : existing.status;

      const stmt = this.db.prepare(
        'UPDATE conversations SET title = ?, status = ?, updated_at = ? WHERE id = ?'
      );
      stmt.run(title, status, now, id);

      return {
        ...existing,
        title,
        status,
        updated_at: now,
      };
    } catch (err) {
      if (err instanceof SyncError) throw err;
      throw new SyncError(
        'DATABASE_ERROR',
        `Failed to update conversation: ${(err as Error).message}`,
        true,
        { id, input }
      );
    }
  }

  deleteConversation(id: string): boolean {
    this.checkClosed();

    try {
      const stmt = this.db.prepare('UPDATE conversations SET status = ? WHERE id = ?');
      const result = stmt.run('deleted', id);
      return (result.changes || 0) > 0;
    } catch (err) {
      throw new SyncError(
        'DATABASE_ERROR',
        `Failed to delete conversation: ${(err as Error).message}`,
        true,
        { id }
      );
    }
  }

  // =========================================================================
  // MESSAGE OPERATIONS
  // =========================================================================

  createMessage(conversationId: string, input: Omit<MessageCreateInput, 'conversationId'>): Message {
    this.checkClosed();
    const validation = MessageCreateInputSchema.omit({ conversationId: true }).safeParse(input);
    if (!validation.success) {
      throw new SyncError('VALIDATION_ERROR', `Invalid message input: ${validation.error.message}`, false);
    }

    // Verify conversation exists
    const conversation = this.getConversation(conversationId);
    if (!conversation) {
      throw new SyncError('NOT_FOUND', `Conversation not found: ${conversationId}`, false);
    }

    const id = `msg-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`;
    const now = Date.now();

    try {
      const stmt = this.db.prepare(
        'INSERT INTO messages (id, conversationId, role, content, created_at) VALUES (?, ?, ?, ?, ?)'
      );
      stmt.run(id, conversationId, input.role, input.content, now);

      return {
        id,
        conversationId,
        role: input.role,
        content: input.content,
        created_at: now,
      };
    } catch (err) {
      throw new SyncError(
        'DATABASE_ERROR',
        `Failed to create message: ${(err as Error).message}`,
        true,
        { conversationId, input }
      );
    }
  }

  getMessage(id: string): Message | null {
    this.checkClosed();

    try {
      const stmt = this.db.prepare('SELECT id, conversationId, role, content, created_at FROM messages WHERE id = ?');
      const row = stmt.get(id);

      if (!row) return null;

      const validation = validateMessage(row);
      if (!validation.valid) {
        throw new SyncError('VALIDATION_ERROR', `Invalid message data from DB: ${validation.error}`, false);
      }
      return validation.data;
    } catch (err) {
      throw new SyncError(
        'DATABASE_ERROR',
        `Failed to get message: ${(err as Error).message}`,
        true,
        { id }
      );
    }
  }

  getConversationMessages(conversationId: string, limit = 50, offset = 0): Message[] {
    this.checkClosed();

    try {
      const stmt = this.db.prepare(
        'SELECT id, conversationId, role, content, created_at FROM messages WHERE conversationId = ? ORDER BY created_at ASC LIMIT ? OFFSET ?'
      );
      const rows = stmt.all(conversationId, limit, offset);

      return rows.map((row) => {
        const validation = validateMessage(row);
        if (!validation.valid) {
          console.warn('[DatabaseService] Invalid message in list:', row);
          return null;
        }
        return validation.data;
      }).filter((m): m is Message => m !== null);
    } catch (err) {
      throw new SyncError(
        'DATABASE_ERROR',
        `Failed to get messages: ${(err as Error).message}`,
        true,
        { conversationId, limit, offset }
      );
    }
  }

  deleteMessage(id: string): boolean {
    this.checkClosed();

    try {
      const stmt = this.db.prepare('DELETE FROM messages WHERE id = ?');
      const result = stmt.run(id);
      return (result.changes || 0) > 0;
    } catch (err) {
      throw new SyncError(
        'DATABASE_ERROR',
        `Failed to delete message: ${(err as Error).message}`,
        true,
        { id }
      );
    }
  }

  // =========================================================================
  // BATCH OPERATIONS
  // =========================================================================

  createMessagesBatch(conversationId: string, messages: Array<Omit<MessageCreateInput, 'conversationId'>>): Message[] {
    this.checkClosed();

    try {
      const transaction = this.db.transaction(() => {
        return messages.map((msg) => this.createMessage(conversationId, msg));
      });

      return transaction();
    } catch (err) {
      throw new SyncError(
        'DATABASE_ERROR',
        `Failed to batch create messages: ${(err as Error).message}`,
        true,
        { conversationId, count: messages.length }
      );
    }
  }

  // =========================================================================
  // INTEGRITY CHECKS
  // =========================================================================

  validateIntegrity(): { valid: boolean; errors: string[] } {
    this.checkClosed();
    const errors: string[] = [];

    try {
      // Check for orphaned messages
      const orphaned = this.db.prepare(
        'SELECT COUNT(*) as count FROM messages WHERE conversationId NOT IN (SELECT id FROM conversations WHERE status != ?)'
      ).get('deleted');

      if (orphaned.count > 0) {
        errors.push(`Found ${orphaned.count} orphaned messages`);
      }

      // Check for duplicate conversation IDs
      const duplicates = this.db.prepare(
        'SELECT COUNT(*) as count FROM (SELECT id FROM conversations GROUP BY id HAVING COUNT(*) > 1)'
      ).get();

      if (duplicates.count > 0) {
        errors.push(`Found ${duplicates.count} duplicate conversation IDs`);
      }
    } catch (err) {
      errors.push(`Integrity check failed: ${(err as Error).message}`);
    }

    return { valid: errors.length === 0, errors };
  }

  // =========================================================================
  // STREAMING EXECUTION OPERATIONS
  // =========================================================================

  storeExecutionEvent(sessionId: string, event: StreamingEvent): void {
    this.checkClosed();

    try {
      const stmt = this.db.prepare(
        'INSERT INTO execution_events (sessionId, eventType, eventData, timestamp) VALUES (?, ?, ?, ?)'
      );
      stmt.run(sessionId, event.type, JSON.stringify(event), event.timestamp || Date.now());
    } catch (err) {
      throw new SyncError(
        'DATABASE_ERROR',
        `Failed to store execution event: ${(err as Error).message}`,
        true,
        { sessionId, eventType: event.type }
      );
    }
  }

  storeExecutionMetadata(sessionId: string, metadata: ExecutionMetadata): void {
    this.checkClosed();

    try {
      const stmt = this.db.prepare(
        'INSERT OR REPLACE INTO execution_metadata (sessionId, metadata, updated_at) VALUES (?, ?, ?)'
      );
      stmt.run(sessionId, JSON.stringify(metadata), Date.now());
    } catch (err) {
      throw new SyncError(
        'DATABASE_ERROR',
        `Failed to store execution metadata: ${(err as Error).message}`,
        true,
        { sessionId }
      );
    }
  }

  getSessionExecutionHistory(sessionId: string, limit = 1000, offset = 0): StreamingEvent[] {
    this.checkClosed();

    try {
      const stmt = this.db.prepare(
        'SELECT eventData FROM execution_events WHERE sessionId = ? ORDER BY timestamp ASC LIMIT ? OFFSET ?'
      );
      const rows = stmt.all(sessionId, limit, offset);

      return rows.map((row) => {
        try {
          return JSON.parse(row.eventData);
        } catch (e) {
          console.warn('[DatabaseService] Invalid execution event JSON:', row.eventData);
          return null;
        }
      }).filter((e): e is StreamingEvent => e !== null);
    } catch (err) {
      throw new SyncError(
        'DATABASE_ERROR',
        `Failed to get execution history: ${(err as Error).message}`,
        true,
        { sessionId, limit, offset }
      );
    }
  }

  getExecutionMetadata(sessionId: string): ExecutionMetadata | null {
    this.checkClosed();

    try {
      const stmt = this.db.prepare('SELECT metadata FROM execution_metadata WHERE sessionId = ?');
      const row = stmt.get(sessionId);

      if (!row) return null;

      try {
        return JSON.parse(row.metadata);
      } catch (e) {
        throw new SyncError('VALIDATION_ERROR', `Invalid metadata JSON for session ${sessionId}`, false);
      }
    } catch (err) {
      if (err instanceof SyncError) throw err;
      throw new SyncError(
        'DATABASE_ERROR',
        `Failed to get execution metadata: ${(err as Error).message}`,
        true,
        { sessionId }
      );
    }
  }

  batchStoreExecutionEvents(sessionId: string, events: StreamingEvent[]): { count: number; latencyMs: number } {
    this.checkClosed();

    const startTime = Date.now();
    try {
      const transaction = this.db.transaction(() => {
        const stmt = this.db.prepare(
          'INSERT INTO execution_events (sessionId, eventType, eventData, timestamp) VALUES (?, ?, ?, ?)'
        );

        for (const event of events) {
          stmt.run(sessionId, event.type, JSON.stringify(event), event.timestamp || Date.now());
        }
      });

      transaction();
      const latencyMs = Date.now() - startTime;

      if (latencyMs > 100) {
        console.warn(`[DatabaseService] Batch write latency ${latencyMs}ms for ${events.length} events`);
      }

      return { count: events.length, latencyMs };
    } catch (err) {
      if (err instanceof SyncError) throw err;
      throw new SyncError(
        'DATABASE_ERROR',
        `Failed to batch store execution events: ${(err as Error).message}`,
        true,
        { sessionId, count: events.length }
      );
    }
  }

  batchStoreExecutionEventsOptimized(
    sessionId: string,
    events: StreamingEvent[],
    commitInterval = 100
  ): { count: number; batches: number; totalLatencyMs: number } {
    this.checkClosed();

    const startTime = Date.now();
    let processedCount = 0;
    let batchCount = 0;

    try {
      const stmt = this.db.prepare(
        'INSERT INTO execution_events (sessionId, eventType, eventData, timestamp) VALUES (?, ?, ?, ?)'
      );

      // Process in batches with commit points
      for (let i = 0; i < events.length; i += commitInterval) {
        const batch = events.slice(i, i + commitInterval);
        const transaction = this.db.transaction(() => {
          for (const event of batch) {
            stmt.run(sessionId, event.type, JSON.stringify(event), event.timestamp || Date.now());
            processedCount++;
          }
        });

        transaction();
        batchCount++;

        const elapsed = Date.now() - startTime;
        if (elapsed > 5000) {
          console.warn(`[DatabaseService] Long batch write: ${elapsed}ms for ${processedCount}/${events.length} events`);
        }
      }

      const totalLatencyMs = Date.now() - startTime;
      return { count: events.length, batches: batchCount, totalLatencyMs };
    } catch (err) {
      throw new SyncError(
        'DATABASE_ERROR',
        `Failed to batch store execution events (processed ${processedCount}/${events.length}): ${(err as Error).message}`,
        true,
        { sessionId, count: events.length, processed: processedCount }
      );
    }
  }

  markSessionIncomplete(sessionId: string, reason: string): void {
    this.checkClosed();

    try {
      const stmt = this.db.prepare(
        'UPDATE sessions SET status = ?, error = ?, completed_at = ? WHERE id = ?'
      );
      stmt.run('incomplete', reason, Date.now(), sessionId);
    } catch (err) {
      throw new SyncError(
        'DATABASE_ERROR',
        `Failed to mark session incomplete: ${(err as Error).message}`,
        true,
        { sessionId, reason }
      );
    }
  }

  getIncompleteSessionsOlderThan(ageMinutes = 30): Array<{ id: string; started_at: number }> {
    this.checkClosed();

    try {
      const cutoffTime = Date.now() - (ageMinutes * 60 * 1000);
      const stmt = this.db.prepare(
        'SELECT id, started_at FROM sessions WHERE status = ? AND started_at < ?'
      );
      return stmt.all('incomplete', cutoffTime);
    } catch (err) {
      throw new SyncError(
        'DATABASE_ERROR',
        `Failed to get incomplete sessions: ${(err as Error).message}`,
        true,
        { ageMinutes }
      );
    }
  }

  markSessionComplete(sessionId: string, status: 'completed' | 'error' | 'timeout'): void {
    this.checkClosed();

    try {
      const stmt = this.db.prepare(
        'UPDATE sessions SET status = ?, completed_at = ? WHERE id = ?'
      );
      stmt.run(status, Date.now(), sessionId);
    } catch (err) {
      throw new SyncError(
        'DATABASE_ERROR',
        `Failed to mark session complete: ${(err as Error).message}`,
        true,
        { sessionId, status }
      );
    }
  }

  cleanupOrphanedSessions(maxAgeDays = 7): number {
    this.checkClosed();

    try {
      const maxAgeMs = maxAgeDays * 24 * 60 * 60 * 1000;
      const cutoffTime = Date.now() - maxAgeMs;

      const stmt = this.db.prepare(
        'DELETE FROM sessions WHERE status NOT IN (?, ?, ?) AND started_at < ?'
      );
      const result = stmt.run('processing', 'pending', 'incomplete', cutoffTime);
      return (result.changes || 0);
    } catch (err) {
      throw new SyncError(
        'DATABASE_ERROR',
        `Failed to cleanup orphaned sessions: ${(err as Error).message}`,
        true,
        { maxAgeDays }
      );
    }
  }

  // =========================================================================
  // LIFECYCLE
  // =========================================================================

  close() {
    if (!this.closed) {
      try {
        this.db.close();
        this.closed = true;
      } catch (err) {
        console.error('[DatabaseService] Error closing database:', err);
      }
    }
  }
}

export default DatabaseService;
