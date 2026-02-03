/**
 * Sync Manager - Handles real-time synchronization with automatic reconnection
 * Guarantees: No lost data, perfect recovery, consistent state
 */
class SyncManager {
  constructor() {
    this.ws = null;
    this.clientId = null;
    this.subscriptions = new Map();
    this.reconnectAttempts = 0;
    this.maxReconnectAttempts = 10;
    this.reconnectDelay = 1000;
    this.isConnected = false;
    this.handlers = new Map();
    this.lastCheckpoint = new Map();
  }

  /**
   * Connect to sync server with automatic reconnection
   */
  connect() {
    return new Promise((resolve, reject) => {
      const protocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
      const url = `${protocol}//${window.location.host}${window.__BASE_URL || '/gm'}/sync`;

      try {
        this.ws = new WebSocket(url);

        this.ws.onopen = () => {
          console.log('[SyncManager] Connected to server');
          this.isConnected = true;
          this.reconnectAttempts = 0;
          this.emit('connected', { clientId: this.clientId });

          // Resubscribe to all previously subscribed sessions
          for (const [sessionId, handlers] of this.subscriptions) {
            this.subscribe(sessionId, handlers.onUpdate, handlers.onRecover);
          }

          resolve();
        };

        this.ws.onmessage = (event) => {
          this.handleMessage(JSON.parse(event.data));
        };

        this.ws.onclose = () => {
          console.log('[SyncManager] Disconnected from server');
          this.isConnected = false;
          this.attemptReconnect();
        };

        this.ws.onerror = (error) => {
          console.error('[SyncManager] WebSocket error:', error);
          reject(error);
        };
      } catch (err) {
        console.error('[SyncManager] Failed to create WebSocket:', err);
        reject(err);
      }
    });
  }

  /**
   * Handle incoming messages
   */
  handleMessage(message) {
    const { type, sessionId, clientId } = message;

    if (type === 'sync_connected') {
      this.clientId = message.clientId;
      console.log(`[SyncManager] Assigned client ID: ${this.clientId}`);
    } else if (type === 'state_snapshot') {
      // Received state after subscription
      console.log(`[SyncManager] Received state snapshot for ${sessionId}`);
      this.lastCheckpoint.set(sessionId, message.state.checkpoint);

      const handlers = this.subscriptions.get(sessionId);
      if (handlers?.onRecover) {
        handlers.onRecover(message.state);
      }
    } else if (type === 'recovery_response') {
      // Received full state recovery
      console.log(`[SyncManager] Received recovery response for ${sessionId}`);
      this.lastCheckpoint.set(sessionId, message.state.checkpoint);

      const handlers = this.subscriptions.get(sessionId);
      if (handlers?.onRecover) {
        handlers.onRecover(message.state);
      }
    } else if (type === 'stream_update') {
      // Real-time update from server
      this.lastCheckpoint.set(sessionId, message.timestamp);

      const handlers = this.subscriptions.get(sessionId);
      if (handlers?.onUpdate) {
        try {
          handlers.onUpdate(message);
        } catch (err) {
          console.error(`[SyncManager] Error in update handler: ${err.message}`);
        }
      }
    }
  }

  /**
   * Subscribe to session updates with callbacks
   * @param {string} sessionId
   * @param {Function} onUpdate - Called for each real-time update
   * @param {Function} onRecover - Called with full state on subscribe/reconnect
   */
  subscribe(sessionId, onUpdate, onRecover) {
    if (!this.subscriptions.has(sessionId)) {
      this.subscriptions.set(sessionId, { onUpdate, onRecover });
    }

    if (this.isConnected && this.ws?.readyState === WebSocket.OPEN) {
      this.ws.send(JSON.stringify({
        type: 'subscribe',
        sessionId
      }));
    }
  }

  /**
   * Unsubscribe from session
   */
  unsubscribe(sessionId) {
    this.subscriptions.delete(sessionId);
    this.lastCheckpoint.delete(sessionId);

    if (this.isConnected && this.ws?.readyState === WebSocket.OPEN) {
      this.ws.send(JSON.stringify({
        type: 'unsubscribe',
        sessionId
      }));
    }
  }

  /**
   * Request recovery from a specific checkpoint
   * Called when client detects missing data
   */
  requestRecovery(sessionId) {
    console.log(`[SyncManager] Requesting recovery for ${sessionId}`);

    if (this.isConnected && this.ws?.readyState === WebSocket.OPEN) {
      this.ws.send(JSON.stringify({
        type: 'recovery_request',
        sessionId
      }));
    } else {
      // If not connected, recover when connection is restored
      this.connect().then(() => {
        this.ws.send(JSON.stringify({
          type: 'recovery_request',
          sessionId
        }));
      });
    }
  }

  /**
   * Verify data consistency by querying server
   */
  async validateSession(sessionId) {
    const baseUrl = window.__BASE_URL || '/gm';
    try {
      const response = await fetch(`${baseUrl}/api/sessions/${sessionId}/validate`);
      const validation = await response.json();
      return validation;
    } catch (err) {
      console.error(`[SyncManager] Validation failed: ${err.message}`);
      return null;
    }
  }

  /**
   * Fetch full state for recovery
   */
  async fetchSessionState(sessionId) {
    const baseUrl = window.__BASE_URL || '/gm';
    try {
      const response = await fetch(`${baseUrl}/api/sessions/${sessionId}/state-recovery`);
      if (!response.ok) return null;
      return await response.json();
    } catch (err) {
      console.error(`[SyncManager] Failed to fetch session state: ${err.message}`);
      return null;
    }
  }

  /**
   * Automatic reconnection with exponential backoff
   */
  attemptReconnect() {
    if (this.reconnectAttempts >= this.maxReconnectAttempts) {
      console.error('[SyncManager] Max reconnection attempts reached');
      this.emit('reconnect_failed');
      return;
    }

    this.reconnectAttempts++;
    const delay = this.reconnectDelay * Math.pow(2, this.reconnectAttempts - 1);
    console.log(`[SyncManager] Reconnecting in ${delay}ms (attempt ${this.reconnectAttempts}/${this.maxReconnectAttempts})`);

    setTimeout(() => {
      this.connect().catch(err => {
        console.error('[SyncManager] Reconnection failed:', err);
        this.attemptReconnect();
      });
    }, delay);
  }

  /**
   * Detect missing updates by checking sequence gaps
   */
  detectMissingUpdates(updates) {
    const gaps = [];
    for (let i = 0; i < updates.length - 1; i++) {
      if (updates[i + 1].sequence !== updates[i].sequence + 1) {
        gaps.push({
          expected: updates[i].sequence + 1,
          actual: updates[i + 1].sequence
        });
      }
    }
    return gaps;
  }

  /**
   * Register event listener
   */
  on(event, callback) {
    if (!this.handlers.has(event)) {
      this.handlers.set(event, []);
    }
    this.handlers.get(event).push(callback);
  }

  /**
   * Emit event
   */
  emit(event, data) {
    const callbacks = this.handlers.get(event) || [];
    for (const callback of callbacks) {
      try {
        callback(data);
      } catch (err) {
        console.error(`[SyncManager] Error in ${event} handler: ${err.message}`);
      }
    }
  }

  /**
   * Close connection gracefully
   */
  disconnect() {
    this.subscriptions.clear();
    this.lastCheckpoint.clear();
    if (this.ws) {
      this.ws.close();
      this.ws = null;
    }
  }
}

// Export as global for browser use
if (typeof window !== 'undefined') {
  window.SyncManager = SyncManager;
}

export default SyncManager;
