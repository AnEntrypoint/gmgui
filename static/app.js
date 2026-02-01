class GMGUIApp {
  constructor() {
    this.agents = new Map();
    this.selectedAgent = null;
    this.conversations = new Map();
    this.currentConversation = null;
    this.polling = new Map();
    this.settings = { autoScroll: true, connectTimeout: 30000 };
    this.init();
  }

  async init() {
    this.loadSettings();
    this.setupEventListeners();
    await this.fetchHome();
    await this.fetchAgents();
    await this.fetchConversations();
    this.renderAll();
  }

  async fetchHome() {
    try {
      const res = await fetch('/api/home');
      if (res.ok) {
        const data = await res.json();
        localStorage.setItem('gmgui-home', data.home);
      }
    } catch (e) {
      console.error('fetchHome:', e);
    }
  }

  loadSettings() {
    const stored = localStorage.getItem('gmgui-settings');
    if (stored) {
      try { this.settings = { ...this.settings, ...JSON.parse(stored) }; } catch (_) {}
    }
    this.applySettings();
  }

  saveSettings() {
    localStorage.setItem('gmgui-settings', JSON.stringify(this.settings));
  }

  applySettings() {
    const el = document.getElementById('autoScroll');
    if (el) el.checked = this.settings.autoScroll;
    const t = document.getElementById('connectTimeout');
    if (t) t.value = this.settings.connectTimeout / 1000;
  }

  expandHome(p) {
    if (!p) return p;
    const home = localStorage.getItem('gmgui-home') || '/config';
    return p.startsWith('~') ? p.replace('~', home) : p;
  }

  setupEventListeners() {
    const input = document.getElementById('messageInput');
    if (input) {
      input.addEventListener('keydown', (e) => {
        if (e.key === 'Enter' && !e.shiftKey) {
          e.preventDefault();
          this.sendMessage();
        }
      });
      input.addEventListener('input', () => this.updateSendButtonState());
    }
    document.getElementById('autoScroll')?.addEventListener('change', (e) => {
      this.settings.autoScroll = e.target.checked;
      this.saveSettings();
    });
    document.getElementById('connectTimeout')?.addEventListener('change', (e) => {
      this.settings.connectTimeout = parseInt(e.target.value) * 1000;
      this.saveSettings();
    });
  }

  async fetchAgents() {
    try {
      const res = await fetch('/api/agents');
      const data = await res.json();
      if (data.agents) {
        data.agents.forEach(a => this.agents.set(a.id, a));
      }
    } catch (e) {
      console.error('fetchAgents:', e);
    }
  }

  async fetchConversations() {
    try {
      const res = await fetch('/api/conversations');
      const data = await res.json();
      if (data.conversations) {
        this.conversations.clear();
        data.conversations.forEach(c => this.conversations.set(c.id, c));
      }
    } catch (e) {
      console.error('fetchConversations:', e);
    }
  }

  async fetchMessages(conversationId) {
    try {
      const res = await fetch(`/api/conversations/${conversationId}/messages`);
      const data = await res.json();
      return data.messages || [];
    } catch (e) {
      console.error('fetchMessages:', e);
      return [];
    }
  }

  renderAll() {
    this.renderAgentCards();
    this.renderChatHistory();
    if (this.currentConversation) {
      this.displayConversation(this.currentConversation);
    }
  }

  renderAgentCards() {
    const container = document.getElementById('agentCards');
    if (!container) return;
    container.innerHTML = '';
    if (this.agents.size === 0) {
      container.innerHTML = '<p style="color: var(--text-tertiary); font-size: 0.875rem;">No agents found. Install claude or opencode.</p>';
      return;
    }
    let first = true;
    this.agents.forEach((agent, id) => {
      if (!first) {
        const sep = document.createElement('span');
        sep.className = 'agent-separator';
        sep.textContent = '|';
        container.appendChild(sep);
      }
      first = false;
      const card = document.createElement('button');
      card.className = `agent-card ${this.selectedAgent === id ? 'active' : ''}`;
      card.onclick = () => this.selectAgent(id);
      card.innerHTML = `
        <span class="agent-card-icon">${escapeHtml(agent.icon || 'A')}</span>
        <span class="agent-card-name">${escapeHtml(agent.name || id)}</span>
      `;
      container.appendChild(card);
    });
  }

  selectAgent(id) {
    this.selectedAgent = id;
    localStorage.setItem('gmgui-selectedAgent', id);
    this.renderAgentCards();
    const welcome = document.querySelector('.welcome-section');
    if (welcome) welcome.style.display = 'none';
    const input = document.getElementById('messageInput');
    if (input) input.focus();
  }

  renderChatHistory() {
    const list = document.getElementById('chatList');
    if (!list) return;
    list.innerHTML = '';
    if (this.conversations.size === 0) {
      list.innerHTML = '<p style="color: var(--text-tertiary); font-size: 0.875rem; padding: 0.5rem;">No chats yet</p>';
      return;
    }
    const sorted = Array.from(this.conversations.values()).sort(
      (a, b) => (b.updated_at || 0) - (a.updated_at || 0)
    );
    sorted.forEach(conv => {
      const item = document.createElement('button');
      item.className = `chat-item ${this.currentConversation === conv.id ? 'active' : ''}`;
      const titleSpan = document.createElement('span');
      titleSpan.className = 'chat-item-title';
      titleSpan.textContent = conv.title || 'Untitled';
      const deleteBtn = document.createElement('button');
      deleteBtn.className = 'chat-item-delete';
      deleteBtn.textContent = 'x';
      deleteBtn.title = 'Delete chat';
      deleteBtn.onclick = (e) => {
        e.stopPropagation();
        this.deleteConversation(conv.id);
      };
      item.appendChild(titleSpan);
      item.appendChild(deleteBtn);
      item.onclick = () => this.displayConversation(conv.id);
      list.appendChild(item);
    });
  }

  async deleteConversation(id) {
    this.conversations.delete(id);
    if (this.currentConversation === id) {
      this.currentConversation = null;
      const first = Array.from(this.conversations.values())[0];
      if (first) {
        this.displayConversation(first.id);
      } else {
        this.showWelcome();
      }
    }
    this.renderChatHistory();
  }

  showWelcome() {
    const div = document.getElementById('chatMessages');
    if (!div) return;
    div.innerHTML = `
      <div class="welcome-section">
        <h2>Hi, what's your plan for today?</h2>
        <div class="agent-selection">
          <div id="agentCards" class="agent-cards"></div>
        </div>
      </div>
    `;
    this.renderAgentCards();
  }

  async displayConversation(id) {
    this.currentConversation = id;
    const conv = this.conversations.get(id);
    if (!conv) return;
    if (conv.agentId && !this.selectedAgent) {
      this.selectedAgent = conv.agentId;
    }
    const messages = await this.fetchMessages(id);
    const div = document.getElementById('chatMessages');
    if (!div) return;
    div.innerHTML = '';
    if (messages.length === 0 && !this.selectedAgent) {
      div.innerHTML = `
        <div class="welcome-section">
          <h2>Hi, what's your plan for today?</h2>
          <div class="agent-selection">
            <div id="agentCards" class="agent-cards"></div>
          </div>
        </div>
      `;
      this.renderAgentCards();
    } else {
      messages.forEach(msg => this.addMessageToDisplay(msg));
      if (this.settings.autoScroll) {
        div.scrollTop = div.scrollHeight;
      }
    }
    this.renderChatHistory();
    this.renderAgentCards();
  }

  addMessageToDisplay(msg) {
    const div = document.getElementById('chatMessages');
    if (!div) return;
    const el = document.createElement('div');
    el.className = `message ${msg.role}`;
    const bubble = document.createElement('div');
    bubble.className = 'message-bubble';
    bubble.textContent = typeof msg.content === 'string' ? msg.content : JSON.stringify(msg.content);
    el.appendChild(bubble);
    div.appendChild(el);
  }

  async startNewChat(folderPath) {
    if (!this.selectedAgent) {
      const firstAgent = Array.from(this.agents.keys())[0];
      if (firstAgent) {
        this.selectedAgent = firstAgent;
      }
    }
    const title = folderPath
      ? folderPath.split('/').pop() || folderPath
      : `Chat ${this.conversations.size + 1}`;
    try {
      const res = await fetch('/api/conversations', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ agentId: this.selectedAgent || 'claude-code', title }),
      });
      const data = await res.json();
      if (data.conversation) {
        const conv = data.conversation;
        if (folderPath) conv.folderPath = folderPath;
        this.conversations.set(conv.id, conv);
        this.currentConversation = conv.id;
        this.renderChatHistory();
        this.displayConversation(conv.id);
      }
    } catch (e) {
      console.error('startNewChat:', e);
    }
  }

  async sendMessage() {
    const input = document.getElementById('messageInput');
    const message = input.value.trim();
    if (!message) return;
    if (!this.selectedAgent) {
      this.addSystemMessage('Please select an agent first');
      return;
    }
    if (!this.currentConversation) {
      await this.startNewChat();
    }
    if (!this.currentConversation) return;
    const conv = this.conversations.get(this.currentConversation);
    this.addMessageToDisplay({ role: 'user', content: message });
    input.value = '';
    this.updateSendButtonState();
    const processingEl = this.addProcessingIndicator();
    try {
      const folderPath = conv?.folderPath || localStorage.getItem('gmgui-home') || '/config';
      const res = await fetch(`/api/conversations/${this.currentConversation}/messages`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          content: message,
          agentId: this.selectedAgent,
          folderContext: { path: folderPath, isFolder: true },
        }),
      });
      if (!res.ok) {
        const err = await res.json();
        processingEl.remove();
        this.addMessageToDisplay({ role: 'system', content: `Error: ${err.error || 'Request failed'}` });
        return;
      }
      const data = await res.json();
      if (data.session) {
        this.pollSession(data.session.id, this.currentConversation, processingEl);
      } else {
        processingEl.remove();
      }
    } catch (e) {
      processingEl.remove();
      this.addMessageToDisplay({ role: 'system', content: `Error: ${e.message}` });
    }
    if (this.settings.autoScroll) {
      const div = document.getElementById('chatMessages');
      if (div) div.scrollTop = div.scrollHeight;
    }
  }

  addProcessingIndicator() {
    const div = document.getElementById('chatMessages');
    if (!div) return document.createElement('div');
    const el = document.createElement('div');
    el.className = 'message system';
    const bubble = document.createElement('div');
    bubble.className = 'message-bubble';
    bubble.textContent = `Processing with ${this.selectedAgent}...`;
    el.appendChild(bubble);
    div.appendChild(el);
    if (this.settings.autoScroll) div.scrollTop = div.scrollHeight;
    return el;
  }

  addSystemMessage(text) {
    this.addMessageToDisplay({ role: 'system', content: text });
  }

  async pollSession(sessionId, conversationId, processingEl) {
    if (this.polling.has(sessionId)) return;
    this.polling.set(sessionId, true);
    let attempts = 0;
    const maxAttempts = 600;
    const poll = async () => {
      if (!this.polling.has(sessionId)) return;
      try {
        const res = await fetch(`/api/sessions/${sessionId}`);
        if (!res.ok) {
          this.polling.delete(sessionId);
          processingEl.remove();
          this.addMessageToDisplay({ role: 'system', content: 'Session not found' });
          return;
        }
        const data = await res.json();
        const session = data.session;
        if (session.status === 'completed') {
          this.polling.delete(sessionId);
          processingEl.remove();
          const messages = await this.fetchMessages(conversationId);
          const lastAssistant = messages.filter(m => m.role === 'assistant').pop();
          if (lastAssistant) {
            const content = lastAssistant.content;
            let text = content;
            try {
              const parsed = JSON.parse(content);
              text = this.extractACPResponse(parsed);
            } catch (_) {}
            this.addMessageToDisplay({ role: 'assistant', content: text });
          }
          if (this.settings.autoScroll) {
            const div = document.getElementById('chatMessages');
            if (div) div.scrollTop = div.scrollHeight;
          }
          return;
        }
        if (session.status === 'error') {
          this.polling.delete(sessionId);
          processingEl.remove();
          this.addMessageToDisplay({ role: 'system', content: `Error: ${session.error || 'Unknown error'}` });
          return;
        }
        attempts++;
        if (attempts < maxAttempts) {
          setTimeout(poll, 500);
        } else {
          this.polling.delete(sessionId);
          processingEl.remove();
          this.addMessageToDisplay({ role: 'system', content: 'Session timed out' });
        }
      } catch (e) {
        attempts++;
        if (attempts < maxAttempts) {
          setTimeout(poll, 1000);
        } else {
          this.polling.delete(sessionId);
          processingEl.remove();
          this.addMessageToDisplay({ role: 'system', content: `Poll error: ${e.message}` });
        }
      }
    };
    poll();
  }

  extractACPResponse(response) {
    if (!response) return '';
    let text = '';
    if (response.updates && Array.isArray(response.updates)) {
      for (const update of response.updates) {
        if (update.textDelta) text += update.textDelta;
        else if (update.content && typeof update.content === 'string') text += update.content;
      }
    }
    if (response.stopReason) {
      if (text) text += `\n\n[Completed: ${response.stopReason}]`;
      else text = `Operation completed: ${response.stopReason}`;
    }
    if (!text && typeof response === 'object') {
      text = JSON.stringify(response);
    }
    return text.trim();
  }

  updateSendButtonState() {
    const input = document.getElementById('messageInput');
    const btn = document.getElementById('sendBtn');
    if (btn) btn.disabled = !input || !input.value.trim();
  }

  openFolderBrowser() {
    const modal = document.getElementById('folderBrowserModal');
    if (!modal) return;
    const pathInput = document.getElementById('folderPath');
    pathInput.value = '~/';
    this.loadFolderContents(this.expandHome('~/'));
    modal.classList.add('active');
  }

  closeFolderBrowser() {
    const modal = document.getElementById('folderBrowserModal');
    if (modal) modal.classList.remove('active');
  }

  async loadFolderContents(folderPath) {
    const list = document.getElementById('folderBrowserList');
    if (!list) return;
    list.innerHTML = '<div style="padding: 1rem; color: var(--text-tertiary);">Loading...</div>';
    try {
      const res = await fetch('/api/folders', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ path: folderPath }),
      });
      if (res.ok) {
        const data = await res.json();
        this.renderFolderList(data.folders, folderPath);
      } else {
        list.innerHTML = '<div style="padding: 1rem; color: var(--color-danger);">Error loading folder</div>';
      }
    } catch (e) {
      list.innerHTML = '<div style="padding: 1rem; color: var(--color-danger);">Error: ' + e.message + '</div>';
    }
  }

  renderFolderList(folders, currentPath) {
    const list = document.getElementById('folderBrowserList');
    if (!list) return;
    list.innerHTML = '';
    if (currentPath !== '/' && currentPath !== '/root') {
      const parentPath = currentPath.substring(0, currentPath.lastIndexOf('/')) || '/';
      const parentItem = document.createElement('div');
      parentItem.className = 'folder-item';
      parentItem.style.cssText = 'padding: 0.75rem 1rem; cursor: pointer; display: flex; align-items: center; gap: 0.75rem; border-bottom: 1px solid var(--border-color);';
      parentItem.innerHTML = '<span>../</span>';
      parentItem.onclick = () => {
        document.getElementById('folderPath').value = parentPath;
        this.loadFolderContents(parentPath);
      };
      list.appendChild(parentItem);
    }
    if (!folders || folders.length === 0) {
      const empty = document.createElement('div');
      empty.style.cssText = 'padding: 1rem; color: var(--text-tertiary); text-align: center;';
      empty.textContent = 'No subfolders found';
      list.appendChild(empty);
      return;
    }
    folders.forEach(folder => {
      const item = document.createElement('div');
      item.style.cssText = 'padding: 0.75rem 1rem; cursor: pointer; display: flex; align-items: center; gap: 0.75rem; border-bottom: 1px solid var(--border-color);';
      item.textContent = folder.name;
      item.onclick = () => {
        const newPath = currentPath === '/' ? '/' + folder.name : currentPath + '/' + folder.name;
        document.getElementById('folderPath').value = newPath;
        this.loadFolderContents(newPath);
      };
      list.appendChild(item);
    });
  }
}

