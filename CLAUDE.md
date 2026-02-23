# AgentGUI

Multi-agent GUI client for AI coding agents (Claude Code, Gemini CLI, OpenCode, Goose, etc.) with real-time streaming, WebSocket sync, and SQLite persistence.

## Running

```bash
npm install
npm run dev        # node server.js --watch
```

Server starts on `http://localhost:3000`, redirects to `/gm/`.

## Architecture

```
server.js              HTTP server + WebSocket + all API routes (raw http.createServer)
database.js            SQLite setup (WAL mode), schema, query functions
lib/claude-runner.js   Agent framework - spawns CLI processes, parses stream-json output
lib/speech.js          Speech-to-text and text-to-speech via @huggingface/transformers
bin/gmgui.cjs          CLI entry point (npx agentgui / bunx agentgui)
static/index.html      Main HTML shell
static/app.js          App initialization
static/theme.js        Theme switching
static/js/client.js    Main client logic
static/js/conversations.js       Conversation management
static/js/streaming-renderer.js  Renders Claude streaming events as HTML
static/js/event-processor.js     Processes incoming events
static/js/event-filter.js        Filters events by type
static/js/websocket-manager.js   WebSocket connection handling
static/js/ui-components.js       UI component helpers
static/js/syntax-highlighter.js  Code syntax highlighting
static/js/voice.js               Voice input/output
static/js/features.js            View toggle, drag-drop upload, model progress indicator
static/templates/                 31 HTML template fragments for event rendering
```

## Key Details

- Express is used only for file upload (`/api/upload/:conversationId`) and fsbrowse file browser (`/files/:conversationId`). All other routes use raw `http.createServer` with manual routing.
- Agent discovery scans PATH for known CLI binaries (claude, opencode, gemini, goose, etc.) at startup.
- Database lives at `~/.gmgui/data.db`. Tables: conversations, messages, events, sessions, stream chunks.
- WebSocket endpoint is at `BASE_URL + /sync`. Supports subscribe/unsubscribe by sessionId or conversationId, and ping.

## Environment Variables

- `PORT` - Server port (default: 3000)
- `BASE_URL` - URL prefix (default: /gm)
- `STARTUP_CWD` - Working directory passed to agents
- `HOT_RELOAD` - Set to "false" to disable watch mode

## REST API

All routes are prefixed with `BASE_URL` (default `/gm`).

- `GET /api/conversations` - List conversations
- `POST /api/conversations` - Create conversation (body: agentId, title, workingDirectory)
- `GET /api/conversations/:id` - Get conversation with streaming status
- `POST /api/conversations/:id` - Update conversation
- `DELETE /api/conversations/:id` - Delete conversation
- `GET /api/conversations/:id/messages` - Get messages (query: limit, offset)
- `POST /api/conversations/:id/messages` - Send message (body: content, agentId)
- `POST /api/conversations/:id/stream` - Start streaming execution
- `GET /api/conversations/:id/full` - Full conversation load with chunks
- `GET /api/conversations/:id/chunks` - Get stream chunks (query: since)
- `GET /api/conversations/:id/sessions/latest` - Get latest session
- `GET /api/sessions/:id` - Get session
- `GET /api/sessions/:id/chunks` - Get session chunks (query: since)
- `GET /api/sessions/:id/execution` - Get execution events (query: limit, offset, filterType)
- `GET /api/agents` - List discovered agents
- `GET /api/home` - Get home directory
- `POST /api/stt` - Speech-to-text (raw audio body)
- `POST /api/tts` - Text-to-speech (body: text)
- `GET /api/speech-status` - Speech model loading status
- `POST /api/folders` - Create folder

## WebSocket Protocol

Endpoint: `BASE_URL + /sync`

Client sends:
- `{ type: "subscribe", sessionId }` or `{ type: "subscribe", conversationId }`
- `{ type: "unsubscribe", sessionId }`
- `{ type: "ping" }`

Server broadcasts:
- `streaming_start` - Agent execution started
- `streaming_progress` - New event/chunk from agent
- `streaming_complete` - Execution finished
- `streaming_error` - Execution failed
- `conversation_created`, `conversation_updated`, `conversation_deleted`
- `model_download_progress` - Voice model download progress
- `voice_list` - Available TTS voices

## Voice Model Download

Speech models (~470MB total) are downloaded automatically on server startup. No credentials required.

### Download Sources (fallback chain)
1. **GitHub LFS** (primary): `https://github.com/AnEntrypoint/models` - LFS-tracked ONNX files via `media.githubusercontent.com`, small files via `raw.githubusercontent.com`
2. **HuggingFace** (fallback): `onnx-community/whisper-base` for STT, `AnEntrypoint/sttttsmodels` for TTS

### Models
- **Whisper Base** (~280MB): encoder + decoder ONNX models, tokenizer, config files
- **TTS Models** (~190MB): mimi encoder/decoder, flow_lm, text_conditioner, tokenizer

### UI Behavior
- Voice tab is hidden until models are ready
- A circular progress indicator appears in the header during download
- Once models are downloaded, the Voice tab becomes visible
- Model status is broadcast via WebSocket `model_download_progress` events

### Cache Location
Models are stored at `~/.gmgui/models/` (whisper in `onnx-community/whisper-base/`, TTS in `tts/`).
