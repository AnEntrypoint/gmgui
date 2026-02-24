// WebSocket Optimization Module
// Implements batching, rate limiting, compression, deduplication, priority queuing, and monitoring

import zlib from 'zlib';

const MESSAGE_PRIORITY = {
  high: ['streaming_error', 'streaming_complete', 'rate_limit_hit', 'streaming_cancelled', 'run_cancelled'],
  normal: ['streaming_progress', 'streaming_start', 'message_created', 'queue_status'],
  low: ['model_download_progress', 'stt_progress', 'tts_setup_progress', 'voice_list', 'tts_audio']
};

function getPriority(eventType) {
  if (MESSAGE_PRIORITY.high.includes(eventType)) return 3;
  if (MESSAGE_PRIORITY.normal.includes(eventType)) return 2;
  if (MESSAGE_PRIORITY.low.includes(eventType)) return 1;
  return 2; // default to normal
}

class ClientQueue {
  constructor(ws) {
    this.ws = ws;
    this.highPriority = [];
    this.normalPriority = [];
    this.lowPriority = [];
    this.timer = null;
    this.lastMessage = null;
    this.messageCount = 0;
    this.bytesSent = 0;
    this.windowStart = Date.now();
    this.rateLimitWarned = false;
  }

  add(data, priority) {
    // Deduplication: skip if identical to last message
    if (this.lastMessage === data) return;
    this.lastMessage = data;

    if (priority === 3) {
      this.highPriority.push(data);
    } else if (priority === 2) {
      this.normalPriority.push(data);
    } else {
      this.lowPriority.push(data);
    }

    // High priority: flush immediately
    if (priority === 3) {
      this.flushImmediate();
    } else if (!this.timer) {
      this.scheduleFlush();
    }
  }

  scheduleFlush() {
    const interval = this.ws.latencyTier ? getBatchInterval(this.ws) : 100;
    this.timer = setTimeout(() => {
      this.timer = null;
      this.flush();
    }, interval);
  }

  flushImmediate() {
    if (this.timer) {
      clearTimeout(this.timer);
      this.timer = null;
    }
    this.flush();
  }

  flush() {
    if (this.ws.readyState !== 1) return;

    const now = Date.now();
    const windowDuration = now - this.windowStart;

    // Reset rate limit window every second
    if (windowDuration >= 1000) {
      this.messageCount = 0;
      this.bytesSent = 0;
      this.windowStart = now;
      this.rateLimitWarned = false;
    }

    // Collect messages from all priorities (high first)
    const batch = [
      ...this.highPriority.splice(0),
      ...this.normalPriority.splice(0, 10),
      ...this.lowPriority.splice(0, 5)
    ];

    if (batch.length === 0) return;

    // Rate limiting: max 100 msg/sec per client
    const messagesThisSecond = this.messageCount + batch.length;
    if (messagesThisSecond > 100) {
      if (!this.rateLimitWarned) {
        console.warn(`[ws-optimizer] Client ${this.ws.clientId} rate limited: ${messagesThisSecond} msg/sec`);
        this.rateLimitWarned = true;
      }
      // Keep high priority, drop some normal/low
      const allowedCount = 100 - this.messageCount;
      if (allowedCount <= 0) {
        // Reschedule remaining
        this.scheduleFlush();
        return;
      }
      batch.splice(allowedCount);
    }

    let payload;
    if (batch.length === 1) {
      payload = batch[0];
    } else {
      payload = '[' + batch.join(',') + ']';
    }

    // Compression for large payloads (>1KB)
    if (payload.length > 1024) {
      try {
        const compressed = zlib.gzipSync(Buffer.from(payload), { level: 6 });
        if (compressed.length < payload.length * 0.9) {
          // Send compression hint as separate control message
          this.ws.send(JSON.stringify({ type: '_compressed', encoding: 'gzip' }));
          this.ws.send(compressed);
          payload = null; // Already sent
        }
      } catch (e) {
        // Fall back to uncompressed
      }
    }

    if (payload) {
      this.ws.send(payload);
    }

    this.messageCount += batch.length;
    this.bytesSent += (payload ? payload.length : 0);

    // Monitor: warn if >1MB/sec sustained for 3+ seconds
    if (windowDuration >= 3000 && this.bytesSent > 3 * 1024 * 1024) {
      const mbps = (this.bytesSent / windowDuration * 1000 / 1024 / 1024).toFixed(2);
      console.warn(`[ws-optimizer] Client ${this.ws.clientId} high bandwidth: ${mbps} MB/sec`);
    }

    // If there are remaining low-priority messages, schedule next flush
    if (this.normalPriority.length > 0 || this.lowPriority.length > 0) {
      if (!this.timer) this.scheduleFlush();
    }
  }

  drain() {
    if (this.timer) {
      clearTimeout(this.timer);
      this.timer = null;
    }
    this.flush();
  }
}

function getBatchInterval(ws) {
  const BATCH_BY_TIER = { excellent: 16, good: 32, fair: 50, poor: 100, bad: 200 };
  const TIER_ORDER = ['excellent', 'good', 'fair', 'poor', 'bad'];
  const tier = ws.latencyTier || 'good';
  const trend = ws.latencyTrend;

  if (trend === 'rising' || trend === 'falling') {
    const idx = TIER_ORDER.indexOf(tier);
    if (trend === 'rising' && idx < TIER_ORDER.length - 1) {
      return BATCH_BY_TIER[TIER_ORDER[idx + 1]] || 32;
    }
    if (trend === 'falling' && idx > 0) {
      return BATCH_BY_TIER[TIER_ORDER[idx - 1]] || 32;
    }
  }

  return BATCH_BY_TIER[tier] || 32;
}

class WSOptimizer {
  constructor() {
    this.clientQueues = new Map();
  }

  sendToClient(ws, event) {
    if (ws.readyState !== 1) return;

    let queue = this.clientQueues.get(ws);
    if (!queue) {
      queue = new ClientQueue(ws);
      this.clientQueues.set(ws, queue);
    }

    const data = typeof event === 'string' ? event : JSON.stringify(event);
    const priority = typeof event === 'object' ? getPriority(event.type) : 2;

    queue.add(data, priority);
  }

  removeClient(ws) {
    const queue = this.clientQueues.get(ws);
    if (queue) {
      queue.drain();
      this.clientQueues.delete(ws);
    }
  }

  getStats() {
    const stats = {
      clients: this.clientQueues.size,
      totalBytes: 0,
      totalMessages: 0,
      highBandwidthClients: []
    };

    for (const [ws, queue] of this.clientQueues.entries()) {
      stats.totalBytes += queue.bytesSent;
      stats.totalMessages += queue.messageCount;

      const windowDuration = Date.now() - queue.windowStart;
      if (windowDuration > 0) {
        const mbps = (queue.bytesSent / windowDuration * 1000 / 1024 / 1024);
        if (mbps > 1) {
          stats.highBandwidthClients.push({
            clientId: ws.clientId,
            mbps: mbps.toFixed(2),
            messages: queue.messageCount
          });
        }
      }
    }

    return stats;
  }
}

export { WSOptimizer };
