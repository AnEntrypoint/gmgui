const ToolStatusComponent = {
  state: {
    tools: [],
    expandedTool: null,
    refreshing: false
  },

  init() {
    this.loadTools();
    if (window.wsManager) {
      window.wsManager.on('tool_install_started', (data) => this.handleInstallStarted(data));
      window.wsManager.on('tool_install_progress', (data) => this.handleProgress(data));
      window.wsManager.on('tool_install_complete', (data) => this.handleInstallComplete(data));
      window.wsManager.on('tool_install_failed', (data) => this.handleInstallFailed(data));
      window.wsManager.on('tool_update_complete', (data) => this.handleUpdateComplete(data));
      window.wsManager.on('tool_update_failed', (data) => this.handleUpdateFailed(data));
      window.wsManager.on('tools_refresh_complete', (data) => this.handleRefreshComplete(data));
    }
  },

  async loadTools() {
    try {
      const res = await fetch('/gm/api/tools');
      const data = await res.json();
      this.state.tools = data.tools || [];
      this.render();
    } catch (e) {
      console.error('[TOOL-STATUS] Load failed:', e.message);
    }
  },

  async installTool(toolId) {
    try {
      const res = await fetch(`/gm/api/tools/${toolId}/install`, { method: 'POST' });
      const data = await res.json();
      if (data.success) {
        const tool = this.state.tools.find(t => t.id === toolId);
        if (tool) tool.status = 'installing';
        this.render();
      } else {
        alert('Install failed: ' + (data.error || 'Unknown error'));
      }
    } catch (e) {
      alert('Install failed: ' + e.message);
    }
  },

  async updateTool(toolId) {
    try {
      const res = await fetch(`/gm/api/tools/${toolId}/update`, { method: 'POST', body: JSON.stringify({}) });
      const data = await res.json();
      if (data.success) {
        const tool = this.state.tools.find(t => t.id === toolId);
        if (tool) tool.status = 'updating';
        this.render();
      } else {
        alert('Update failed: ' + (data.error || 'Unknown error'));
      }
    } catch (e) {
      alert('Update failed: ' + e.message);
    }
  },

  async refreshTools() {
    this.state.refreshing = true;
    this.render();
    try {
      await fetch('/gm/api/tools/refresh-all', { method: 'POST' });
    } catch (e) {
      console.error('[TOOL-STATUS] Refresh failed:', e.message);
    }
  },

  handleInstallStarted(data) {
    const tool = this.state.tools.find(t => t.id === data.toolId);
    if (tool) {
      tool.status = 'installing';
      tool.progress = 0;
      this.render();
    }
  },

  handleProgress(data) {
    const tool = this.state.tools.find(t => t.id === data.toolId);
    if (tool) {
      tool.progress = Math.min((tool.progress || 0) + 5, 90);
      this.render();
    }
  },

  handleInstallComplete(data) {
    const tool = this.state.tools.find(t => t.id === data.toolId);
    if (tool) {
      tool.status = 'installed';
      tool.version = data.data.version;
      tool.progress = 100;
      this.render();
      setTimeout(() => this.loadTools(), 1000);
    }
  },

  handleInstallFailed(data) {
    const tool = this.state.tools.find(t => t.id === data.toolId);
    if (tool) {
      tool.status = 'failed';
      tool.error_message = data.data.error;
      tool.progress = 0;
      this.render();
    }
  },

  handleUpdateComplete(data) {
    const tool = this.state.tools.find(t => t.id === data.toolId);
    if (tool) {
      tool.status = 'installed';
      tool.version = data.data.version;
      tool.hasUpdate = false;
      tool.progress = 100;
      this.render();
      setTimeout(() => this.loadTools(), 1000);
    }
  },

  handleUpdateFailed(data) {
    const tool = this.state.tools.find(t => t.id === data.toolId);
    if (tool) {
      tool.status = 'failed';
      tool.error_message = data.data.error;
      this.render();
    }
  },

  handleRefreshComplete(data) {
    this.state.refreshing = false;
    this.loadTools();
  },

  getStatusColor(tool) {
    if (tool.status === 'installed' && !tool.hasUpdate) return '#4CAF50';
    if (tool.status === 'installed' && tool.hasUpdate) return '#FFC107';
    if (tool.status === 'installing' || tool.status === 'updating') return '#2196F3';
    if (tool.status === 'failed') return '#F44336';
    return '#9E9E9E';
  },

  getStatusText(tool) {
    if (tool.status === 'installed') {
      if (tool.hasUpdate) return `Update available (v${tool.latestVersion})`;
      return `Installed v${tool.version || '?'}`;
    }
    if (tool.status === 'installing') return 'Installing...';
    if (tool.status === 'updating') return 'Updating...';
    if (tool.status === 'failed') return 'Failed';
    return 'Not installed';
  },

  render() {
    const container = document.getElementById('tool-status-container');
    if (!container) return;

    const html = `
      <div class="tool-status-header">
        <h3>Tools</h3>
        <button onclick="window.toolStatus.refreshTools()" ${this.state.refreshing ? 'disabled' : ''} class="tool-refresh-btn">
          ${this.state.refreshing ? 'Refreshing...' : 'Refresh'}
        </button>
      </div>
      <div class="tool-grid">
        ${this.state.tools.map(tool => `
          <div class="tool-card" style="border-left: 4px solid ${this.getStatusColor(tool)}">
            <div class="tool-name">${tool.name || tool.id}</div>
            <div class="tool-status">${this.getStatusText(tool)}</div>
            ${tool.progress !== undefined && (tool.status === 'installing' || tool.status === 'updating') ? `
              <div class="tool-progress">
                <div class="progress-bar" style="width: ${tool.progress}%"></div>
              </div>
            ` : ''}
            <div class="tool-actions">
              ${!tool.installed ? `
                <button onclick="window.toolStatus.installTool('${tool.id}')" class="tool-btn tool-btn-primary">Install</button>
              ` : tool.hasUpdate ? `
                <button onclick="window.toolStatus.updateTool('${tool.id}')" class="tool-btn tool-btn-primary">Update</button>
              ` : `
                <button onclick="window.toolStatus.refreshTools()" class="tool-btn tool-btn-secondary">Check Updates</button>
              `}
              ${tool.status === 'failed' ? `
                <button onclick="window.toolStatus.installTool('${tool.id}')" class="tool-btn tool-btn-warning">Retry</button>
              ` : ''}
              ${tool.error_message ? `
                <div class="tool-error" title="${tool.error_message}">
                  Error: ${tool.error_message.substring(0, 30)}...
                  <a href="#" onclick="alert('${tool.error_message.replace(/"/g, '\\"')}'); return false;">Details</a>
                </div>
              ` : ''}
            </div>
          </div>
        `).join('')}
      </div>
      <style>
        #tool-status-container {
          padding: 16px;
          border: 1px solid #e0e0e0;
          border-radius: 4px;
          margin-bottom: 16px;
        }
        .tool-status-header {
          display: flex;
          justify-content: space-between;
          align-items: center;
          margin-bottom: 16px;
        }
        .tool-status-header h3 {
          margin: 0;
          font-size: 18px;
        }
        .tool-refresh-btn {
          padding: 6px 12px;
          background: #2196F3;
          color: white;
          border: none;
          border-radius: 4px;
          cursor: pointer;
          font-size: 12px;
        }
        .tool-refresh-btn:disabled {
          opacity: 0.6;
          cursor: not-allowed;
        }
        .tool-grid {
          display: grid;
          grid-template-columns: repeat(auto-fill, minmax(200px, 1fr));
          gap: 12px;
        }
        .tool-card {
          padding: 12px;
          border: 1px solid #ddd;
          border-radius: 4px;
          background: #f9f9f9;
        }
        .tool-name {
          font-weight: bold;
          margin-bottom: 4px;
          font-size: 14px;
        }
        .tool-status {
          font-size: 12px;
          color: #666;
          margin-bottom: 8px;
        }
        .tool-progress {
          width: 100%;
          height: 6px;
          background: #e0e0e0;
          border-radius: 3px;
          overflow: hidden;
          margin-bottom: 8px;
        }
        .progress-bar {
          height: 100%;
          background: #4CAF50;
          transition: width 0.3s;
        }
        .tool-actions {
          display: flex;
          flex-direction: column;
          gap: 6px;
        }
        .tool-btn {
          padding: 6px;
          border: none;
          border-radius: 3px;
          cursor: pointer;
          font-size: 12px;
          white-space: nowrap;
        }
        .tool-btn-primary {
          background: #2196F3;
          color: white;
        }
        .tool-btn-primary:hover {
          background: #1976D2;
        }
        .tool-btn-secondary {
          background: #f0f0f0;
          color: #333;
          border: 1px solid #ddd;
        }
        .tool-btn-secondary:hover {
          background: #e0e0e0;
        }
        .tool-btn-warning {
          background: #FF9800;
          color: white;
        }
        .tool-btn-warning:hover {
          background: #F57C00;
        }
        .tool-error {
          font-size: 11px;
          color: #F44336;
          padding: 6px;
          background: #ffebee;
          border-radius: 2px;
          margin-top: 4px;
        }
        .tool-error a {
          color: #C62828;
          text-decoration: underline;
          cursor: pointer;
        }
      </style>
    `;

    container.innerHTML = html;
    window.toolStatus = this;
  }
};

if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', () => ToolStatusComponent.init());
} else {
  ToolStatusComponent.init();
}
