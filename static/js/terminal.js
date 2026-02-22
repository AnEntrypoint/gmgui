(function() {
  var ws = null;
  var term = null;
  var fitAddon = null;
  var termActive = false;
  var BASE = window.__BASE_URL || '';

  function getWsUrl() {
    var proto = location.protocol === 'https:' ? 'wss:' : 'ws:';
    return proto + '//' + location.host + BASE + '/sync';
  }

  function ensureTerm() {
    var output = document.getElementById('terminalOutput');
    if (!output) return false;
    if (term) return true;
    if (!window.Terminal || !window.FitAddon) return false;

    term = new Terminal({
      cursorBlink: true,
      fontSize: 14,
      fontFamily: 'Menlo, Monaco, "Courier New", monospace',
      theme: {
        background: '#0d1117',
        foreground: '#e6edf3',
        cursor: '#e6edf3',
        selectionBackground: '#3b4455'
      },
      convertEol: false,
      scrollback: 5000
    });
    fitAddon = new FitAddon.FitAddon();
    term.loadAddon(fitAddon);
    output.innerHTML = '';
    term.open(output);
    fitAddon.fit();

    term.onData(function(data) {
      if (ws && ws.readyState === WebSocket.OPEN) {
        var encoded = btoa(unescape(encodeURIComponent(data)));
        ws.send(JSON.stringify({ type: 'terminal_input', data: encoded }));
      }
    });

    window.addEventListener('resize', function() {
      if (fitAddon) try { fitAddon.fit(); } catch(_) {}
    });
    return true;
  }

  function connectAndStart() {
    if (ws && ws.readyState === WebSocket.OPEN) {
      ws.send(JSON.stringify({ type: 'terminal_start', cwd: window.__STARTUP_CWD || undefined }));
      return;
    }
    ws = new WebSocket(getWsUrl());
    ws.onopen = function() {
      ws.send(JSON.stringify({ type: 'terminal_start', cwd: window.__STARTUP_CWD || undefined }));
    };
    ws.onmessage = function(e) {
      try {
        var msg = JSON.parse(e.data);
        if (msg.type === 'terminal_output' && term) {
          var raw = msg.encoding === 'base64'
            ? decodeURIComponent(escape(atob(msg.data)))
            : msg.data;
          term.write(raw);
        } else if (msg.type === 'terminal_exit' && term) {
          term.write('\r\n[Process exited with code ' + msg.code + ']\r\n');
          if (termActive) setTimeout(connectAndStart, 2000);
        }
      } catch(_) {}
    };
    ws.onclose = function() {
      if (termActive) setTimeout(connectAndStart, 2000);
    };
  }

  function startTerminal() {
    if (!ensureTerm()) {
      setTimeout(startTerminal, 200);
      return;
    }
    termActive = true;
    connectAndStart();
    setTimeout(function() { if (fitAddon) try { fitAddon.fit(); } catch(_) {} }, 100);
  }

  function stopTerminal() {
    termActive = false;
    if (ws && ws.readyState === WebSocket.OPEN) {
      ws.send(JSON.stringify({ type: 'terminal_stop' }));
    }
  }

  window.addEventListener('view-switched', function(e) {
    if (e.detail.view === 'terminal') {
      startTerminal();
    } else if (termActive) {
      stopTerminal();
    }
  });

  window.terminalModule = { start: startTerminal, stop: stopTerminal };
})();
