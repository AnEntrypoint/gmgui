(function() {
  var BASE = window.__BASE_URL || '';
  var btn = document.getElementById('agentAuthBtn');
  var dropdown = document.getElementById('agentAuthDropdown');
  var agents = [], providers = {}, authRunning = false, editingProvider = null;
  var AUTH_CONV_ID = '__agent_auth__';

  function init() {
    if (!btn || !dropdown) return;
    btn.style.display = 'flex';
    btn.addEventListener('click', toggleDropdown);
    document.addEventListener('click', function(e) {
      if (!btn.contains(e.target) && !dropdown.contains(e.target)) closeDropdown();
    });
    window.addEventListener('conversation-selected', function() { refresh(); });
    window.addEventListener('ws-message', onWsMessage);
    refresh();
  }

  function refresh() { fetchAuthStatus(); fetchProviderConfigs(); }

  function fetchAuthStatus() {
    fetch(BASE + '/api/agents/auth-status').then(function(r) { return r.json(); })
      .then(function(data) { agents = data.agents || []; updateButton(); renderDropdown(); })
      .catch(function() {});
  }

  function fetchProviderConfigs() {
    fetch(BASE + '/api/auth/configs').then(function(r) { return r.json(); })
      .then(function(data) { providers = data || {}; updateButton(); renderDropdown(); })
      .catch(function() {});
  }

  function updateButton() {
    btn.style.display = 'flex';
    var agentOk = agents.length === 0 || agents.every(function(a) { return a.authenticated; });
    var pkeys = Object.keys(providers);
    var provOk = pkeys.length === 0 || pkeys.some(function(k) { return providers[k].hasKey; });
    var anyWarn = agents.some(function(a) { return !a.authenticated; }) ||
      pkeys.some(function(k) { return !providers[k].hasKey; });
    btn.classList.toggle('auth-ok', agentOk && provOk && (agents.length > 0 || pkeys.length > 0));
    btn.classList.toggle('auth-warn', anyWarn);
  }

  function renderDropdown() {
    dropdown.innerHTML = '';
    if (agents.length > 0) {
      appendHeader('Agent CLI Auth');
      agents.forEach(function(agent) {
        var dotClass = agent.authenticated ? 'ok' : (agent.detail === 'unknown' ? 'unknown' : 'missing');
        var item = makeItem(dotClass, agent.name, agent.detail);
        item.addEventListener('click', function(e) { e.stopPropagation(); closeDropdown(); triggerAuth(agent.id); });
        dropdown.appendChild(item);
      });
    }
    var pkeys = Object.keys(providers);
    if (pkeys.length > 0) {
      if (agents.length > 0) appendSep();
      appendHeader('Provider Keys');
      pkeys.forEach(function(pid) {
        var p = providers[pid];
        var item = makeItem(p.hasKey ? 'ok' : 'missing', p.name || pid, p.hasKey ? p.apiKey : 'not set');
        item.style.flexWrap = 'wrap';
        item.addEventListener('click', function(e) { e.stopPropagation(); toggleEdit(pid); });
        dropdown.appendChild(item);
        if (editingProvider === pid) dropdown.appendChild(makeEditForm(pid));
      });
    }
  }

  function appendHeader(text) {
    var h = document.createElement('div');
    h.className = 'agent-auth-section-header';
    h.textContent = text;
    dropdown.appendChild(h);
  }

  function appendSep() {
    var s = document.createElement('div');
    s.style.cssText = 'height:1px;background:var(--color-border);margin:0.25rem 0;';
    dropdown.appendChild(s);
  }

  function makeItem(dotClass, name, detail) {
    var el = document.createElement('button');
    el.className = 'agent-auth-item';
    el.innerHTML = '<span class="agent-auth-dot ' + dotClass + '"></span><span>' + esc(name) +
      '</span><span style="margin-left:auto;font-size:0.7rem;color:var(--color-text-secondary)">' + esc(detail) + '</span>';
    return el;
  }

  function makeEditForm(pid) {
    var form = document.createElement('div');
    form.style.cssText = 'width:100%;padding:0.375rem 0.75rem;display:flex;gap:0.375rem;';
    var input = document.createElement('input');
    input.type = 'password'; input.placeholder = 'API key';
    input.style.cssText = 'flex:1;min-width:0;padding:0.25rem 0.5rem;font-size:0.75rem;border:1px solid var(--color-border);border-radius:0.25rem;background:var(--color-bg-primary);color:var(--color-text-primary);outline:none;';
    input.addEventListener('click', function(e) { e.stopPropagation(); });
    var saveBtn = document.createElement('button');
    saveBtn.textContent = 'Save';
    saveBtn.style.cssText = 'padding:0.25rem 0.5rem;font-size:0.7rem;font-weight:600;background:var(--color-primary);color:white;border:none;border-radius:0.25rem;cursor:pointer;flex-shrink:0;';
    saveBtn.addEventListener('click', function(e) {
      e.stopPropagation();
      var key = input.value.trim();
      if (!key) return;
      saveBtn.disabled = true; saveBtn.textContent = '...';
      saveProviderKey(pid, key);
    });
    form.appendChild(input); form.appendChild(saveBtn);
    setTimeout(function() { input.focus(); }, 50);
    return form;
  }

  function toggleEdit(pid) { editingProvider = editingProvider === pid ? null : pid; renderDropdown(); }

  function saveProviderKey(providerId, apiKey) {
    fetch(BASE + '/api/auth/save-config', {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ providerId: providerId, apiKey: apiKey, defaultModel: '' })
    }).then(function(r) { return r.json(); }).then(function(data) {
      if (data.success) { editingProvider = null; fetchProviderConfigs(); }
    }).catch(function() { editingProvider = null; renderDropdown(); });
  }

  function toggleDropdown(e) {
    e.stopPropagation();
    if (!dropdown.classList.contains('open')) { editingProvider = null; refresh(); }
    dropdown.classList.toggle('open');
  }

  function closeDropdown() { dropdown.classList.remove('open'); editingProvider = null; }

  function triggerAuth(agentId) {
    if (authRunning) return;
    fetch(BASE + '/api/agents/' + agentId + '/auth', {
      method: 'POST', headers: { 'Content-Type': 'application/json' }, body: '{}'
    }).then(function(r) { return r.json(); }).then(function(data) {
      if (data.ok) {
        authRunning = true; showTerminalTab(); switchToTerminalView();
        var term = getTerminal();
        if (term) { term.clear(); term.writeln('\x1b[36m[authenticating ' + agentId + ']\x1b[0m\r\n'); }
        if (data.authUrl) {
          window.open(data.authUrl, '_blank');
        }
      }
    }).catch(function() {});
  }

  function onWsMessage(e) {
    var data = e.detail;
    if (!data || data.conversationId !== AUTH_CONV_ID) return;
    if (data.type === 'script_started') {
      authRunning = true; showTerminalTab(); switchToTerminalView();
      var term = getTerminal();
      if (term) { term.clear(); term.writeln('\x1b[36m[authenticating ' + (data.agentId || '') + ']\x1b[0m\r\n'); }
    } else if (data.type === 'script_output') {
      showTerminalTab();
      var term = getTerminal();
      if (term) term.write(data.data);
    } else if (data.type === 'script_stopped') {
      authRunning = false;
      var term = getTerminal();
      var msg = data.error ? data.error : ('exited with code ' + (data.code || 0));
      if (term) term.writeln('\r\n\x1b[90m[auth ' + msg + ']\x1b[0m');
      setTimeout(refresh, 1000);
    }
  }

  function showTerminalTab() { var t = document.getElementById('terminalTabBtn'); if (t) t.style.display = ''; }
  function switchToTerminalView() {
    var bar = document.getElementById('viewToggleBar');
    if (!bar) return;
    var t = bar.querySelector('[data-view="terminal"]'); if (t) t.click();
  }
  function getTerminal() { return window.scriptRunner ? window.scriptRunner.getTerminal() : null; }
  function esc(s) { var d = document.createElement('div'); d.textContent = s; return d.innerHTML; }

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', init);
  else init();
  window.agentAuth = { refresh: refresh };
})();
