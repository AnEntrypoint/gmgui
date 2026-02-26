(function() {
  let currentConversationId = null;
  let currentWorkingDirectory = null;
  let scriptState = { running: false, script: null, hasStart: false, hasDev: false };
  let hasTerminalContent = false;

  function init() {
    setupListeners();
    setupButtons();
  }

  function setupListeners() {
    window.addEventListener('conversation-selected', function(e) {
      currentConversationId = e.detail.conversationId;
      hasTerminalContent = false;
      hideTerminalTab();
      fetchConversationAndCheckScripts();
    });

    window.addEventListener('ws-message', function(e) {
      const data = e.detail;
      if (!data || !currentConversationId) return;
      if (data.conversationId !== currentConversationId) return;

      const term = getTerminal();

      if (data.type === 'script_started') {
        scriptState.running = true;
        scriptState.script = data.script;
        hasTerminalContent = false;
        if (term) term.clear();
        updateButtons();
        showTerminalTab();
      } else if (data.type === 'script_stopped') {
        scriptState.running = false;
        const msg = data.error ? data.error : ('exited with code ' + (data.code || 0));
        if (term) term.writeln('\r\n\x1b[90m[process ' + msg + ']\x1b[0m');
        updateButtons();
      } else if (data.type === 'script_output') {
        hasTerminalContent = true;
        showTerminalTab();
        if (term) term.write(data.data);
      }
    });

    window.addEventListener('resize', debounce(fitTerminal, 200));
  }

  function setupButtons() {
    var startBtn = document.getElementById('scriptStartBtn');
    var devBtn = document.getElementById('scriptDevBtn');
    var stopBtn = document.getElementById('scriptStopBtn');

    if (startBtn) startBtn.addEventListener('click', function() { runScript('start'); });
    if (devBtn) devBtn.addEventListener('click', function() { runScript('dev'); });
    if (stopBtn) stopBtn.addEventListener('click', function() { stopScript(); });
  }

  function fetchConversationAndCheckScripts() {
    if (!currentConversationId) return;
    window.wsClient.rpc('conv.get', { id: currentConversationId })
      .then(function(data) {
        currentWorkingDirectory = data.conversation?.workingDirectory || null;
        if (currentWorkingDirectory) showTerminalTab();
        checkScripts();
      })
      .catch(function() { checkScripts(); });
  }

  function checkScripts() {
    if (!currentConversationId) return;
    window.wsClient.rpc('conv.scripts', { id: currentConversationId })
      .then(function(data) {
        scriptState.hasStart = data.hasStart;
        scriptState.hasDev = data.hasDev;
        scriptState.running = data.running;
        scriptState.script = data.runningScript;
        updateButtons();
        if (data.running || hasTerminalContent) showTerminalTab();
      })
      .catch(function() {
        scriptState.hasStart = false;
        scriptState.hasDev = false;
        updateButtons();
      });
  }

  function updateButtons() {
    var container = document.getElementById('scriptButtons');
    var startBtn = document.getElementById('scriptStartBtn');
    var devBtn = document.getElementById('scriptDevBtn');
    var stopBtn = document.getElementById('scriptStopBtn');

    var showAny = scriptState.hasStart || scriptState.hasDev || scriptState.running;
    if (container) container.style.display = showAny ? 'flex' : 'none';

    if (scriptState.running) {
      if (startBtn) startBtn.style.display = 'none';
      if (devBtn) devBtn.style.display = 'none';
      if (stopBtn) stopBtn.style.display = 'flex';
    } else {
      if (startBtn) startBtn.style.display = scriptState.hasStart ? 'flex' : 'none';
      if (devBtn) devBtn.style.display = scriptState.hasDev ? 'flex' : 'none';
      if (stopBtn) stopBtn.style.display = 'none';
    }
  }

  function runScript(script) {
    if (!currentConversationId || scriptState.running) return;
    window.wsClient.rpc('conv.run-script', { id: currentConversationId, script: script })
      .then(function(data) {
        if (data.ok) {
          scriptState.running = true;
          scriptState.script = script;
          hasTerminalContent = false;
          updateButtons();
          showTerminalTab();
          switchToTerminalView();
          var term = getTerminal();
          if (term) {
            term.clear();
            term.writeln('\x1b[36m[running npm run ' + script + ']\x1b[0m\r\n');
          }
        }
      })
      .catch(function(err) { console.error('Failed to start script:', err); });
  }

  function stopScript() {
    if (!currentConversationId) return;
    window.wsClient.rpc('conv.stop-script', { id: currentConversationId })
      .catch(function(err) { console.error('Failed to stop script:', err); });
  }

  function showTerminalTab() {
    var btn = document.getElementById('terminalTabBtn');
    if (btn) btn.style.display = '';
  }

  function hideTerminalTab() {
    var btn = document.getElementById('terminalTabBtn');
    if (btn) btn.style.display = 'none';
  }

  function switchToTerminalView() {
    var bar = document.getElementById('viewToggleBar');
    if (!bar) return;
    var termBtn = bar.querySelector('[data-view="terminal"]');
    if (termBtn) termBtn.click();
  }

  function getTerminal() {
    if (window.terminalModule && window.terminalModule.getTerminal) {
      return window.terminalModule.getTerminal();
    }
    return null;
  }

  function fitTerminal() {
    var term = getTerminal();
    if (term && term._core && term._core._renderService) {
      try { term.fit(); } catch {}
    }
  }

  function debounce(fn, ms) {
    var timer;
    return function() {
      clearTimeout(timer);
      timer = setTimeout(fn, ms);
    };
  }

  window.addEventListener('view-switched', function(e) {
    if (e.detail && e.detail.view === 'terminal') {
      setTimeout(fitTerminal, 100);
    }
  });

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
  } else {
    init();
  }

  window.scriptRunner = {
    getState: function() { return scriptState; },
    getTerminal: getTerminal
  };
})();
