/**
 * Request Manager - Phase 2: Request Lifetime Management
 * Tracks in-flight requests with unique IDs, enables cancellation on navigation
 * Prevents race conditions where older requests complete after newer ones
 */

class RequestManager {
  constructor() {
    this._requestId = 0;
    this._inflightRequests = new Map(); // requestId -> { conversationId, abortController, timestamp, priority }
    this._activeLoadId = null; // Track which request is currently being rendered
  }

  /**
   * Start a new load request for a conversation
   * Returns a request token that must be verified before rendering
   */
  startLoadRequest(conversationId, priority = 'normal') {
    const requestId = ++this._requestId;
    const abortController = new AbortController();

    this._inflightRequests.set(requestId, {
      conversationId,
      abortController,
      timestamp: Date.now(),
      priority,
      status: 'pending'
    });

    return {
      requestId,
      abortSignal: abortController.signal,
      cancel: () => this._cancelRequest(requestId),
      verify: () => this._verifyRequest(requestId, conversationId)
    };
  }

  /**
   * Mark request as completed (allows rendering)
   */
  completeRequest(requestId) {
    const req = this._inflightRequests.get(requestId);
    if (req) {
      req.status = 'completed';
      this._activeLoadId = requestId;
    }
  }

  /**
   * Verify request is still valid before rendering
   * Returns true only if this is the most recent request for this conversation
   */
  _verifyRequest(requestId, conversationId) {
    const req = this._inflightRequests.get(requestId);

    // Request not found or cancelled
    if (!req) return false;

    // Request is for different conversation
    if (req.conversationId !== conversationId) return false;

    // Find all requests for this conversation
    const allForConv = Array.from(this._inflightRequests.entries())
      .filter(([_, r]) => r.conversationId === conversationId && r.status === 'completed')
      .sort((a, b) => b[0] - a[0]); // Sort by requestId descending (newest first)

    // This request is the newest completed one for this conversation
    return allForConv.length > 0 && allForConv[0][0] === requestId;
  }

  /**
   * Cancel a request (aborts any pending network operations)
   */
  _cancelRequest(requestId) {
    const req = this._inflightRequests.get(requestId);
    if (req) {
      req.status = 'cancelled';
      req.abortController.abort();
    }
  }

  /**
   * Cancel all pending requests for a conversation
   */
  cancelConversationRequests(conversationId) {
    for (const [id, req] of this._inflightRequests.entries()) {
      if (req.conversationId === conversationId && req.status !== 'completed') {
        this._cancelRequest(id);
      }
    }
  }

  /**
   * Cancel all in-flight requests
   */
  cancelAllRequests() {
    for (const [id, req] of this._inflightRequests.entries()) {
      if (req.status !== 'completed') {
        this._cancelRequest(id);
      }
    }
  }

  /**
   * Clean up old requests to prevent memory leak
   */
  cleanup() {
    const now = Date.now();
    const maxAge = 60000; // Keep requests for 60 seconds

    for (const [id, req] of this._inflightRequests.entries()) {
      if (now - req.timestamp > maxAge) {
        this._inflightRequests.delete(id);
      }
    }
  }

  /**
   * Get debug info about in-flight requests
   */
  getDebugInfo() {
    return {
      activeLoadId: this._activeLoadId,
      inflightRequests: Array.from(this._inflightRequests.entries()).map(([id, req]) => ({
        requestId: id,
        conversationId: req.conversationId,
        timestamp: req.timestamp,
        status: req.status,
        priority: req.priority,
        age: Date.now() - req.timestamp
      }))
    };
  }
}

if (typeof window !== 'undefined') {
  window.RequestManager = new RequestManager();
}
