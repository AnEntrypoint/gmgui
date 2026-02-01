// Multi-agent ACP client with WebSocket + MessagePack
class GMGUIApp {
  constructor() {
    this.agents = new Map();
    this.selectedAgent = null;
    this.messageHistory = [];
    this.connections = new Map();
    this.settings = {
      messageFormat: 'msgpackr',
      autoScroll: true,
      connectTimeout: 30000,
    };

    this.init();
  }

  async init() {
    this.loadSettings();
    this.setupEventListeners();
    this.fetchAgents();
    this.setupWebSocketListener();
  }

  loadSettings() {
    const stored = localStorage.getItem('gmgui-settings');
    if (stored) {
      this.settings = { ...this.settings, ...JSON.parse(stored) };
    }
    this.applySettings();
  }

  saveSettings() {
    localStorage.setItem('gmgui-settings', JSON.stringify(this.settings));
  }

  applySettings() {
    document.getElementById('messageFormat').value = this.settings.messageFormat;
    document.getElementById('autoScroll').checked = this.settings.autoScroll;
    document.getElementById('connectTimeout').value = this.settings.connectTimeout / 1000;
  }

  setupEventListeners() {
    // Message input
    document.getElementById('messageInput').addEventListener('keydown', (e) => {
      if (e.key === 'Enter' && !e.shiftKey) {
        e.preventDefault();
        this.sendMessage();
      }
    });

    // Settings changes
    document.getElementById('messageFormat').addEventListener('change', (e) => {
      this.settings.messageFormat = e.target.value;
      this.saveSettings();
    });

    document.getElementById('autoScroll').addEventListener('change', (e) => {
      this.settings.autoScroll = e.target.checked;
      this.saveSettings();
    });

    document.getElementById('connectTimeout').addEventListener('change', (e) => {
      this.settings.connectTimeout = parseInt(e.target.value) * 1000;
      this.saveSettings();
    });
  }

  async fetchAgents() {
    try {
      const response = await fetch('/api/agents');
      const data = await response.json();
      
      if (data.agents) {
        data.agents.forEach(agent => {
          this.agents.set(agent.id, agent);
        });
        this.renderAgentsList();
      }
    } catch (error) {
      this.logMessage('error', 'Failed to fetch agents list', error.message);
    }
  }

  renderAgentsList() {
    const list = document.getElementById('agentsList');
    list.innerHTML = '';

    if (this.agents.size === 0) {
      list.innerHTML = '<p style="color: #9ca3af; font-size: 0.875rem;">No agents connected</p>';
      return;
    }

    this.agents.forEach((agent, id) => {
      const item = document.createElement('div');
      item.className = `agent-item ${this.selectedAgent === id ? 'active' : ''}`;
      
      const statusClass = agent.status === 'connected' ? 'connected' : 'disconnected';
      
      item.innerHTML = `
        <div class="agent-item-header">
          <span class="agent-id">${agent.id}</span>
          <span class="agent-status ${statusClass}">${agent.status}</span>
        </div>
        <div class="agent-endpoint">${agent.endpoint}</div>
        <div class="agent-actions">
          <button onclick="app.selectAgent('${agent.id}')">Select</button>
          <button onclick="app.disconnectAgent('${agent.id}')">Disconnect</button>
        </div>
      `;
      
      list.appendChild(item);
    });
  }

  selectAgent(id) {
    this.selectedAgent = id;
    this.renderAgentsList();
    this.logMessage('info', `Selected agent: ${id}`);
  }

  async connectAgent(id, endpoint) {
    try {
      this.logMessage('info', `Connecting to ${id}...`);
      
      const wsUrl = `ws://${window.location.host}/agent/${id}`;
      const ws = new WebSocket(wsUrl);
      
      ws.binaryType = 'arraybuffer';

      const timeout = setTimeout(() => {
        ws.close();
        this.logMessage('error', `Connection timeout for ${id}`);
      }, this.settings.connectTimeout);

      ws.onopen = () => {
        clearTimeout(timeout);
        this.connections.set(id, ws);
        const agent = this.agents.get(id) || { id, endpoint, status: 'connected' };
        agent.status = 'connected';
        this.agents.set(id, agent);
        this.renderAgentsList();
        this.logMessage('success', `Connected to ${id}`);
      };

      ws.onmessage = (event) => {
        this.handleAgentMessage(id, event.data);
      };

      ws.onerror = (error) => {
        clearTimeout(timeout);
        this.logMessage('error', `Connection error for ${id}`, error.message);
      };

      ws.onclose = () => {
        clearTimeout(timeout);
        this.connections.delete(id);
        const agent = this.agents.get(id);
        if (agent) {
          agent.status = 'disconnected';
        }
        this.renderAgentsList();
        this.logMessage('warning', `Disconnected from ${id}`);
      };
    } catch (error) {
      this.logMessage('error', `Failed to connect to ${id}`, error.message);
    }
  }

