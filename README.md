# GMGUI - Multi-Agent ACP Client

A buildless, hot-reloading web client for managing multiple Claude Agent Protocol (ACP) agents with real-time communication via WebSocket and MessagePack.

## Features

- **Buildless Architecture**: Pure JavaScript/HTML/CSS, no build step required
- **Hot Reload**: Automatic browser refresh on file changes
- **Multi-Agent Support**: Connect and manage multiple ACP agents simultaneously
- **Real-Time Communication**: WebSocket + MessagePack for efficient binary messaging
- **Minimal Dependencies**: Only 2 production dependencies (ws, msgpackr)
- **Modern UI**: Clean, responsive interface using rippleui CSS framework
- **Agent Status Tracking**: Monitor connection status and message history for each agent

## Quick Start

### Server

```bash
npm install
npm start
```

Server runs on `http://localhost:3000` by default.

### Development with Hot Reload

```bash
npm run dev
```

Changes to files in `static/` will trigger browser refresh automatically.

## Architecture

### Server (`server.js`)

- HTTP server serving static files
- WebSocket server for agent connections
- Agent manager tracking all connected agents
- Message routing between agents and clients

### Client (`static/app.js`)

- Real-time agent connection management
- Message history and logging
- Settings persistence (localStorage)
- WebSocket connection handling

## Connecting Agents

### Using the Web UI

1. Open `http://localhost:3000`
2. Enter Agent ID and WebSocket endpoint
3. Click "Connect"
4. Select agent and send messages

### Using the Agent Client Library

```bash
node examples/agent-client.js \
  --id my-agent \
  --gui http://localhost:3000 \
  --endpoint ws://localhost:3001
```

Options:
- `--id` (short: `-i`): Agent identifier
- `--gui` (short: `-g`): GUI server URL (default: http://localhost:3000)
- `--endpoint` (short: `-e`): ACP agent endpoint (default: ws://localhost:3001)
- `--verbose` (short: `-v`): Enable verbose logging

### Testing with Mock Agent

```bash
# Terminal 1: Start gmgui server
npm start

# Terminal 2: Start mock agent
node examples/mock-agent.js --port 3001 --name "Test Agent"

# Terminal 3: Connect agent to gmgui
node examples/agent-client.js --id test-agent --endpoint ws://localhost:3001
```

Open `http://localhost:3000` in browser and interact with the connected agent.

## API

### HTTP Endpoints

#### Get All Agents
```
GET /api/agents
```

Response:
```json
{
  "agents": [
    {
      "id": "agent-1",
      "endpoint": "ws://localhost:3001",
      "status": "connected",
      "lastMessage": { ... }
    }
  ]
}
```

#### Send Message to Agent
```
POST /api/agents/{agentId}
Content-Type: application/json

{
  "type": "message",
  "content": "Hello agent"
}
```

### WebSocket Events

#### Client → Server (Agent)
```javascript
{
  type: "message",
  content: "Message content",
  timestamp: 1234567890
}
```

#### Server → Client (Browser)
```javascript
{
  type: "agent:connected",
  agentId: "agent-1",
  agent: { ... }
}

{
  type: "agent:message",
  agentId: "agent-1",
  message: { ... }
}

{
  type: "agent:disconnected",
  agentId: "agent-1"
}
```

## Project Structure

```
gmgui/
├── server.js                 # HTTP + WebSocket server
├── package.json             # Dependencies
├── static/
│   ├── index.html          # Main HTML
│   ├── app.js              # Frontend application logic
│   ├── styles.css          # Custom styles
│   └── rippleui.css        # CSS framework
├── examples/
│   ├── agent-client.js     # Agent client library
│   └── mock-agent.js       # Mock agent server for testing
└── README.md               # This file
```

## Configuration

### Environment Variables

- `PORT` (default: 3000): Server port

### Local Storage Settings

- `gmgui-settings`: User preferences (message format, auto-scroll, timeout)

## Development

### Adding New Features

1. Edit `static/` files
2. Changes auto-reload in watch mode
3. No build or bundling needed

### Message Flow

```
ACP Agent Endpoint (WebSocket)
  ↓
Agent Client Library (agent-client.js)
  ↓
GMGUI Server (server.js)
  ↓
Browser Client (app.js)
  ↓
Web UI (index.html)
```

## Performance

- **No build step**: Instant startup
- **Binary messaging**: MessagePack reduces payload size
- **WebSocket**: Low-latency bidirectional communication
- **Single-threaded**: Node.js event-driven architecture
- **Memory efficient**: Minimal dependencies, no heavy frameworks

## Browser Support

- Chrome/Edge 63+
- Firefox 55+
- Safari 11+
- Requires WebSocket support

## License

MIT

## Examples

### Send Command to Agent

```javascript
// In browser console
app.sendMessage();

// Or programmatically
fetch('/api/agents/my-agent', {
  method: 'POST',
  headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify({
    type: 'command',
    content: 'execute --help'
  })
});
```

### Monitor Agent Status

```javascript
// Subscribe to real-time updates via WebSocket
// Already handled by app.js

// Manual check
fetch('/api/agents').then(r => r.json()).then(data => {
  console.log(data.agents);
});
```

### Custom Agent Integration

Implement ACP agent protocol:

```javascript
const ws = new WebSocket('ws://gmgui-server/agent/my-agent');
ws.binaryType = 'arraybuffer';

// Send message to GMGUI
ws.send(pack({ type: 'message', content: '...' }));

// Receive from GMGUI
ws.onmessage = (e) => {
  const msg = unpack(new Uint8Array(e.data));
  console.log(msg);
};
```

## Troubleshooting

### Agent won't connect

1. Check agent endpoint is accessible: `curl ws://endpoint`
2. Verify GMGUI server is running: `http://localhost:3000`
3. Check browser console for errors
4. Check server logs: `npm start` with `--verbose` flag

### Messages not appearing

1. Check "Auto-scroll Console" setting
2. Verify agent is selected in sidebar
3. Check WebSocket connection in browser DevTools Network tab
4. Ensure agent is actually sending messages

### Port already in use

```bash
# Change port
PORT=3001 npm start

# Or kill existing process
lsof -i :3000 | grep LISTEN | awk '{print $2}' | xargs kill -9
```

## Next Steps

- Deploy to cloud (Vercel, Heroku, AWS)
- Add persistent message storage (SQLite, PostgreSQL)
- Implement user authentication
- Add agent templates and presets
- Create VSCode extension for native integration
