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

  var oauthPollInterval = null, oauthPollTimeout = null, oauthFallbackTimer = null;

  function cleanupOAuthPolling() {
    if (oauthPollInterval) { clearInterval(oauthPollInterval); oauthPollInterval = null; }
    if (oauthPollTimeout) { clearTimeout(oauthPollTimeout); oauthPollTimeout = null; }
    if (oauthFallbackTimer) { clearTimeout(oauthFallbackTimer); oauthFallbackTimer = null; }
  }

  function showOAuthWaitingModal() {
    removeOAuthModal();
    var overlay = document.createElement('div');
    overlay.id = 'oauthWaitingModal';
    overlay.style.cssText = 'position:fixed;inset:0;background:rgba(0,0,0,0.7);display:flex;align-items:center;justify-content:center;z-index:9999;';
    overlay.innerHTML = '<div style="background:var(--color-bg-secondary,#1f2937);border-radius:1rem;padding:2rem;max-width:28rem;width:calc(100% - 2rem);box-shadow:0 25px 50px rgba(0,0,0,0.5);color:var(--color-text-primary,white);font-family:system-ui,sans-serif;" onclick="event.stopPropagation()">' +
      '<div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:1rem;">' +
      '<h2 style="font-size:1.125rem;font-weight:700;margin:0;">Google Sign-In</h2>' +
      '<button id="oauthWaitingClose" style="background:none;border:none;color:var(--color-text-secondary,#9ca3af);font-size:1.5rem;cursor:pointer;padding:0;line-height:1;">\u00d7</button></div>' +
      '<div id="oauthWaitingContent" style="text-align:center;padding:1.5rem 0;">' +
      '<div style="font-size:2rem;margin-bottom:1rem;animation:pulse 2s infinite;">&#9203;</div>' +
      '<p style="font-size:0.85rem;color:var(--color-text-secondary,#d1d5db);margin:0 0 0.5rem;">Waiting for Google sign-in to complete...</p>' +
      '<p style="font-size:0.75rem;color:var(--color-text-secondary,#6b7280);margin:0;">Complete the sign-in in the tab that just opened.</p>' +
      '<p style="font-size:0.75rem;color:var(--color-text-secondary,#6b7280);margin:0.25rem 0 0;">This dialog will close automatically when done.</p></div>' +
      '<div id="oauthPasteFallback" style="display:none;">' +
      '<div style="margin-bottom:1rem;padding:1rem;background:var(--color-bg-tertiary,rgba(255,255,255,0.05));border-radius:0.5rem;">' +
      '<p style="font-size:0.8rem;color:var(--color-text-secondary,#d1d5db);margin:0 0 0.5rem;">The automatic relay did not complete. This can happen when accessing the server remotely.</p>' +
      '<p style="font-size:0.8rem;color:var(--color-text-secondary,#d1d5db);margin:0;">Copy the <span style="color:white;font-weight:600;">entire URL</span> from the sign-in tab and paste it below.</p></div>' +
      '<input type="text" id="oauthPasteInput" placeholder="http://localhost:3000/gm/oauth2callback?code=..." style="width:100%;box-sizing:border-box;padding:0.75rem 1rem;background:var(--color-bg-primary,#374151);border:1px solid var(--color-border,#4b5563);border-radius:0.5rem;color:var(--color-text-primary,white);font-size:0.8rem;font-family:monospace;outline:none;" />' +
      '<p id="oauthPasteError" style="font-size:0.75rem;color:#ef4444;margin:0.5rem 0 0;display:none;"></p></div>' +
      '<div style="display:flex;gap:0.75rem;margin-top:1.25rem;">' +
      '<button id="oauthWaitingCancel" style="flex:1;padding:0.625rem;border-radius:0.5rem;border:1px solid var(--color-border,#4b5563);background:transparent;color:var(--color-text-primary,white);font-size:0.8rem;cursor:pointer;font-weight:600;">Cancel</button>' +
      '<button id="oauthPasteSubmit" style="flex:1;padding:0.625rem;border-radius:0.5rem;border:none;background:var(--color-primary,#3b82f6);color:white;font-size:0.8rem;cursor:pointer;font-weight:600;display:none;">Complete Sign-In</button></div>' +
      '<style>@keyframes pulse{0%,100%{opacity:1}50%{opacity:0.5}}</style></div>';
    document.body.appendChild(overlay);
    var dismiss = function() { cleanupOAuthPolling(); authRunning = false; removeOAuthModal(); };
    document.getElementById('oauthWaitingClose').addEventListener('click', dismiss);
    document.getElementById('oauthWaitingCancel').addEventListener('click', dismiss);
    document.getElementById('oauthPasteSubmit').addEventListener('click', submitOAuthPasteUrl);
  }

  function showOAuthPasteFallback() {
    var fallback = document.getElementById('oauthPasteFallback');
    var waitContent = document.getElementById('oauthWaitingContent');
    var submitBtn = document.getElementById('oauthPasteSubmit');
    if (fallback) fallback.style.display = 'block';
    if (waitContent) waitContent.style.display = 'none';
    if (submitBtn) submitBtn.style.display = 'block';
    var input = document.getElementById('oauthPasteInput');
    if (input) {
      input.addEventListener('keydown', function(e) { if (e.key === 'Enter') submitOAuthPasteUrl(); });
      setTimeout(function() { input.focus(); }, 100);
    }
  }

  function removeOAuthModal() {
    var el = document.getElementById('oauthWaitingModal');
    if (el) el.remove();
  }

  function submitOAuthPasteUrl() {
    var input = document.getElementById('oauthPasteInput');
    var errorEl = document.getElementById('oauthPasteError');
    var submitBtn = document.getElementById('oauthPasteSubmit');
    if (!input) return;
    var url = input.value.trim();
    if (!url) {
      if (errorEl) { errorEl.textContent = 'Please paste the URL from the redirected page.'; errorEl.style.display = 'block'; }
      return;
    }
    if (submitBtn) { submitBtn.disabled = true; submitBtn.textContent = 'Verifying...'; }
    if (errorEl) errorEl.style.display = 'none';

    fetch(BASE + '/api/gemini-oauth/complete', {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ url: url })
    }).then(function(r) { return r.json(); }).then(function(data) {
      if (data.success) {
        cleanupOAuthPolling();
        authRunning = false;
        removeOAuthModal();
        refresh();
      } else {
        if (errorEl) { errorEl.textContent = data.error || 'Failed to complete authentication.'; errorEl.style.display = 'block'; }
        if (submitBtn) { submitBtn.disabled = false; submitBtn.textContent = 'Complete Sign-In'; }
      }
    }).catch(function(e) {
      if (errorEl) { errorEl.textContent = e.message; errorEl.style.display = 'block'; }
      if (submitBtn) { submitBtn.disabled = false; submitBtn.textContent = 'Complete Sign-In'; }
    });
  }

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
          if (agentId === 'gemini') {
            showOAuthWaitingModal();
            cleanupOAuthPolling();
            oauthPollInterval = setInterval(function() {
              fetch(BASE + '/api/gemini-oauth/status').then(function(r) { return r.json(); }).then(function(status) {
                if (status.status === 'success') {
                  cleanupOAuthPolling();
                  authRunning = false;
                  removeOAuthModal();
                  refresh();
                } else if (status.status === 'error') {
                  cleanupOAuthPolling();
                  authRunning = false;
                  removeOAuthModal();
                }
              }).catch(function() {});
            }, 1500);
            oauthFallbackTimer = setTimeout(function() {
              if (authRunning) showOAuthPasteFallback();
            }, 30000);
            oauthPollTimeout = setTimeout(function() {
              cleanupOAuthPolling();
              if (authRunning) { authRunning = false; removeOAuthModal(); }
            }, 5 * 60 * 1000);
          }
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
      removeOAuthModal();
      cleanupOAuthPolling();
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
