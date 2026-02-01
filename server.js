import http from 'http';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { WebSocketServer } from 'ws';
import { pack, unpack } from 'msgpackr';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const PORT = process.env.PORT || 3000;
const watch = process.argv.includes('--watch');

// Hot reload file watcher
const watchedFiles = new Map();
const fileChangeCallbacks = [];

function watchFile(filePath) {
  if (watchedFiles.has(filePath)) return;
  
  try {
    fs.watchFile(filePath, { interval: 100 }, (curr, prev) => {
      if (curr.mtime > prev.mtime) {
        fileChangeCallbacks.forEach(cb => cb(filePath));
      }
    });
    watchedFiles.set(filePath, true);
  } catch (e) {
    console.error(`Failed to watch ${filePath}:`, e.message);
  }
}

function onFileChange(callback) {
  fileChangeCallbacks.push(callback);
}

// Serve static files with hot reload support
const staticDir = path.join(__dirname, 'static');
if (!fs.existsSync(staticDir)) {
  fs.mkdirSync(staticDir, { recursive: true });
}

// Agent connection manager
class AgentManager {
  constructor() {
    this.agents = new Map();
    this.messageQueue = [];
  }

  registerAgent(id, endpoint) {
    this.agents.set(id, {
      id,
      endpoint,
      connected: false,
      ws: null,
      status: 'disconnected',
      lastMessage: null,
    });
  }

  getAgent(id) {
    return this.agents.get(id);
  }

  getAllAgents() {
    return Array.from(this.agents.values());
  }

  setAgentWs(id, ws) {
    const agent = this.agents.get(id);
    if (agent) {
      agent.ws = ws;
      agent.connected = true;
      agent.status = 'connected';
    }
  }

  broadcastToClients(clients, message) {
    const packed = pack(message);
    clients.forEach(client => {
      if (client.readyState === 1) {
        client.send(packed);
      }
    });
  }
}

const agentManager = new AgentManager();

// HTTP server
const server = http.createServer((req, res) => {
  // CORS headers
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');

  if (req.method === 'OPTIONS') {
    res.writeHead(200);
    res.end();
    return;
  }

  // API routes
  if (req.url === '/api/agents' && req.method === 'GET') {
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ agents: agentManager.getAllAgents() }));
    return;
  }

  if (req.url.startsWith('/api/agents/') && req.method === 'POST') {
    const agentId = req.url.split('/')[3];
    let body = '';
    req.on('data', chunk => body += chunk);
    req.on('end', () => {
      try {
        const payload = JSON.parse(body);
        const agent = agentManager.getAgent(agentId);
        if (agent && agent.ws) {
          agent.ws.send(pack(payload));
          res.writeHead(200, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({ success: true }));
        } else {
          res.writeHead(404, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({ error: 'Agent not found or not connected' }));
        }
      } catch (e) {
        res.writeHead(400, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ error: e.message }));
      }
    });
    return;
  }

  // Serve static files
  let filePath = req.url === '/' ? '/index.html' : req.url;
  filePath = path.join(staticDir, filePath);

  const normalizedPath = path.normalize(filePath);
  if (!normalizedPath.startsWith(staticDir)) {
    res.writeHead(403);
    res.end('Forbidden');
    return;
  }

  fs.stat(filePath, (err, stats) => {
    if (err) {
      res.writeHead(404);
      res.end('Not found');
      return;
    }

    if (stats.isDirectory()) {
      filePath = path.join(filePath, 'index.html');
      fs.stat(filePath, (err, stats) => {
        if (err) {
          res.writeHead(404);
          res.end('Not found');
          return;
        }
        serveFile(filePath, res);
      });
    } else {
      serveFile(filePath, res);
    }
  });
});

function serveFile(filePath, res) {
  if (watch) {
    watchFile(filePath);
  }

  const ext = path.extname(filePath).toLowerCase();
  const mimeTypes = {
    '.html': 'text/html; charset=utf-8',
    '.js': 'application/javascript; charset=utf-8',
    '.css': 'text/css; charset=utf-8',
    '.json': 'application/json',
    '.png': 'image/png',
    '.jpg': 'image/jpeg',
    '.svg': 'image/svg+xml',
  };

  const contentType = mimeTypes[ext] || 'application/octet-stream';

  fs.readFile(filePath, (err, data) => {
    if (err) {
      res.writeHead(500);
      res.end('Server error');
      return;
    }

    // Inject hot reload script in HTML
    let content = data.toString();
    if (ext === '.html' && watch) {
      content += `
<script>
(function() {
  const ws = new WebSocket('ws://' + location.host + '/hot-reload');
  ws.onmessage = (e) => {
    const msg = JSON.parse(e.data);
    if (msg.type === 'reload') location.reload();
  };
})();
</script>`;
    }

    res.writeHead(200, { 'Content-Type': contentType });
    res.end(content);
  });
}

// WebSocket server for agent connections and hot reload
const wss = new WebSocketServer({ server });
const clients = [];

wss.on('connection', (ws, req) => {
  const url = req.url;

  if (url === '/hot-reload') {
    // Hot reload client connection
    clients.push(ws);
    ws.on('close', () => {
      const idx = clients.indexOf(ws);
      if (idx > -1) clients.splice(idx, 1);
    });
    return;
  }

  // Agent connection
  const agentId = url.match(/^\/agent\/([^/]+)/)?.[1];
  if (!agentId) {
    ws.close(1008, 'Invalid agent ID');
    return;
  }

  const agent = agentManager.getAgent(agentId);
  if (!agent) {
    ws.close(1008, 'Agent not registered');
    return;
  }

  agentManager.setAgentWs(agentId, ws);
  console.log(`Agent connected: ${agentId}`);

  // Notify clients of agent connection
  agentManager.broadcastToClients(clients, {
    type: 'agent:connected',
    agentId,
    agent: agent,
  });

  ws.on('message', (data) => {
    try {
      const message = unpack(data);
      message.agentId = agentId;
      message.timestamp = Date.now();

      // Broadcast to all connected clients
      agentManager.broadcastToClients(clients, {
        type: 'agent:message',
        ...message,
      });

      // Update agent status
      if (message.status) {
        agent.status = message.status;
      }
      agent.lastMessage = message;
    } catch (e) {
      console.error(`Error processing message from ${agentId}:`, e.message);
    }
  });

  ws.on('close', () => {
    agent.connected = false;
    agent.status = 'disconnected';
    console.log(`Agent disconnected: ${agentId}`);
    agentManager.broadcastToClients(clients, {
      type: 'agent:disconnected',
      agentId,
    });
  });

  ws.on('error', (err) => {
    console.error(`WebSocket error for ${agentId}:`, err.message);
  });
});

// Hot reload watcher
if (watch) {
  onFileChange(() => {
    console.log('Files changed, reloading clients...');
    clients.forEach(client => {
      if (client.readyState === 1) {
        client.send(JSON.stringify({ type: 'reload' }));
      }
    });
  });
}

// Graceful shutdown
process.on('SIGTERM', () => {
  console.log('Shutting down gracefully...');
  wss.close(() => {
    server.close(() => {
      process.exit(0);
    });
  });
});

server.listen(PORT, () => {
  console.log(`Server running on http://localhost:${PORT}`);
  console.log(`Hot reload: ${watch ? 'enabled' : 'disabled'}`);
});
