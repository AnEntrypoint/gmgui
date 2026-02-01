# GMGUI Startup Guide

## New Startup Command

GMGUI now starts with a single command using gxe:

```bash
npx -y gxe@latest lanmower/gmgui start
```

## Overview

- **No npm install needed**: Dependencies are automatically installed when needed
- **Port Configuration**: Default port is 3000, configurable via PORT environment variable
- **Base URL**: Default is /gm, configurable via BASE_URL environment variable
- **Nginx Ready**: Server is configured for path-based routing

## Starting GMGUI

### Default Configuration (Port 3000, Base URL /gm)

```bash
npx -y gxe@latest lanmower/gmgui start
```

Access at: http://localhost:3000/gm/

### Custom Port

```bash
PORT=8080 npx -y gxe@latest lanmower/gmgui start
```

Access at: http://localhost:8080/gm/

### Custom Base URL and Port

```bash
PORT=8080 BASE_URL=/api/gm npx -y gxe@latest lanmower/gmgui start
```

Access at: http://localhost:8080/api/gm/

## Nginx Configuration

To forward requests from nginx to GMGUI:

```nginx
location /gm/ {
    proxy_pass http://localhost:3000/gm/;
    proxy_http_version 1.1;
    proxy_set_header Upgrade $http_upgrade;
    proxy_set_header Connection "upgrade";
    proxy_set_header Host $host;
}
```

## What Changed from Previous Startup

### Previous Methods (No Longer Needed)

- `npm install && npm start`
- `npm run dev`
- `node server.js`
- `node bin/gmgui.js`

### Updated Entry Point (bin/gmgui.js)

The entry point now:

1. Accepts gxe module interface (export + direct execution)
2. Checks if node_modules exists
3. Automatically installs dependencies if missing
4. Starts server with PORT and BASE_URL from environment
5. Returns Promise for proper async execution

## Server Features

- Loads SQLite database from ~/.gmgui/data.json
- Auto-discovers available agents (Claude Code, OpenCode)
- Serves static HTML/CSS/JavaScript files from static/ directory
- Provides REST API for conversations, messages, and sessions
- WebSocket support for real-time message streaming and sync
- CORS enabled for all origins

## Environment Variables

- `PORT` - Server listening port (default: 3000)
- `BASE_URL` - Base URL path for routing (default: /gm)
- `HOME` - User home directory (used for database storage)

## API Endpoints

All endpoints are under the BASE_URL prefix (default /gm/):

- `GET /gm/` - Serve main HTML interface
- `GET /gm/api/agents` - List available agents
- `GET /gm/api/conversations` - List all conversations
- `POST /gm/api/conversations` - Create new conversation
- `GET /gm/api/conversations/{id}` - Get conversation details
- `POST /gm/api/conversations/{id}/messages` - Send message
- `GET /gm/api/conversations/{id}/messages` - Get conversation messages
- `WS /gm/stream` - WebSocket for message streaming
- `WS /gm/sync` - WebSocket for state sync

## Troubleshooting

### Port Already in Use

```bash
PORT=3001 npx -y gxe@latest lanmower/gmgui start
```

### Reset Database

```bash
rm ~/.gmgui/data.json
npx -y gxe@latest lanmower/gmgui start
```

Database will be recreated on startup.

### View Server Logs

The server outputs to stdout/stderr:

```
Database loaded successfully
GMGUI running on http://localhost:3000/gm/
Agents: Claude Code, OpenCode
Hot reload: off
```

## Production Deployment

For production use, create a systemd unit or equivalent process manager:

```ini
[Unit]
Description=GMGUI Server
After=network.target

[Service]
Type=simple
User=gmgui
Environment="PORT=3000"
Environment="BASE_URL=/gm"
ExecStart=/usr/bin/npx -y gxe@latest lanmower/gmgui start
Restart=always
RestartSec=10

[Install]
WantedBy=multi-user.target
```

## Performance Notes

- First startup installs dependencies (~10-20 seconds)
- Subsequent startups are fast (~2-3 seconds)
- Server maintains in-memory ACP connection pool
- Database operations are synchronous
- No horizontal scaling needed for small deployments
