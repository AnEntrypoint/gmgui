/**
 * Conversations Module
 * Manages conversation list sidebar with real-time updates
 * Includes folder browser for selecting working directory on new conversation
 */

class ConversationManager {
  constructor() {
    this.conversations = [];
    this.activeId = null;
    this.listEl = document.querySelector('[data-conversation-list]');
    this.emptyEl = document.querySelector('[data-conversation-empty]');
    this.newBtn = document.querySelector('[data-new-conversation]');
    this.sidebarEl = document.querySelector('[data-sidebar]');

    this.folderBrowser = {
      modal: null,
      listEl: null,
      breadcrumbEl: null,
      currentPath: '~',
      homePath: '~'
    };

    if (!this.listEl) return;

    this.init();
  }

  async init() {
    this.newBtn?.addEventListener('click', () => this.openFolderBrowser());
    this.loadConversations();
    this.setupWebSocketListener();
    this.setupFolderBrowser();

    setInterval(() => this.loadConversations(), 30000);
  }

  setupFolderBrowser() {
    this.folderBrowser.modal = document.getElementById('folderBrowserModal');
    this.folderBrowser.listEl = document.getElementById('folderList');
    this.folderBrowser.breadcrumbEl = document.getElementById('folderBreadcrumb');

    if (!this.folderBrowser.modal) return;

    const closeBtn = this.folderBrowser.modal.querySelector('[data-folder-close]');
    const cancelBtn = this.folderBrowser.modal.querySelector('[data-folder-cancel]');
    const selectBtn = this.folderBrowser.modal.querySelector('[data-folder-select]');

    closeBtn?.addEventListener('click', () => this.closeFolderBrowser());
    cancelBtn?.addEventListener('click', () => this.closeFolderBrowser());
    selectBtn?.addEventListener('click', () => this.confirmFolderSelection());

    this.folderBrowser.modal.addEventListener('click', (e) => {
      if (e.target === this.folderBrowser.modal) this.closeFolderBrowser();
    });

    this.fetchHomePath();
  }

  async fetchHomePath() {
    try {
      const res = await fetch((window.__BASE_URL || '') + '/api/home');
      if (res.ok) {
        const data = await res.json();
        this.folderBrowser.homePath = data.home || '~';
      }
    } catch (e) {
      console.error('Failed to fetch home path:', e);
    }
  }

  openFolderBrowser() {
    if (!this.folderBrowser.modal) {
      this.createNew();
      return;
    }
    this.folderBrowser.currentPath = '~';
    this.folderBrowser.modal.classList.add('visible');
    this.loadFolders('~');
  }

  closeFolderBrowser() {
    this.folderBrowser.modal?.classList.remove('visible');
  }

