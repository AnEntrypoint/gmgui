const ToolStatusComponent = {
  state: { tools: [], refreshing: false },

  init() {
    this.loadTools();
    if (window.wsManager) {
      const events = ['tool_install_started', 'tool_install_progress', 'tool_install_complete', 'tool_install_failed', 'tool_update_complete', 'tool_update_failed', 'tools_refresh_complete'];
      events.forEach(e => window.wsManager.on(e, (d) => this.handleEvent(e, d)));
    }
  },

  async loadTools() {
    try { const res = await fetch('/gm/api/tools'); this.state.tools = (await res.json()).tools || []; this.render(); } catch (e) { console.error('[TOOL-STATUS]', e.message); }
  },

  async act(action, toolId) {
    try { const res = await fetch(`/gm/api/tools/${toolId}/${action}`, { method: 'POST' }); const data = await res.json(); if (!data.success) alert(`${action} failed: ${data.error || 'Unknown error'}`); } catch (e) { alert(`${action} failed: ${e.message}`); }
  },

  async refreshTools() { this.state.refreshing = true; this.render(); try { await fetch('/gm/api/tools/refresh-all', { method: 'POST' }); } catch (e) { console.error('[TOOL-STATUS]', e.message); } },

  handleEvent(event, data) {
    const tool = this.state.tools.find(t => t.id === data.toolId);
    if (!tool) return;
    if (event === 'tool_install_started') { tool.status = 'installing'; tool.progress = 0; }
    else if (event === 'tool_install_progress') { tool.progress = Math.min((tool.progress || 0) + 5, 90); }
    else if (event.includes('_complete')) { tool.status = 'installed'; tool.version = data.data.version; tool.hasUpdate = false; tool.progress = 100; setTimeout(() => this.loadTools(), 1000); }
    else if (event.includes('_failed')) { tool.status = 'failed'; tool.error_message = data.data.error; tool.progress = 0; }
    else if (event === 'tools_refresh_complete') { this.state.refreshing = false; this.loadTools(); return; }
    this.render();
  },

  getStatusColor(tool) { return tool.status === 'installed' && !tool.hasUpdate ? '#4CAF50' : tool.status === 'installed' && tool.hasUpdate ? '#FFC107' : ['installing', 'updating'].includes(tool.status) ? '#2196F3' : tool.status === 'failed' ? '#F44336' : '#9E9E9E'; },

  getStatusText(tool) { return tool.status === 'installed' ? (tool.hasUpdate ? `Update available (v${tool.latestVersion})` : `Installed v${tool.version || '?'}`) : tool.status === 'installing' ? 'Installing...' : tool.status === 'updating' ? 'Updating...' : tool.status === 'failed' ? 'Failed' : 'Not installed'; },

  render() {
    const c = document.getElementById('tool-status-container');
    if (!c) return;
    c.innerHTML = `
      <div class="tool-status-header"><h3>Tools</h3><button onclick="window.toolStatus.refreshTools()" ${this.state.refreshing ? 'disabled' : ''} class="tool-refresh-btn">${this.state.refreshing ? 'Refreshing...' : 'Refresh'}</button></div>
      <div class="tool-grid">${this.state.tools.map(t => `<div class="tool-card" style="border-left: 4px solid ${this.getStatusColor(t)}"><div class="tool-name">${t.name || t.id}</div><div class="tool-status">${this.getStatusText(t)}</div>${t.progress !== undefined && ['installing', 'updating'].includes(t.status) ? `<div class="tool-progress"><div class="progress-bar" style="width: ${t.progress}%"></div></div>` : ''}<div class="tool-actions">${!t.installed ? `<button onclick="window.toolStatus.act('install','${t.id}')" class="tool-btn tool-btn-primary">Install</button>` : t.hasUpdate ? `<button onclick="window.toolStatus.act('update','${t.id}')" class="tool-btn tool-btn-primary">Update</button>` : `<button onclick="window.toolStatus.refreshTools()" class="tool-btn tool-btn-secondary">Check Updates</button>`}${t.status === 'failed' ? `<button onclick="window.toolStatus.act('install','${t.id}')" class="tool-btn tool-btn-warning">Retry</button>` : ''}${t.error_message ? `<div class="tool-error" title="${t.error_message}">Error: ${t.error_message.substring(0, 30)}...<a href="#" onclick="alert('${t.error_message.replace(/"/g, '\\"')}'); return false;">Details</a></div>` : ''}</div></div>`).join('')}</div>
    `;
    window.toolStatus = this;
  }
};

if (document.readyState === 'loading') { document.addEventListener('DOMContentLoaded', () => ToolStatusComponent.init()); } else { ToolStatusComponent.init(); }
