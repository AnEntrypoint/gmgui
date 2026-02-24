import crypto from 'crypto';

export function formatSSEEvent(eventType, data) {
  const lines = [];
  if (eventType) {
    lines.push(`event: ${eventType}`);
  }
  if (data) {
    const jsonData = typeof data === 'string' ? data : JSON.stringify(data);
    lines.push(`data: ${jsonData}`);
  }
  lines.push('');
  return lines.join('\n') + '\n';
}

export function convertToACPRunOutputStream(sessionId, block, runStatus = 'active') {
  const eventId = crypto.randomUUID();
  return {
    id: eventId,
    event: 'agent_event',
    data: {
      type: 'custom',
      run_id: sessionId,
      status: runStatus,
      update: block
    }
  };
}

export function createErrorEvent(runId, errorMessage, errorCode = 'execution_error') {
  const eventId = crypto.randomUUID();
  return {
    id: eventId,
    event: 'agent_event',
    data: {
      type: 'error',
      run_id: runId,
      error: errorMessage,
      code: errorCode,
      status: 'error'
    }
  };
}

export function createCompletionEvent(runId, values = {}, metadata = {}) {
  const eventId = crypto.randomUUID();
  return {
    id: eventId,
    event: 'agent_event',
    data: {
      type: 'result',
      run_id: runId,
      status: 'completed',
      values,
      metadata
    }
  };
}

export function createKeepAlive() {
  return ': ping\n\n';
}

export class SSEStreamManager {
  constructor(res, runId) {
    this.res = res;
    this.runId = runId;
    this.keepAliveInterval = null;
    this.closed = false;
  }

  start() {
    this.res.writeHead(200, {
      'Content-Type': 'text/event-stream',
      'Cache-Control': 'no-cache',
      'Connection': 'keep-alive',
      'X-Accel-Buffering': 'no'
    });

    this.keepAliveInterval = setInterval(() => {
      if (!this.closed) {
        this.writeRaw(createKeepAlive());
      }
    }, 15000);

    this.res.on('close', () => {
      this.cleanup();
    });
  }

  writeRaw(text) {
    if (!this.closed) {
      this.res.write(text);
    }
  }

  sendProgress(block, runStatus = 'active') {
    const acpEvent = convertToACPRunOutputStream(this.runId, block, runStatus);
    const sse = formatSSEEvent('message', acpEvent.data);
    this.writeRaw(sse);
  }

  sendError(errorMessage, errorCode = 'execution_error') {
    const errorEvent = createErrorEvent(this.runId, errorMessage, errorCode);
    const sse = formatSSEEvent('error', errorEvent.data);
    this.writeRaw(sse);
  }

  sendComplete(values = {}, metadata = {}) {
    const completionEvent = createCompletionEvent(this.runId, values, metadata);
    const sse = formatSSEEvent('done', completionEvent.data);
    this.writeRaw(sse);
  }

  cleanup() {
    if (this.keepAliveInterval) {
      clearInterval(this.keepAliveInterval);
      this.keepAliveInterval = null;
    }
    this.closed = true;
    if (!this.res.writableEnded) {
      this.res.end();
    }
  }
}
