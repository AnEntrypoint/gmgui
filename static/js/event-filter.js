/**
 * Event Filter & Search
 * Provides event filtering, searching, and replay functionality
 */

class EventFilter {
  constructor(renderer) {
    this.renderer = renderer;
    this.allEvents = [];
    this.filteredEvents = [];
    this.filterState = {
      types: new Set(), // Selected event types to show
      searchText: '',
      startTime: null,
      endTime: null,
      isActive: false
    };
    this.replayState = {
      isReplaying: false,
      currentIndex: 0,
      speed: 1
    };
  }

  /**
   * Store all events for filtering
   */
  trackEvent(event) {
    this.allEvents.push({
      ...event,
      trackingId: this.allEvents.length,
      trackedAt: Date.now()
    });

    // Limit history
    if (this.allEvents.length > 5000) {
      this.allEvents.shift();
    }

    // Apply current filters
    if (this.filterState.isActive) {
      this.applyFilters();
    }

    return event;
  }

  /**
   * Set event type filter
   */
  setTypeFilter(types) {
    this.filterState.types = new Set(types);
    this.applyFilters();
  }

  /**
   * Toggle event type in filter
   */
  toggleType(type) {
    if (this.filterState.types.has(type)) {
      this.filterState.types.delete(type);
    } else {
      this.filterState.types.add(type);
    }
    this.applyFilters();
  }

  /**
   * Set search text
   */
  setSearchText(text) {
    this.filterState.searchText = text.toLowerCase();
    this.applyFilters();
  }

  /**
   * Set time range
   */
  setTimeRange(startTime, endTime) {
    this.filterState.startTime = startTime;
    this.filterState.endTime = endTime;
    this.applyFilters();
  }

  /**
   * Apply all filters
   */
  applyFilters() {
    this.filterState.isActive =
      this.filterState.types.size > 0 ||
      this.filterState.searchText.length > 0 ||
      this.filterState.startTime !== null ||
      this.filterState.endTime !== null;

    if (!this.filterState.isActive) {
      this.filteredEvents = [...this.allEvents];
      return this.filteredEvents;
    }

    this.filteredEvents = this.allEvents.filter(event => {
      // Type filter
      if (this.filterState.types.size > 0 && !this.filterState.types.has(event.type)) {
        return false;
      }

      // Search filter
      if (this.filterState.searchText.length > 0) {
        const searchable = JSON.stringify(event).toLowerCase();
        if (!searchable.includes(this.filterState.searchText)) {
          return false;
        }
      }

      // Time range filter
      const eventTime = event.timestamp || event.trackedAt;
      if (this.filterState.startTime && eventTime < this.filterState.startTime) {
        return false;
      }
      if (this.filterState.endTime && eventTime > this.filterState.endTime) {
        return false;
      }

      return true;
    });

    return this.filteredEvents;
  }

  /**
   * Search events by text
   */
  search(query) {
    const results = [];
    const lowerQuery = query.toLowerCase();

    for (let i = 0; i < this.allEvents.length; i++) {
      const event = this.allEvents[i];
      const searchable = JSON.stringify(event).toLowerCase();

      if (searchable.includes(lowerQuery)) {
        results.push({
          event,
          index: i,
          matchCount: (searchable.match(new RegExp(lowerQuery, 'g')) || []).length
        });
      }
    }

    return results.sort((a, b) => b.matchCount - a.matchCount);
  }

  /**
   * Get event statistics
   */
  getStats() {
    const stats = {
      total: this.allEvents.length,
      byType: {},
      byTime: {
        oldest: null,
        newest: null,
        span: 0
      }
    };

    for (const event of this.allEvents) {
      // Count by type
      stats.byType[event.type] = (stats.byType[event.type] || 0) + 1;

      // Time stats
      const time = event.timestamp || event.trackedAt;
      if (!stats.byTime.oldest || time < stats.byTime.oldest) {
        stats.byTime.oldest = time;
      }
      if (!stats.byTime.newest || time > stats.byTime.newest) {
        stats.byTime.newest = time;
      }
    }

    if (stats.byTime.oldest && stats.byTime.newest) {
      stats.byTime.span = stats.byTime.newest - stats.byTime.oldest;
    }

    return stats;
  }

  /**
   * Start event replay
   */
  async startReplay(events = null, speed = 1) {
    const replayEvents = events || this.filteredEvents;
    if (replayEvents.length === 0) return;

    this.replayState.isReplaying = true;
    this.replayState.currentIndex = 0;
    this.replayState.speed = speed;

    // Clear renderer
    this.renderer.clear();

    for (const event of replayEvents) {
      if (!this.replayState.isReplaying) break;

      // Estimate delay based on event timestamps
      const delay = 100 / this.replayState.speed;
      await new Promise(resolve => setTimeout(resolve, delay));

      this.renderer.queueEvent(event);
      this.replayState.currentIndex++;
    }

    this.replayState.isReplaying = false;
  }

  /**
   * Stop event replay
   */
  stopReplay() {
    this.replayState.isReplaying = false;
  }

  /**
   * Get replay progress
   */
  getReplayProgress() {
    const total = this.filteredEvents.length;
    const current = this.replayState.currentIndex;
    return {
      current,
      total,
      percentage: total > 0 ? (current / total) * 100 : 0,
      isReplaying: this.replayState.isReplaying
    };
  }

  /**
   * Export filtered events
   */
  export(format = 'json') {
    const events = this.filterState.isActive ? this.filteredEvents : this.allEvents;

    switch (format) {
      case 'json':
        return JSON.stringify(events, null, 2);

      case 'csv':
        return this.exportAsCSV(events);

      case 'markdown':
        return this.exportAsMarkdown(events);

      default:
        return JSON.stringify(events);
    }
  }

  /**
   * Export as CSV
   */
  exportAsCSV(events) {
    const headers = ['timestamp', 'type', 'id', 'sessionId', 'message'];
    const rows = [headers.join(',')];

    for (const event of events) {
      const row = [
        new Date(event.timestamp || event.trackedAt).toISOString(),
        event.type,
        event.id || '',
        event.sessionId || '',
        JSON.stringify(event.message || event.content || event.text || '')
      ];
      rows.push(row.map(v => `"${v}"`).join(','));
    }

    return rows.join('\n');
  }

  /**
   * Export as Markdown
   */
  exportAsMarkdown(events) {
    const lines = ['# Event Export\n'];
    let currentType = null;

    for (const event of events) {
      if (event.type !== currentType) {
        currentType = event.type;
        lines.push(`\n## ${currentType}\n`);
      }

      const time = new Date(event.timestamp || event.trackedAt).toLocaleTimeString();
      lines.push(`- **${time}**: ${JSON.stringify(event)}`);
    }

    return lines.join('\n');
  }

  /**
   * Clear history
   */
  clear() {
    this.allEvents = [];
    this.filteredEvents = [];
    this.stopReplay();
  }
}

// Export for use in browser
if (typeof module !== 'undefined' && module.exports) {
  module.exports = EventFilter;
}
