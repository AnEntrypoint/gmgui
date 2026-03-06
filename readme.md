# AgentGUI

<div align="center">

![AgentGUI Main Interface](docs/screenshot-main.png)

**Multi-agent GUI for AI coding assistants**

[![GitHub Pages](https://img.shields.io/badge/GitHub_Pages-Live-blue?logo=github)](https://anentrypoint.github.io/agentgui/)
[![npm](https://img.shields.io/npm/v/agentgui?color=brightgreen)](https://www.npmjs.com/package/agentgui)
[![Weekly Downloads](https://img.shields.io/npm/dw/agentgui?color=brightgreen)](https://www.npmjs.com/package/agentgui)
[![License](https://img.shields.io/badge/license-MIT-blue.svg)](LICENSE)

[Quick Start](#quick-start) • [Features](#features) • [Screenshots](#screenshots) • [Architecture](#architecture) • [Documentation](https://anentrypoint.github.io/agentgui/)

</div>

---

## Overview

AgentGUI provides a unified web interface for AI coding agents. Connect to any CLI-based agent (Claude Code, Gemini CLI, OpenCode, Goose, Kilo, Codex, and more) and interact through a real-time streaming interface with SQLite persistence, file management, and speech capabilities.

## Quick Start

### One-Line Install

```bash
npx agentgui
```

The server starts at `http://localhost:3000/gm/`

### Manual Installation

```bash
git clone https://github.com/AnEntrypoint/agentgui.git
cd agentgui
npm install
npm run dev
```

### System Requirements

- **Node.js** 18+ (LTS recommended)
- **npm** or **bun**
- **AI Coding Agents**: Claude Code, Gemini CLI, OpenCode, Goose, Kilo, or Codex
- **Optional**: Python 3.9+ for text-to-speech on Windows

## Features

### 🤖 Multi-Agent Support
Auto-discovers and connects to all installed AI coding agents:
- Claude Code (`@anthropic-ai/claude-code`)
- Gemini CLI (`@google/gemini-cli`)
- OpenCode (`opencode-ai`)
- Goose (`goose-ai`)
- Kilo (`@kilocode/cli`)
- Codex and other CLI-based agents

### ⚡ Real-Time Streaming
- WebSocket-based streaming for instant agent responses
- Live execution visualization with syntax highlighting
- Progress indicators for long-running operations
- Concurrent agent sessions

### 💾 Persistent Storage
- SQLite database (`~/.gmgui/data.db`) in WAL mode
- Conversation history with full context
- Session management and resumption
- Message threading and organization

### 📁 File Management
- Integrated file browser for agent working directories
- Drag-and-drop file uploads
- Direct file editing and viewing
- Context-aware file operations

### 🎤 Speech Capabilities
- Speech-to-text via Hugging Face Whisper
- Text-to-speech with multiple voice options
- Automatic model downloading (~470MB)
- No API keys required

### 🔧 Developer Experience
- Hot reload during development
- Extensible agent framework
- REST API + WebSocket endpoints
- Plugin system for custom agents

## Screenshots

### Main Interface
![Main Interface](docs/screenshot-main.png)

### Chat & Conversation Views
![Chat View](docs/screenshot-chat.png)

![Conversation History](docs/screenshot-conversation.png)

### File Browser
![File Browser](docs/screenshot-files.png)

### Terminal Execution
![Terminal View](docs/screenshot-terminal.png)

### Tools Management
![Tools Popup](docs/screenshot-tools-popup.png)

## Architecture

```
┌─────────────────────────────────────────────────────────────────┐
│                         Browser Client                          │
│  ┌──────────────┐ ┌──────────────┐ ┌──────────────────────────┐ │
│  │   UI Layer   │ │   WebSocket  │ │   Streaming Renderer     │ │
│  │  Components  │ │   Manager    │ │   (Event Processor)      │ │
│  └──────────────┘ └──────────────┘ └──────────────────────────┘ │
└─────────────────────────────────────────────────────────────────┘
                              │
                    ┌─────────▼─────────┐
                    │   HTTP + WS       │
                    │   Server          │
                    │  (server.js)      │
                    └─────────┬─────────┘
                              │
        ┌─────────────────────┼─────────────────────┐
        │                     │                     │
┌───────▼────────┐  ┌─────────▼─────────┐  ┌───────▼────────┐
│   SQLite DB    │  │  Agent Runner     │  │   Speech       │
│  (database.js) │  │ (claude-runner.js)│  │  (speech.js)   │
└────────────────┘  └─────────┬─────────┘  └────────────────┘
                              │
                    ┌─────────▼─────────┐
                    │  Agent CLI Tools  │
                    │  (spawned procs)  │
                    └───────────────────┘
```

### Key Components

| Component | Purpose | Location |
|-----------|---------|----------|
| **HTTP Server** | REST API, static files, routing | `server.js` |
| **Database** | SQLite persistence (WAL mode) | `database.js` |
| **Agent Runner** | CLI spawning, stream parsing | `lib/claude-runner.js` |
| **Speech Engine** | STT/TTS via transformers | `lib/speech.js` |
| **Client Core** | Main browser logic | `static/js/client.js` |
| **WebSocket Manager** | Real-time communication | `static/js/websocket-manager.js` |
| **Streaming Renderer** | Event-based UI updates | `static/js/streaming-renderer.js` |
| **CLI Entry** | `npx agentgui` handler | `bin/gmgui.cjs` |

## Configuration

Environment variables:

| Variable | Default | Description |
|----------|---------|-------------|
| `PORT` | `3000` | Server port |
| `BASE_URL` | `/gm` | URL prefix for all routes |
| `STARTUP_CWD` | Current dir | Working directory for agents |
| `HOT_RELOAD` | `true` | Enable watch mode |

## REST API

All routes prefixed with `BASE_URL` (default `/gm`):

### Conversations
- `GET /api/conversations` - List all conversations
- `POST /api/conversations` - Create new conversation
- `GET /api/conversations/:id` - Get conversation details
- `DELETE /api/conversations/:id` - Delete conversation

### Messages & Streaming
- `POST /api/conversations/:id/messages` - Send message to agent
- `POST /api/conversations/:id/stream` - Start streaming execution
- `GET /api/conversations/:id/chunks` - Get stream chunks

### Agents & Tools
- `GET /api/agents` - List discovered agents
- `GET /api/tools` - List available tools
- `POST /api/tools/:id/install` - Install tool
- `POST /api/tools/:id/update` - Update tool

### Speech
- `POST /api/stt` - Speech-to-text (raw audio)
- `POST /api/tts` - Text-to-speech (returns audio)
- `GET /api/speech-status` - Model download status

### WebSocket
- Endpoint: `BASE_URL + /sync`
- Events: `streaming_start`, `streaming_progress`, `streaming_complete`, `streaming_error`
- Subscribe: `{ type: "subscribe", sessionId }` or `{ type: "subscribe", conversationId }`

## Text-to-Speech Setup (Windows)

AgentGUI automatically configures text-to-speech on first use:

1. Detects Python 3.9+ installation
2. Creates virtual environment at `~/.gmgui/pocket-venv`
3. Installs `pocket-tts` via pip
4. Caches setup for subsequent requests

**Requirements**: Python 3.9+, ~200MB disk space, internet connection

**Troubleshooting**:
- **Python not found**: Install from [python.org](https://www.python.org) with "Add Python to PATH"
- **Setup fails**: Check write access to `~/.gmgui/`
- **Manual cleanup**: Delete `%USERPROFILE%\.gmgui\pocket-venv` and retry

## Development

### Running in Dev Mode

```bash
npm run dev
```

Server auto-reloads on file changes.

### Project Structure

```
agentgui/
├── server.js              # Main server (HTTP + WebSocket + API)
├── database.js            # SQLite schema and queries
├── lib/
│   ├── claude-runner.js   # Agent execution framework
│   ├── acp-manager.js     # ACP tool lifecycle
│   ├── speech.js          # STT/TTS processing
│   └── tool-manager.js    # Tool installation/updates
├── static/
│   ├── index.html         # Main app shell
│   ├── js/
│   │   ├── client.js      # Core client logic
│   │   ├── websocket-manager.js
│   │   ├── streaming-renderer.js
│   │   └── ...
│   └── templates/         # HTML event templates
└── bin/
    └── gmgui.cjs         # CLI entry point
```

### Adding Custom Agents

1. Add agent descriptor to `lib/agent-descriptors.js`
2. Implement CLI detection logic
3. Configure spawn parameters
4. Add to agent discovery scan

## Troubleshooting

### Server Won't Start
- Check if port 3000 is already in use: `lsof -i :3000` (macOS/Linux) or `netstat -ano | findstr :3000` (Windows)
- Try a different port: `PORT=4000 npm run dev`

### Agent Not Detected
- Verify agent is installed globally: `which claude` / `where claude`
- Check PATH includes agent binary location
- Restart server after installing new agents

### WebSocket Connection Fails
- Verify BASE_URL matches your deployment
- Check browser console for connection errors
- Ensure no proxy/firewall blocking WebSocket

### Speech Models Not Downloading
- Check internet connection
- Verify `~/.gmgui/models/` is writable
- Monitor download via `/api/speech-status`

## Contributing

Contributions welcome! Please:

1. Fork the repository
2. Create a feature branch (`git checkout -b feature/amazing-feature`)
3. Commit changes (`git commit -m 'Add amazing feature'`)
4. Push to branch (`git push origin feature/amazing-feature`)
5. Open a Pull Request

## License

MIT © [AnEntrypoint](https://github.com/AnEntrypoint)

## Links

- **GitHub**: https://github.com/AnEntrypoint/agentgui
- **npm**: https://www.npmjs.com/package/agentgui
- **Documentation**: https://anentrypoint.github.io/agentgui/
- **Issues**: https://github.com/AnEntrypoint/agentgui/issues

---

<div align="center">
Made with ❤️ by the AgentGUI team
</div>
