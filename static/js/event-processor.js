class EventProcessor {
  constructor(config = {}) {
    this.config = {
      enableSyntaxHighlight: config.enableSyntaxHighlight !== false,
      ...config
    };

    this.stats = {
      totalEvents: 0,
      processedEvents: 0,
      validatedEvents: 0,
      transformedEvents: 0,
      errorCount: 0,
      avgProcessTime: 0
    };
  }

  /**
   * Process and enrich event
   */
  processEvent(event) {
    if (!event || typeof event !== 'object') {
      return null;
    }

    const startTime = performance.now();
    this.stats.totalEvents++;

    try {
      // Validate event structure
      if (!this.validateEvent(event)) {
        this.stats.errorCount++;
        return null;
      }

      this.stats.validatedEvents++;

      // Add processing metadata
      const processed = {
        ...event,
        processedAt: Date.now(),
        processTime: 0
      };

      if (event.type === 'file_read' && event.path && this.isImagePath(event.path)) {
        processed.isImage = true;
        processed.imagePath = event.path;
        this.stats.transformedEvents++;
      }

      if ((event.type === 'text_block' || event.type === 'command_execute' || event.type === 'streaming_progress') && (event.content || event.output)) {
        const imagePaths = this.extractImagePaths(event.content || event.output || '');
        if (imagePaths.length > 0) {
          processed.detectedImages = imagePaths;
          this.stats.transformedEvents++;
        }
      }

      processed.processTime = performance.now() - startTime;
      this.stats.processedEvents++;

      // Update average processing time
      this.stats.avgProcessTime = (this.stats.avgProcessTime * (this.stats.processedEvents - 1) + processed.processTime) / this.stats.processedEvents;

      return processed;
    } catch (error) {
      console.error('Event processing error:', error);
      this.stats.errorCount++;
      return null;
    }
  }

  /**
   * Validate event structure
   */
  validateEvent(event) {
    if (!event.type) {
      return false;
    }

    // Required fields by type
    const typeRequirements = {
      streaming_start: ['sessionId', 'conversationId'],
      streaming_complete: ['sessionId'],
      file_read: ['path'],
      file_write: ['path'],
      command_execute: ['command'],
      git_status: [],
      error: ['message']
    };

    const requirements = typeRequirements[event.type];
    if (requirements) {
      for (const field of requirements) {
        if (!event[field]) {
          return false;
        }
      }
    }

    return true;
  }

  /**
   * Detect language from content or hint
   */
  detectLanguage(content, hint = null) {
    if (hint) {
      return hint.toLowerCase();
    }

    // Simple language detection based on shebang or content patterns
    if (content.startsWith('#!/')) {
      if (content.includes('python')) return 'python';
      if (content.includes('node') || content.includes('javascript')) return 'javascript';
      if (content.includes('bash') || content.includes('sh')) return 'bash';
      if (content.includes('ruby')) return 'ruby';
    }

    // Pattern detection
    if (content.includes('def ') && content.includes(':')) return 'python';
    if (content.includes('function') || content.includes('=>')) return 'javascript';
    if (content.includes('fn ') && content.includes('->')) return 'rust';
    if (content.includes('public static void') || content.includes('class ')) return 'java';

    return 'plaintext';
  }

  /**
   * Parse JSON safely
   */
  parseJSON(jsonStr) {
    try {
      return JSON.parse(jsonStr);
    } catch (e) {
      console.error('JSON parse error:', e);
      return null;
    }
  }

  /**
   * Format JSON for display
   */
  formatJSON(obj, indent = 2) {
    try {
      return JSON.stringify(obj, null, indent);
    } catch (e) {
      return String(obj);
    }
  }

  /**
   * Extract file extension
   */
  getFileExtension(filePath) {
    const match = filePath.match(/\.([^.]+)$/);
    return match ? match[1].toLowerCase() : null;
  }

  /**
   * Truncate text with ellipsis
   */
  truncateText(text, maxLength = 200) {
    if (text.length <= maxLength) {
      return text;
    }
    return text.substring(0, maxLength) + '...';
  }

  /**
   * HTML escape utility
   */
  escapeHtml(text) {
    return window._escHtml(text);
  }

  /**
   * Format timestamp
   */
  formatTimestamp(timestamp) {
    const date = new Date(timestamp);
    return date.toLocaleTimeString();
  }

  /**
   * Get statistics
   */
  getStats() {
    return { ...this.stats };
  }

  /**
   * Reset statistics
   */
  resetStats() {
    this.stats = {
      totalEvents: 0,
      processedEvents: 0,
      validatedEvents: 0,
      transformedEvents: 0,
      errorCount: 0,
      avgProcessTime: 0
    };
  }

  /**
   * Check if a path is an image file
   */
  isImagePath(filePath) {
    if (!filePath || typeof filePath !== 'string') return false;
    const imageExts = ['png', 'jpg', 'jpeg', 'gif', 'webp', 'svg'];
    const ext = this.getFileExtension(filePath);
    return imageExts.includes(ext);
  }

  /**
   * Extract image file paths from text content
   */
  extractImagePaths(content) {
    if (typeof content !== 'string') return [];
    const paths = [];
    const pathPattern = /(?:\/[a-zA-Z0-9_.\-]+)+\/[a-zA-Z0-9_.\-]+\.(?:png|jpg|jpeg|gif|webp|svg)/gi;
    let match;
    while ((match = pathPattern.exec(content)) !== null) {
      if (this.isImagePath(match[0])) {
        paths.push(match[0]);
      }
    }
    return [...new Set(paths)];
  }
}

// Export for use in browser
if (typeof module !== 'undefined' && module.exports) {
  module.exports = EventProcessor;
}
