(function() {
  var BASE = window.__BASE_URL || '';
  var btn = document.getElementById('agentAuthBtn');
  var dropdown = document.getElementById('agentAuthDropdown');
  var agents = [];
  var authRunning = false;
  var AUTH_CONV_ID = '__agent_auth__';

  function init() {
    if (!btn || !dropdown) return;
    btn.addEventListener('click', toggleDropdown);
    document.addEventListener('click', function(e) {
      if (!btn.contains(e.target)) closeDropdown();
    });
    window.addEventListener('conversation-selected', function() { fetchAuthStatus(); });
    window.addEventListener('ws-message', onWsMessage);
    fetchAuthStatus();
  }

  function fetchAuthStatus() {
    fetch(BASE + '/api/agents/auth-status')
      .then(function(r) { return r.json(); })
      .then(function(data) {
        agents = data.agents || [];
        updateButton();
        renderDropdown();
      })
      .catch(function() {});
  }

  function updateButton() {
    if (agents.length === 0) { btn.style.display = 'none'; return; }
    btn.style.display = 'flex';
    var allOk = agents.every(function(a) { return a.authenticated; });
    var anyMissing = agents.some(function(a) { return !a.authenticated; });
    btn.classList.toggle('auth-ok', allOk);
    btn.classList.toggle('auth-warn', anyMissing);
  }

  function renderDropdown() {
    dropdown.innerHTML = '';
    agents.forEach(function(agent) {
      var item = document.createElement('button');
      item.className = 'agent-auth-item';
      var dotClass = agent.authenticated ? 'ok' : (agent.detail === 'unknown' ? 'unknown' : 'missing');
      item.innerHTML = '<span class="agent-auth-dot ' + dotClass + '"></span>' +
        '<span>' + escapeHtml(agent.name) + '</span>' +
        '<span style="margin-left:auto;font-size:0.7rem;color:var(--color-text-secondary)">' + escapeHtml(agent.detail) + '</span>';
      item.addEventListener('click', function(e) {
        e.stopPropagation();
        closeDropdown();
        triggerAuth(agent.id);
      });
      dropdown.appendChild(item);
    });
  }

  function toggleDropdown(e) {
    e.stopPropagation();
    dropdown.classList.toggle('open');
  }

  function closeDropdown() {
    dropdown.classList.remove('open');
  }

  function triggerAuth(agentId) {
    if (authRunning) return;
    fetch(BASE + '/api/agents/' + agentId + '/auth', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: '{}'
    })
    .then(function(r) { return r.json(); })
    .then(function(data) {
      if (data.ok) {
        authRunning = true;
        showTerminalTab();
        switchToTerminalView();
        var term = getTerminal();
        if (term) {
          term.clear();
          term.writeln('\x1b[36m[authenticating ' + agentId + ']\x1b[0m\r\n');
        }
      }
    })
    .catch(function() {});
  }

  function onWsMessage(e) {
    var data = e.detail;
    if (!data || data.conversationId !== AUTH_CONV_ID) return;
    if (data.type === 'script_started') {
      authRunning = true;
      showTerminalTab();
      switchToTerminalView();
      var term = getTerminal();
      if (term) {
        term.clear();
        term.writeln('\x1b[36m[authenticating ' + (data.agentId || '') + ']\x1b[0m\r\n');
      }
    } else if (data.type === 'script_output') {
      showTerminalTab();
      var term = getTerminal();
      if (term) term.write(data.data);
    } else if (data.type === 'script_stopped') {
      authRunning = false;
      var term = getTerminal();
      var msg = data.error ? data.error : ('exited with code ' + (data.code || 0));
      if (term) term.writeln('\r\n\x1b[90m[auth ' + msg + ']\x1b[0m');
      setTimeout(fetchAuthStatus, 1000);
    }
  }

  function showTerminalTab() {
    var tabBtn = document.getElementById('terminalTabBtn');
    if (tabBtn) tabBtn.style.display = '';
  }

  function switchToTerminalView() {
    var bar = document.getElementById('viewToggleBar');
    if (!bar) return;
    var termBtn = bar.querySelector('[data-view="terminal"]');
    if (termBtn) termBtn.click();
  }

  function getTerminal() {
    return window.scriptRunner ? window.scriptRunner.getTerminal() : null;
  }

  function escapeHtml(s) {
    var d = document.createElement('div');
    d.textContent = s;
    return d.innerHTML;
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
  } else {
    init();
  }

  window.agentAuth = { refresh: fetchAuthStatus };
})();
