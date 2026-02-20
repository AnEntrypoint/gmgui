(function() {
  class TTSWebSocketHandler {
    constructor(wsManager) {
      this.wsManager = wsManager;
      this.streamBuffers = new Map();
      this.playbackBuffers = new Map();
      this.sequenceTrackers = new Map();
      this.MIN_BUFFER_CHUNKS = 2;
      this.JITTER_BUFFER_SIZE = 10;
      this.chunkTimeoutMs = 5000;
      this.chunkTimers = new Map();
    }

    initStream(streamId) {
      if (!this.streamBuffers.has(streamId)) {
        this.streamBuffers.set(streamId, []);
        this.playbackBuffers.set(streamId, []);
        this.sequenceTrackers.set(streamId, {
          lastSeq: -1,
          missing: [],
          outOfOrder: 0,
          complete: false
        });
      }
    }

    receiveChunk(streamId, chunk, seq, isLast) {
      this.initStream(streamId);
      const tracker = this.sequenceTrackers.get(streamId);
      const buffer = this.streamBuffers.get(streamId);

      clearTimeout(this.chunkTimers.get(`${streamId}:${seq}`));

      if (seq <= tracker.lastSeq) {
        tracker.outOfOrder++;
        return false;
      }

      if (seq > tracker.lastSeq + 1) {
        for (let i = tracker.lastSeq + 1; i < seq; i++) {
          tracker.missing.push(i);
        }
      }

      tracker.lastSeq = seq;
      buffer.push({ chunk, seq, isLast, receivedAt: Date.now() });

      if (buffer.length > this.JITTER_BUFFER_SIZE) {
        buffer.shift();
      }

      if (isLast) {
        this.markStreamComplete(streamId);
      }

      this.setChunkTimeout(streamId, seq);
      return true;
    }

    setChunkTimeout(streamId, seq) {
      const key = `${streamId}:${seq}`;
      const timer = setTimeout(() => {
        const tracker = this.sequenceTrackers.get(streamId);
        if (tracker && !tracker.missing.includes(seq)) {
          tracker.missing.push(seq);
        }
      }, this.chunkTimeoutMs);
      this.chunkTimers.set(key, timer);
    }

    getPlayableChunks(streamId) {
      const buffer = this.streamBuffers.get(streamId);
      if (!buffer || buffer.length === 0) return [];

      const playback = this.playbackBuffers.get(streamId);
      const lastPlayedSeq = playback.length > 0
        ? playback[playback.length - 1].seq
        : -1;

      const chunks = buffer.filter(c => c.seq > lastPlayedSeq);
      return chunks;
    }

    markChunksPlayed(streamId, upToSeq) {
      const buffer = this.streamBuffers.get(streamId);
      const playback = this.playbackBuffers.get(streamId);

      const toPlay = buffer.filter(c => c.seq <= upToSeq);
      playback.push(...toPlay);

      const newBuffer = buffer.filter(c => c.seq > upToSeq);
      this.streamBuffers.set(streamId, newBuffer);
    }

    canStartPlayback(streamId) {
      const buffer = this.streamBuffers.get(streamId);
      const playback = this.playbackBuffers.get(streamId);
      const tracker = this.sequenceTrackers.get(streamId);

      if (!buffer) return false;
      if (buffer.length === 0 && !tracker.complete) return false;

      return buffer.length >= this.MIN_BUFFER_CHUNKS || tracker.complete;
    }

    markStreamComplete(streamId) {
      const tracker = this.sequenceTrackers.get(streamId);
      if (tracker) tracker.complete = true;
    }

    isStreamComplete(streamId) {
      const tracker = this.sequenceTrackers.get(streamId);
      return tracker && tracker.complete;
    }

    hasLostPackets(streamId) {
      const tracker = this.sequenceTrackers.get(streamId);
      return tracker && tracker.missing.length > 0;
    }

    getStreamStats(streamId) {
      const tracker = this.sequenceTrackers.get(streamId);
      const buffer = this.streamBuffers.get(streamId);
      const playback = this.playbackBuffers.get(streamId);

      return {
        buffered: buffer ? buffer.length : 0,
        played: playback ? playback.length : 0,
        totalSeq: tracker ? tracker.lastSeq + 1 : 0,
        missing: tracker ? tracker.missing.length : 0,
        outOfOrder: tracker ? tracker.outOfOrder : 0,
        complete: tracker ? tracker.complete : false
      };
    }

    cleanupStream(streamId) {
      this.streamBuffers.delete(streamId);
      this.playbackBuffers.delete(streamId);
      this.sequenceTrackers.delete(streamId);

      const keys = Array.from(this.chunkTimers.keys());
      keys.forEach(key => {
        if (key.startsWith(`${streamId}:`)) {
          clearTimeout(this.chunkTimers.get(key));
          this.chunkTimers.delete(key);
        }
      });
    }
  }

  window.TTSWebSocketHandler = TTSWebSocketHandler;
})();
