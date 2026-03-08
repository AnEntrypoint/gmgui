/**
 * State Barrier - Atomic state machine for conversation management
 * Eliminates race conditions through single source of truth and version tracking
 */

class ConversationState {
  constructor() {
    this.current = {
      id: null,
      version: 0,
      data: null,
      timestamp: 0,
      reason: null
    };
    this.history = [];
    this.MAX_HISTORY = 50;
  }

  selectConversation(id, reason, serverVersion) {
    if (id === this.current.id && serverVersion === this.current.version) {
      return { success: false, reason: 'already_selected', prevState: this.current, newState: this.current };
    }
    const prevState = { ...this.current };
    this.current.id = id;
    this.current.version = serverVersion || (this.current.version + 1);
    this.current.timestamp = Date.now();
    this.current.reason = reason;
    this.current.data = null;
    this._recordHistory('selectConversation', prevState, this.current, reason);
    return { success: true, reason: 'selected', prevState, newState: { ...this.current } };
  }

  updateConversation(id, data, serverVersion) {
    if (id !== this.current.id) {
      return { success: false, reason: 'version_mismatch', prevState: this.current, newState: this.current };
    }
    if (serverVersion && serverVersion < this.current.version) {
      return { success: false, reason: 'stale_version', prevState: this.current, newState: this.current };
    }
    const prevState = { ...this.current };
    this.current.data = { ...this.current.data, ...data };
    this.current.version = serverVersion || (this.current.version + 1);
    this.current.timestamp = Date.now();
    this._recordHistory('updateConversation', prevState, this.current, 'update');
    return { success: true, reason: 'updated', prevState, newState: { ...this.current } };
  }

  deleteConversation(id, serverVersion) {
    if (id !== this.current.id) {
      return { success: false, reason: 'not_current', prevState: this.current, newState: this.current };
    }
    const prevState = { ...this.current };
    this.current.id = null;
    this.current.version = 0;
    this.current.data = null;
    this.current.timestamp = Date.now();
    this.current.reason = 'deleted';
    this._recordHistory('deleteConversation', prevState, this.current, 'delete');
    return { success: true, reason: 'deleted', prevState, newState: { ...this.current } };
  }

  clear(reason) {
    const prevState = { ...this.current };
    this.current.id = null;
    this.current.version = 0;
    this.current.data = null;
    this.current.timestamp = Date.now();
    this.current.reason = reason;
    this._recordHistory('clear', prevState, this.current, reason);
    return { success: true, reason: 'cleared', prevState, newState: { ...this.current } };
  }

  getCurrent() {
    return { ...this.current };
  }

  getVersion() {
    return this.current.version;
  }

  _recordHistory(operation, prevState, newState, detail) {
    this.history.push({
      operation,
      prevState,
      newState,
      detail,
      timestamp: Date.now()
    });
    if (this.history.length > this.MAX_HISTORY) {
      this.history.shift();
    }
  }

  getHistory() {
    return [...this.history];
  }

  debugDump() {
    return {
      current: { ...this.current },
      history: this.getHistory(),
      timestamp: Date.now()
    };
  }
}

if (typeof window !== 'undefined') {
  window.ConversationState = new ConversationState();
}