function escapeHtml(text) {
  const div = document.createElement('div');
  div.textContent = text;
  return div.innerHTML;
}

function showNewChatModal() {
  const modal = document.getElementById('newChatModal');
  if (modal) modal.classList.add('active');
}

function closeNewChatModal() {
  const modal = document.getElementById('newChatModal');
  if (modal) modal.classList.remove('active');
}

function createChatInWorkspace() {
  closeNewChatModal();
  app.startNewChat();
}

function createChatInFolder() {
  closeNewChatModal();
  app.openFolderBrowser();
}

function sendMessage() { app.sendMessage(); }

function toggleSidebar() {
  const sidebar = document.getElementById('sidebar');
  if (sidebar) sidebar.classList.toggle('open');
}

function switchTab(tabName) {
  const panel = document.getElementById('settingsPanel');
  const main = document.querySelector('.main-content');
  if (tabName === 'settings' && panel && main) {
    panel.style.display = 'flex';
    main.style.display = 'none';
  } else if (tabName === 'chat' && panel && main) {
    panel.style.display = 'none';
    main.style.display = 'flex';
  }
}

function closeFolderBrowser() { app.closeFolderBrowser(); }

function browseFolders() {
  const pathInput = document.getElementById('folderPath');
  const p = pathInput.value.trim() || '~/';
  app.loadFolderContents(app.expandHome(p));
}

function confirmFolderSelection() {
  const pathInput = document.getElementById('folderPath');
  const p = pathInput.value.trim();
  if (!p) return;
  app.startNewChat(app.expandHome(p));
  app.closeFolderBrowser();
}

const app = new GMGUIApp();
window._app = app;
