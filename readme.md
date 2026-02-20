# AgentGUI

A multi-agent GUI for AI coding assistants. Connects to CLI-based agents (Claude Code, Gemini CLI, OpenCode, Goose, and others) and provides a web interface with real-time streaming output.

## Quick Start

```bash
npx agentgui
```

Or install and run manually:

```bash
git clone https://github.com/AnEntrypoint/agentgui.git
cd agentgui
npm install
npm run dev
```

Open `http://localhost:3000` in your browser.

## What It Does

- Auto-discovers AI coding agents installed on your system (Claude Code, Gemini CLI, OpenCode, Goose, Codex, Kiro, etc.)
- Runs agents with streaming JSON output and displays results in real-time via WebSocket
- Manages conversations with SQLite persistence
- Supports concurrent agent sessions
- Provides file browsing and upload for agent working directories
- Includes speech-to-text and text-to-speech

## Architecture

- `server.js` - HTTP server, REST API, WebSocket endpoint, static file serving
- `database.js` - SQLite database (WAL mode) at `~/.gmgui/data.db`
- `lib/claude-runner.js` - Agent runner framework, spawns CLI processes and parses streaming output
- `lib/speech.js` - Speech processing via Hugging Face transformers
- `static/` - Browser client with streaming renderer, WebSocket manager, and HTML templates
- `bin/gmgui.cjs` - CLI entry point for `npx agentgui`

## Text-to-Speech on Windows

On Windows, AgentGUI automatically sets up pocket-tts (text-to-speech) on your first TTS request. No manual setup required.

### What Happens
1. Server detects Python 3.9+ installation
2. Creates virtual environment at `~/.gmgui/pocket-venv`
3. Installs pocket-tts via pip
4. All subsequent TTS requests use cached installation

### Requirements
- Python 3.9+ (check with `python --version`)
- ~200 MB free disk space
- Internet connection for first setup

### Troubleshooting
- **Python not found**: Download from https://www.python.org and ensure "Add Python to PATH" is checked
- **Setup fails**: Check that you have write access to your home directory (~/.gmgui/)
- **Manual cleanup**: Delete `%USERPROFILE%\.gmgui\pocket-venv` and try again

For manual setup or detailed troubleshooting, see the setup instructions in the code or check `/api/speech-status` endpoint for error details.

## Configuration

| Variable | Default | Description |
|----------|---------|-------------|
| `PORT` | 3000 | Server port |
| `BASE_URL` | /gm | URL prefix |
| `HOT_RELOAD` | true | Watch mode for development |

## License

MIT

## Repository

https://github.com/AnEntrypoint/agentgui
