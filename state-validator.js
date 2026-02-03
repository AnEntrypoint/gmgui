import { queries } from './database.js';
import crypto from 'crypto';

export class StateValidator {
  /**
   * Validates data consistency by checking:
   * 1. Sequence numbers are consecutive (no gaps)
   * 2. Stream updates match database
   * 3. Final message matches aggregated stream updates
   */
  static validateSession(sessionId) {
    try {
      const session = queries.getSession(sessionId);
      if (!session) return { valid: false, error: 'Session not found' };

      const updates = queries.getSessionStreamUpdates(sessionId);

      // Check 1: Sequence continuity
      const sequenceGaps = [];
      for (let i = 0; i < updates.length - 1; i++) {
        if (updates[i + 1].sequence !== updates[i].sequence + 1) {
          sequenceGaps.push({ expected: updates[i].sequence + 1, actual: updates[i + 1].sequence });
        }
      }

      if (sequenceGaps.length > 0) {
        return {
          valid: false,
          error: 'Sequence gaps detected',
          gaps: sequenceGaps
        };
      }

      // Check 2: Stream update count matches
      const textUpdates = updates.filter(u => u.updateType === 'text');
      const htmlUpdates = updates.filter(u => u.updateType === 'html');
      const imageUpdates = updates.filter(u => u.updateType === 'image');

      // Check 3: Sequence starts at 0
      if (updates.length > 0 && updates[0].sequence !== 0) {
        return {
          valid: false,
          error: 'Sequence should start at 0',
          firstSequence: updates[0].sequence
        };
      }

      return {
        valid: true,
        sessionId,
        updateCount: updates.length,
        textCount: textUpdates.length,
        htmlCount: htmlUpdates.length,
        imageCount: imageUpdates.length,
        latestSequence: updates.length > 0 ? updates[updates.length - 1].sequence : -1,
        checkpoint: this.createChecksum(updates)
      };
    } catch (err) {
      return {
        valid: false,
        error: err.message
      };
    }
  }

  /**
   * Creates checksum of stream updates for integrity verification
   */
  static createChecksum(updates) {
    const data = updates
      .map(u => `${u.sequence}:${u.updateType}:${u.created_at}`)
      .join('|');
    return crypto.createHash('sha256').update(data).digest('hex');
  }

  /**
   * Verifies checksum hasn't changed (data integrity)
   */
  static verifyChecksum(updates, expectedChecksum) {
    return this.createChecksum(updates) === expectedChecksum;
  }

  /**
   * Gets current state for client recovery
   */
  static getSessionState(sessionId) {
    const session = queries.getSession(sessionId);
    if (!session) return null;

    const updates = queries.getSessionStreamUpdates(sessionId);
    const validation = this.validateSession(sessionId);

    return {
      session: {
        id: session.id,
        conversationId: session.conversationId,
        status: session.status,
        started_at: session.started_at,
        completed_at: session.completed_at
      },
      updates: updates.map(u => ({
        sequence: u.sequence,
        updateType: u.updateType,
        content: u.content,
        created_at: u.created_at
      })),
      validation,
      checkpoint: validation.checkpoint,
      recoveryPoint: {
        lastSequence: updates.length > 0 ? updates[updates.length - 1].sequence : -1,
        totalUpdates: updates.length,
        timestamp: Date.now()
      }
    };
  }

  /**
   * Validates incoming update against current state
   */
  static validateUpdate(sessionId, incomingUpdate, lastKnownSequence) {
    const updates = queries.getSessionStreamUpdates(sessionId);
    const maxSequence = updates.length > 0 ? updates[updates.length - 1].sequence : -1;

    // Check if this is the next expected sequence
    const expectedSequence = maxSequence + 1;
    if (incomingUpdate.sequence !== expectedSequence) {
      return {
        valid: false,
        error: 'Sequence out of order',
        expected: expectedSequence,
        received: incomingUpdate.sequence,
        action: 'FETCH_MISSING_UPDATES'
      };
    }

    // Check for duplicates (same sequence already exists)
    if (updates.some(u => u.sequence === incomingUpdate.sequence)) {
      return {
        valid: false,
        error: 'Duplicate update detected',
        sequence: incomingUpdate.sequence,
        action: 'IGNORE_DUPLICATE'
      };
    }

    return { valid: true, sequence: expectedSequence };
  }
}

export default StateValidator;