  async loadFolders(dirPath) {
    this.folderBrowser.currentPath = dirPath;
    this.renderBreadcrumb(dirPath);

    if (!this.folderBrowser.listEl) return;
    this.folderBrowser.listEl.innerHTML = '<li class="folder-list-loading">Loading...</li>';

    try {
      const res = await fetch((window.__BASE_URL || '') + '/api/folders', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ path: dirPath })
      });

      if (!res.ok) {
        const errData = await res.json().catch(() => ({}));
        throw new Error(errData.error || `HTTP ${res.status}`);
      }

      const data = await res.json();
      const folders = data.folders || [];

      this.folderBrowser.listEl.innerHTML = '';

      if (dirPath !== '~' && dirPath !== '/' && dirPath !== this.folderBrowser.homePath) {
        const parentPath = this.getParentPath(dirPath);
        const upItem = document.createElement('li');
        upItem.className = 'folder-list-item';
        upItem.innerHTML = '<span class="folder-list-item-icon">..</span><span class="folder-list-item-name">Parent Directory</span>';
        upItem.addEventListener('click', () => this.loadFolders(parentPath));
        this.folderBrowser.listEl.appendChild(upItem);
      }

      if (folders.length === 0 && this.folderBrowser.listEl.children.length === 0) {
        this.folderBrowser.listEl.innerHTML = '<li class="folder-list-empty">No subdirectories</li>';
        return;
      }

      for (const folder of folders) {
        const li = document.createElement('li');
        li.className = 'folder-list-item';
        li.innerHTML = `<span class="folder-list-item-icon">&#128193;</span><span class="folder-list-item-name">${this.escapeHtml(folder.name)}</span>`;
        li.addEventListener('click', () => {
          const expandedBase = dirPath === '~' ? this.folderBrowser.homePath : dirPath;
          const newPath = expandedBase + '/' + folder.name;
          this.loadFolders(newPath);
        });
        this.folderBrowser.listEl.appendChild(li);
      }
    } catch (err) {
      console.error('Failed to load folders:', err);
      this.folderBrowser.listEl.innerHTML = `<li class="folder-list-error">Error: ${this.escapeHtml(err.message)}</li>`;
    }
  }

  getParentPath(dirPath) {
    const expanded = dirPath === '~' ? this.folderBrowser.homePath : dirPath;
    const parts = expanded.split('/').filter(Boolean);
    if (parts.length <= 1) return '/';
    parts.pop();
    return '/' + parts.join('/');
  }

  renderBreadcrumb(dirPath) {
    if (!this.folderBrowser.breadcrumbEl) return;

    const expanded = dirPath === '~' ? this.folderBrowser.homePath : dirPath;
    const parts = expanded.split('/').filter(Boolean);

    let html = '';
    html += '<span class="folder-breadcrumb-segment" data-path="/">/ </span>';

    let accumulated = '';
    for (let i = 0; i < parts.length; i++) {
      accumulated += '/' + parts[i];
      const isLast = i === parts.length - 1;
      html += '<span class="folder-breadcrumb-separator">/</span>';
      html += `<span class="folder-breadcrumb-segment${isLast ? '' : ''}" data-path="${this.escapeHtml(accumulated)}">${this.escapeHtml(parts[i])}</span>`;
    }

    this.folderBrowser.breadcrumbEl.innerHTML = html;

    this.folderBrowser.breadcrumbEl.querySelectorAll('.folder-breadcrumb-segment').forEach(seg => {
      seg.addEventListener('click', () => {
        const p = seg.dataset.path;
        if (p) this.loadFolders(p);
      });
    });
  }

  confirmFolderSelection() {
    const currentPath = this.folderBrowser.currentPath;
    const expanded = currentPath === '~' ? this.folderBrowser.homePath : currentPath;
    this.closeFolderBrowser();

    const dirName = expanded.split('/').filter(Boolean).pop() || 'root';
    window.dispatchEvent(new CustomEvent('create-new-conversation', {
      detail: { workingDirectory: expanded, title: dirName }
    }));
  }

  async loadConversations() {
    try {
      const res = await fetch((window.__BASE_URL || '') + '/api/conversations');
      if (!res.ok) throw new Error(`HTTP ${res.status}`);

      const data = await res.json();
      this.conversations = data.conversations || [];
      this.render();
    } catch (err) {
      console.error('Failed to load conversations:', err);
      this.showEmpty('Failed to load conversations');
    }
  }

  render() {
    if (!this.listEl) return;

    if (this.conversations.length === 0) {
      this.showEmpty();
      return;
    }

    this.listEl.innerHTML = '';
    this.emptyEl.style.display = 'none';

    const sorted = [...this.conversations].sort((a, b) =>
      new Date(b.createdAt || 0) - new Date(a.createdAt || 0)
    );

    sorted.forEach(conv => {
      const item = this.createConversationItem(conv);
      this.listEl.appendChild(item);
    });
  }

  createConversationItem(conv) {
    const li = document.createElement('li');
    li.className = 'conversation-item';
    li.dataset.convId = conv.id;
    if (conv.id === this.activeId) li.classList.add('active');

    const title = conv.title || `Conversation ${conv.id.slice(0, 8)}`;
    const timestamp = conv.created_at ? new Date(conv.created_at).toLocaleDateString() : 'Unknown';
    const agent = conv.agentType || 'unknown';
    const wd = conv.workingDirectory ? conv.workingDirectory.split('/').pop() : '';
    const metaParts = [agent, timestamp];
    if (wd) metaParts.push(wd);

    li.innerHTML = `
      <div class="conversation-item-title">${this.escapeHtml(title)}</div>
      <div class="conversation-item-meta">${metaParts.join(' \u2022 ')}</div>
    `;

    li.addEventListener('click', () => this.select(conv.id));
    return li;
  }

  select(convId) {
    this.activeId = convId;

    document.querySelectorAll('.conversation-item').forEach(item => {
      item.classList.remove('active');
    });

    const active = document.querySelector(`[data-conv-id="${convId}"]`);
    if (active) active.classList.add('active');

    window.dispatchEvent(new CustomEvent('conversation-selected', {
      detail: { conversationId: convId }
    }));
  }

  createNew() {
    window.dispatchEvent(new CustomEvent('create-new-conversation'));
  }

  showEmpty(message = 'No conversations yet') {
    if (!this.listEl) return;
    this.listEl.innerHTML = '';
    this.emptyEl.textContent = message;
    this.emptyEl.style.display = 'block';
  }

  addConversation(conv) {
    this.conversations.unshift(conv);
    this.render();
  }

  updateConversation(convId, updates) {
    const conv = this.conversations.find(c => c.id === convId);
    if (conv) {
      Object.assign(conv, updates);
      this.render();
    }
  }

  deleteConversation(convId) {
    this.conversations = this.conversations.filter(c => c.id !== convId);
    if (this.activeId === convId) this.activeId = null;
    this.render();
  }

  setupWebSocketListener() {
    window.addEventListener('ws-message', (event) => {
      const msg = event.detail;

      if (msg.type === 'conversation_created') {
        this.addConversation(msg.conversation);
      } else if (msg.type === 'conversation_updated') {
        this.updateConversation(msg.conversation.id, msg.conversation);
      } else if (msg.type === 'conversation_deleted') {
        this.deleteConversation(msg.conversationId);
      }
    });
  }

  escapeHtml(text) {
    const map = { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' };
    return text.replace(/[&<>"']/g, c => map[c]);
  }
}

if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', () => {
    window.conversationManager = new ConversationManager();
  });
} else {
  window.conversationManager = new ConversationManager();
}