  handleAgentMessage(agentId, data) {
    try {
      let message;
      
      if (this.settings.messageFormat === 'msgpackr') {
        // For now, log raw data if msgpackr is used
        message = `[Binary Data from ${agentId}]`;
      } else {
        message = typeof data === 'string' ? JSON.parse(data) : data;
      }

      const agent = this.agents.get(agentId);
      if (agent) {
        agent.lastMessage = message;
        this.agents.set(agentId, agent);
      }

      this.messageHistory.push({
        agentId,
        message,
        timestamp: Date.now(),
      });

      this.logMessage('info', `Message from ${agentId}`, 
        typeof message === 'string' ? message : JSON.stringify(message, null, 2)
      );
    } catch (error) {
      this.logMessage('error', `Failed to process message from ${agentId}`, error.message);
    }
  }

  setupWebSocketListener() {
    const wsUrl = `ws://${window.location.host}`;
    const ws = new WebSocket(wsUrl);

    ws.onmessage = (event) => {
      try {
        const data = JSON.parse(event.data);
        
        if (data.type === 'agent:connected') {
          const agent = data.agent;
          this.agents.set(agent.id, agent);
          this.renderAgentsList();
          this.logMessage('success', `Agent connected: ${agent.id}`);
        } else if (data.type === 'agent:disconnected') {
          const agent = this.agents.get(data.agentId);
          if (agent) {
            agent.status = 'disconnected';
            this.agents.set(data.agentId, agent);
          }
          this.renderAgentsList();
          this.logMessage('warning', `Agent disconnected: ${data.agentId}`);
        } else if (data.type === 'agent:message') {
          this.handleAgentMessage(data.agentId, data);
        }
      } catch (e) {
        console.error('WebSocket message error:', e);
      }
    };

    ws.onerror = (error) => {
      console.error('WebSocket error:', error);
    };
  }

  async sendMessage() {
    const input = document.getElementById('messageInput');
    const message = input.value.trim();

    if (!message) return;
    if (!this.selectedAgent) {
      this.logMessage('error', 'Please select an agent first');
      return;
    }

    try {
      const payload = {
        type: 'message',
        content: message,
        timestamp: Date.now(),
      };

      const response = await fetch(`/api/agents/${this.selectedAgent}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
      });

      if (response.ok) {
        this.logMessage('info', `Sent to ${this.selectedAgent}`, message);
        input.value = '';
      } else {
        const error = await response.json();
        this.logMessage('error', 'Send failed', error.error);
      }
    } catch (error) {
      this.logMessage('error', 'Send error', error.message);
    }
  }

  logMessage(type, title, content = '') {
    const output = document.getElementById('consoleOutput');
    const msg = document.createElement('div');
    msg.className = `console-message ${type}`;

    const time = new Date().toLocaleTimeString();
    const contentHtml = content ? `<div class="console-text">${escapeHtml(content)}</div>` : '';

    msg.innerHTML = `
      <div class="console-timestamp">${time}</div>
      <div><span class="console-agent-id">${escapeHtml(title)}</span></div>
      ${contentHtml}
    `;

    output.appendChild(msg);

    if (this.settings.autoScroll) {
      output.scrollTop = output.scrollHeight;
    }
  }

  clearConsole() {
    document.getElementById('consoleOutput').innerHTML = '';
    this.messageHistory = [];
  }

  disconnectAgent(id) {
    const ws = this.connections.get(id);
    if (ws) {
      ws.close();
      this.connections.delete(id);
    }
    this.agents.delete(id);
    this.renderAgentsList();
    this.logMessage('warning', `Disconnected from ${id}`);
  }
}

// Global helper functions
function escapeHtml(text) {
  const div = document.createElement('div');
  div.textContent = text;
  return div.innerHTML;
}

function addAgent() {
  const id = document.getElementById('agentId').value.trim();
  const endpoint = document.getElementById('agentEndpoint').value.trim();

  if (!id || !endpoint) {
    alert('Please enter both Agent ID and Endpoint');
    return;
  }

  app.agents.set(id, { id, endpoint, status: 'disconnected' });
  app.connectAgent(id, endpoint);
  
  document.getElementById('agentId').value = '';
  document.getElementById('agentEndpoint').value = '';
}

function sendMessage() {
  app.sendMessage();
}

function clearConsole() {
  app.clearConsole();
}

function switchTab(tabName) {
  document.querySelectorAll('.tab-content').forEach(el => el.classList.remove('active'));
  document.querySelectorAll('.tab-btn').forEach(el => el.classList.remove('active'));
  
  document.getElementById(tabName).classList.add('active');
  document.querySelector(`[data-tab="${tabName}"]`).classList.add('active');
}

// Initialize app
const app = new GMGUIApp();
