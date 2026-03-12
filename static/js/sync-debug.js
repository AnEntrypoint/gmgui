/**
 * Sync-to-Display Debug System
 * Comprehensive logging and state validation for sync/render pipeline
 */

class SyncDebugger {
  constructor() {
    this.enabled = false;
    this.eventLog = [];
    this.maxLogSize = 500;
    this.stateSnapshots = [];
    this.processingStack = [];
    this.startTime = Date.now();

    // Event tracking
    this.processedEventIds = new Set();
    this.eventCounts = {};

    // Timing
    this.timingMarkers = {};
  }

  enable() {
    this.enabled = true;
    console.log('[SyncDebug] Enabled');
    window.SyncDebugger = this;
  }

  disable() {
    this.enabled = false;
    console.log('[SyncDebug] Disabled');
  }

  logEvent(type, data) {
    if (!this.enabled) return;

    const timestamp = Date.now() - this.startTime;
    const eventId = data?.id || data?.messageId || data?.conversationId || '?';

    // Check for duplicates
    const isDuplicate = this.processedEventIds.has(eventId) &&
                        this.eventLog.some(e => e.type === type && e.eventId === eventId);

    const entry = {
      timestamp,
      type,
      eventId,
      isDuplicate,
      dataKeys: data ? Object.keys(data) : [],
      dataSize: JSON.stringify(data || {}).length
    };

    this.eventLog.push(entry);
    this.eventCounts[type] = (this.eventCounts[type] || 0) + 1;
    this.processedEventIds.add(eventId);

    if (this.eventLog.length > this.maxLogSize) {
      this.eventLog.shift();
    }

    if (isDuplicate) {
      console.warn(`[SyncDebug] DUPLICATE EVENT: ${type} - ${eventId}`, entry);
    } else {
      console.log(`[SyncDebug] Event: ${type} (${timestamp}ms)`, entry);
    }
  }

  logStateChange(name, before, after) {
    if (!this.enabled) return;

    const timestamp = Date.now() - this.startTime;
    const snapshot = {
      timestamp,
      name,
      before: JSON.parse(JSON.stringify(before)),
      after: JSON.parse(JSON.stringify(after)),
      changed: JSON.stringify(before) !== JSON.stringify(after)
    };

    this.stateSnapshots.push(snapshot);
    if (this.stateSnapshots.length > this.maxLogSize) {
      this.stateSnapshots.shift();
    }

    if (snapshot.changed) {
      console.log(`[SyncDebug] State changed: ${name}`, snapshot);
    }
  }

  pushOperation(name) {
    const marker = { name, start: Date.now() };
    this.processingStack.push(marker);
    console.log(`[SyncDebug] > ${name}`);
  }

  popOperation() {
    const marker = this.processingStack.pop();
    if (marker) {
      const duration = Date.now() - marker.start;
      console.log(`[SyncDebug] < ${marker.name} (${duration}ms)`);
      if (duration > 100) {
        console.warn(`[SyncDebug] SLOW: ${marker.name} took ${duration}ms`);
      }
    }
  }

  getReport() {
    return {
      totalEvents: this.eventLog.length,
      eventCounts: this.eventCounts,
      duplicates: this.eventLog.filter(e => e.isDuplicate).length,
      stateChanges: this.stateSnapshots.length,
      uniqueEventIds: this.processedEventIds.size,
      recentEvents: this.eventLog.slice(-20),
      recentStateChanges: this.stateSnapshots.slice(-20)
    };
  }

  printReport() {
    const report = this.getReport();
    console.table(report);
    console.table(report.recentEvents);
    console.table(report.recentStateChanges);
  }

  clearLogs() {
    this.eventLog = [];
    this.stateSnapshots = [];
    this.processedEventIds.clear();
    this.eventCounts = {};
    this.processingStack = [];
    console.log('[SyncDebug] Logs cleared');
  }
}

// Create global instance
window.syncDebugger = new SyncDebugger();

// Expose commands
window.debugSync = {
  enable: () => window.syncDebugger.enable(),
  disable: () => window.syncDebugger.disable(),
  report: () => window.syncDebugger.printReport(),
  clear: () => window.syncDebugger.clearLogs(),
  get: () => window.syncDebugger.getReport()
};

console.log('[SyncDebug] Available. Use: debugSync.enable(), debugSync.report(), debugSync.clear()');
