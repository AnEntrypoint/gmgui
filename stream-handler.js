import { queries } from './database.js';
import { StateValidator } from './state-validator.js';

export class StreamHandler {
  constructor(sessionId, conversationId, broadcastFn) {
    this.sessionId = sessionId;
    this.conversationId = conversationId;
    this.broadcastFn = broadcastFn;
    this.updateCount = 0;
    this.sequence = -1;
    this.hasText = false;
    this.hasBlocks = false;
    this.blocks = [];
    this.stateCheckpoint = StateValidator.getSessionState(sessionId);
  }

  handleUpdate(params, baseUrl) {
    const u = params.update;
    if (!u) return;

    const kind = u.sessionUpdate;
    if (kind === 'agent_message_chunk' && u.content?.text) {
      this.hasText = true;
      const update = {
        type: 'text',
        content: u.content.text,
        timestamp: Date.now()
      };
      this.persistAndBroadcast('text', update, baseUrl);
    } else if (kind === 'html_content' && u.content?.html) {
      this.hasBlocks = true;
      const update = {
        type: 'html',
        html: u.content.html,
        title: u.content.title,
        id: u.content.id,
        timestamp: Date.now()
      };
      this.blocks.push({ type: 'html', html: u.content.html, title: u.content.title, id: u.content.id });
      this.persistAndBroadcast('html', update, baseUrl);
    } else if (kind === 'image_content' && u.content?.path) {
      this.hasBlocks = true;
      const imageUrl = baseUrl + '/api/image/' + encodeURIComponent(u.content.path);
      const update = {
        type: 'image',
        path: u.content.path,
        url: imageUrl,
        title: u.content.title,
        alt: u.content.alt,
        timestamp: Date.now()
      };
      this.blocks.push({ type: 'image', path: u.content.path, url: imageUrl, title: u.content.title, alt: u.content.alt });
      this.persistAndBroadcast('image', update, baseUrl);
    }
  }

  persistAndBroadcast(updateType, update, baseUrl) {
    try {
      // CRITICAL: Database write MUST complete before broadcast
      // This guarantees database is source of truth
      const persistedUpdate = queries.createStreamUpdate(this.sessionId, this.conversationId, updateType, update);
      this.sequence = persistedUpdate.sequence;
      this.updateCount++;

      // CRITICAL: Broadcast happens AFTER database write confirms
      // This ensures clients see data that's already persisted
      // Broadcast immediately with zero delay
      this.broadcastFn({
        type: 'stream_update',
        sessionId: this.sessionId,
        conversationId: this.conversationId,
        updateType,
        update: persistedUpdate.content,
        sequence: this.sequence,
        persisted: true,
        timestamp: persistedUpdate.created_at
      });

      // Validate consistency asynchronously (don't block broadcast)
      setImmediate(() => {
        try {
          const validation = StateValidator.validateSession(this.sessionId);
          if (!validation.valid) {
            console.error(`[StreamHandler] State validation failed: ${validation.error}`);
          }
        } catch (validationErr) {
          console.error(`[StreamHandler] Validation error: ${validationErr.message}`);
        }
      });
    } catch (err) {
      console.error(`[StreamHandler] Error persisting update: ${err.message}`);
      // On persistence failure, do NOT broadcast - maintain consistency
      throw err;
    }
  }

  getBlocks() {
    return this.blocks;
  }

  getUpdateCount() {
    return this.updateCount;
  }
}

export default StreamHandler;
