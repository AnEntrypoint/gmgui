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
lib/acp-manager.js     ACP tool lifecycle - auto-starts opencode/kilo HTTP servers, restart on crash
lib/ws-protocol.js     WebSocket RPC router (WsRouter class)
lib/ws-optimizer.js    Per-client priority queue for WS event batching
lib/ws-handlers-conv.js  Conversation/message/queue RPC handlers (~70 methods total)
lib/ws-handlers-session.js  Session/agent RPC handlers
lib/ws-handlers-run.js  Thread/run RPC handlers
lib/ws-handlers-util.js  Utility RPC handlers (speech, auth, git, tools)
lib/tool-manager.js    Tool detection, installation, version checking
lib/speech.js          Speech-to-text and text-to-speech via @huggingface/transformers
bin/gmgui.cjs          CLI entry point (npx agentgui / bun x agentgui)
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
static/js/tools-manager.js       Tool install/update UI
static/templates/                 31 HTML template fragments for event rendering
```

## Key Details

- Express is used only for file upload (`/api/upload/:conversationId`) and fsbrowse file browser (`/files/:conversationId`). All other routes use raw `http.createServer` with manual routing.
- Agent discovery scans PATH for known CLI binaries (claude, opencode, gemini, goose, etc.) at startup.
- Database lives at `~/.gmgui/data.db`. Tables: conversations, messages, events, sessions, stream chunks.
- WebSocket endpoint is at `BASE_URL + /sync`. Supports subscribe/unsubscribe by sessionId or conversationId, and ping.
- All WS RPC uses msgpack binary encoding (lib/codec.js). Wire format: `{ r, m, p }` request, `{ r, d }` reply, `{ type, seq }` broadcast push.
- `perMessageDeflate` is disabled on the WS server — msgpack binary doesn't compress well and brotli/gzip was blocking the event loop. HTTP-layer gzip handles static assets.
- Static assets use `Cache-Control: max-age=31536000, immutable` + ETag. Compressed once on first request, served from RAM (`_assetCache` Map keyed by etag).
- Deployment: runs behind Traefik/Caddy which handles TLS and can support WebTransport/QUIC.

## Environment Variables

- `PORT` - Server port (default: 3000)
- `BASE_URL` - URL prefix (default: /gm)
- `STARTUP_CWD` - Working directory passed to agents
- `HOT_RELOAD` - Set to "false" to disable watch mode

## ACP Tool Lifecycle

On startup, agentgui auto-launches bundled ACP tools (opencode, kilo) as HTTP servers:
- OpenCode: port 18100 (`opencode acp --port 18100`)
- Kilo: port 18101 (`kilo acp --port 18101`)

Managed by `lib/acp-manager.js`. Features: crash restart with exponential backoff (max 10 in 5min), health checks every 30s via `GET /provider`, clean shutdown on SIGTERM. The `acpPort` field on discovered agents is set automatically once healthy. Models are queried from the running ACP HTTP servers via their `/provider` endpoint.

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
- `GET /api/acp/status` - ACP tool lifecycle status (ports, health, PIDs, restart counts)
- `GET /api/home` - Get home directory
- `POST /api/stt` - Speech-to-text (raw audio body)
- `POST /api/tts` - Text-to-speech (body: text)
- `GET /api/speech-status` - Speech model loading status
- `POST /api/folders` - Create folder
- `GET /api/tools` - List detected tools with installation status (via WebSocket tools.list handler)
- `GET /api/tools/:id/status` - Get tool installation status (version, installed_at, error_message)
- `POST /api/tools/:id/install` - Start tool installation (returns `{ success: true }` with background async install)
- `POST /api/tools/:id/update` - Start tool update (body: targetVersion)
- `GET /api/tools/:id/history` - Get tool install/update history (query: limit, offset)
- `POST /api/tools/update` - Batch update all tools with available updates
- `POST /api/tools/refresh-all` - Refresh all tool statuses from package manager

## Tool Update System

Tool updates are managed through a complete pipeline:

**Update Flow:**
1. Frontend (`static/js/tools-manager.js`) initiates POST to `/api/tools/{id}/update`
2. Server (`server.js` lines 1904-1961 for individual, 1973-2003 for batch) spawns bun x process
3. Tool manager (`lib/tool-manager.js` lines 400-432) executes `bun x <package>` and detects new version
4. Version is saved to database: `queries.updateToolStatus(toolId, { version, status: 'installed' })`
5. WebSocket broadcasts `tool_update_complete` with version and status data
6. Frontend updates UI and removes tool from `operationInProgress` set

**Critical Detail:** When updating tools in batch (`/api/tools/update`), the version parameter MUST be included in the database update call. This ensures database persistence across page reloads.

**Version Detection Sources** (`lib/tool-manager.js`):
- Claude Code: `~/.claude/plugins/{pluginId}/plugin.json`
- OpenCode: `~/.config/opencode/agents/{pluginId}/plugin.json`
- Gemini CLI: `~/.gemini/extensions/{pluginId}/plugin.json`
- Kilo: `~/.config/kilo/agents/{pluginId}/plugin.json`

**Database Schema** (`database.js`):
- Table: `tool_installations` (toolId, version, status, installed_at, error_message)
- Table: `tool_install_history` (action, status, error_message for audit trail)

## Tool Detection System

TOOLS array in `lib/tool-manager.js` — two categories:
- **`cli`**: `{ id, name, pkg, category: 'cli' }` — detected via `which <bin>` + `<bin> --version`
- **`plugin`**: `{ id, name, pkg, installPkg, pluginId, category: 'plugin', frameWork }` — detected via plugin.json files

Current tools:
- `cli-claude`: bin=`claude`, pkg=`@anthropic-ai/claude-code`
- `cli-opencode`: bin=`opencode`, pkg=`opencode-ai`
- `cli-gemini`: bin=`gemini`, pkg=`@google/gemini-cli`
- `cli-kilo`: bin=`kilo`, pkg=`@kilocode/cli`
- `cli-codex`: bin=`codex`, pkg=`@openai/codex`
- `cli-agent-browser`: bin=`agent-browser`, pkg=`agent-browser` — uses `-V` flag (not `--version`) for version detection
- `gm-cc`, `gm-oc`, `gm-gc`, `gm-kilo`, `gm-codex`: plugin tools

**binMap gotcha:** `checkCliInstalled()` and `getCliVersion()` both have a `binMap` object. Any new CLI tool must be added to BOTH. `agent-browser` uses `-V` (not `--version`) — a `versionFlag` override handles this.

**Background provisioning:** `autoProvision()` runs at startup, checks/installs missing tools (~10s). `startPeriodicUpdateCheck()` runs every 6 hours in background to check for updates. Both broadcast tool status via WebSocket so UI stays in sync.

### Tool Installation and Update UI Flow

When user clicks Install/Update button on a tool:

1. **Frontend** (`static/js/tools-manager.js`): Immediately updates status to 'installing'/'updating', sends POST, adds toolId to `operationInProgress` to prevent duplicates
2. **Backend** (`server.js`): Updates DB status, sends immediate `{ success: true }`, runs install/update async in background, broadcasts `tool_install_complete` or `tool_install_failed` on completion
3. **Frontend WebSocket Handler**: Listens for completion events, updates UI, removes from `operationInProgress`

## WebSocket Protocol

Endpoint: `BASE_URL + /sync`

**Wire format (msgpack binary):**
- Client RPC request: `{ r: requestId, m: method, p: params }`
- Server RPC reply: `{ r: requestId, d: data }` or `{ r: requestId, e: { c: code, m: message } }`
- Server push/broadcast: `{ type, seq, ...data }` or array of these when batched

**Legacy control messages** (bypass RPC router, handled in `onLegacy`): `subscribe`, `unsubscribe`, `ping`, `latency_report`, `terminal_*`, `pm2_*`, `set_voice`, `get_subscriptions`

Client sends:
- `{ type: "subscribe", sessionId }` or `{ type: "subscribe", conversationId }`
- `{ type: "unsubscribe", sessionId }`
- `{ type: "ping" }`

Server broadcasts:
- `streaming_start` - Agent execution started (high priority, flushes immediately)
- `streaming_progress` - New event/chunk from agent (normal priority, batched)
- `streaming_complete` - Execution finished (high priority)
- `streaming_error` - Execution failed (high priority)
- `message_created` - New message (high priority, flushes immediately)
- `conversation_created`, `conversation_updated`, `conversation_deleted`
- `all_conversations_deleted` - Must be in BROADCAST_TYPES set
- `model_download_progress` - Voice model download progress
- `voice_list` - Available TTS voices

**WSOptimizer** (`lib/ws-optimizer.js`): Per-client priority queue. High-priority events flush immediately; normal/low batch by latency tier (16ms excellent → 200ms bad). Rate limit: 100 msg/sec — overflow is re-queued (not dropped). No `lastKey` deduplication (was removed — caused valid event drops).

## Steering

Steering sends a follow-up prompt to a running agent via stdin JSON-RPC:
```js
// conv.steer handler sends to proc.stdin:
{ jsonrpc: '2.0', id: Date.now(), method: 'session/prompt', params: { sessionId, prompt: [{ type: 'text', text }] } }
```

**Process lookup:** `entry.proc` (set by `onProcess` callback on `activeExecutions` entry) OR `activeProcessesByConvId.get(id)`. Check both — race condition between `activeExecutions` being set and `onProcess` firing.

**Claude Code stdin:** `supportsStdin: true`, `closeStdin: false` in `lib/claude-runner.js`. Stdin must stay open for steering to work.

**Process lifetime:** After execution ends, process stays alive 30s (steeringTimeout) for follow-up steers. `conv.steer` resets timeout to another 30s on each steer.

## Execution State Management

Three parallel state stores (must stay in sync):
1. **In-memory maps:** `activeExecutions`, `activeProcessesByConvId`, `messageQueues`, `steeringTimeouts`
2. **Database:** `conversations.isStreaming`, `sessions.status`
3. **WebSocket clients:** `streamingConversations` Set on each client

**`cleanupExecution(conversationId)`** — atomic cleanup function in server.js. Always use this, never inline-delete from maps. Clears all maps, kills process, cancels timeout, sets DB isStreaming=0.

**Queue drain:** If `processMessageWithStreaming` throws, catch block calls `cleanupExecution` and retries drain after 100ms. Queue never deadlocks.

## Message Flow

1. User sends → `startExecution()` checks `streamingConversations.has(convId)`
2. If NOT streaming: show optimistic "User" message in UI
3. If streaming: skip optimistic (will queue server-side)
4. Send via RPC `msg.stream` → backend creates message + broadcasts `message_created`
5. Backend checks `activeExecutions.has(convId)`:
   - YES: queues, returns `{ queued: true }`, broadcasts `queue_status`
   - NO: executes, returns `{ session }`
6. Queue items render as yellow control blocks in `queue-indicator` div
7. `message_created` only broadcast for non-queued messages (ws-handlers-conv.js)
8. When queued message executes: becomes regular user message, queue-indicator updates

**Streaming session blocks:** `handleStreamingComplete()` removes `.event-streaming-start` and `.event-streaming-complete` DOM blocks to prevent accumulation in long conversations.

## Conversations Sidebar

`ConversationManager` in `static/js/conversations.js`:
- Polls `/api/conversations` every 30s
- On poll: if result is non-empty but smaller than cached list, **merges** (keeps cached items not in poll) rather than replacing — prevents transient server responses from dropping conversations
- On empty result with existing cache: keeps existing (server error assumption)
- `render()` uses DOM reconciliation by `data-conv-id` — reuses existing nodes, removes orphans
- `showEmpty()` and `showLoading()` both clear `listEl.innerHTML` — only called when appropriate
- `conversation_deleted` WS event handled in `setupWebSocketListener` — `deleteConversation()` filters array
- `confirmDelete()` calls `deleteConversation()` directly AND server broadcasts `conversation_deleted` — double-call is safe (filter is idempotent)

## Base64 Image Rendering in File Read Events

When an agent reads an image file, the event type may not be `'file_read'`. Three content structures exist:

**Structure A** (nested): `event.content.source.type === 'base64'`, data at `event.content.source.data`
**Structure B** (flat): `event.content.type === 'base64'`, data at `event.content.data`
**Structure C** (raw string): `event.content` is a base64 string detected by magic-byte prefix

`renderGeneric` checks for A and B first; if found with `event.path` present, delegates to `renderFileRead`. Without this fallback, non-`file_read` typed image events display as raw text.

MIME type priority: `event.media_type` → magic-byte detection (PNG/JPEG/WebP/GIF) → `application/octet-stream`.

## Voice Model Download

Speech models (~470MB total) are downloaded automatically on server startup. No credentials required.

### Download Sources (fallback chain)
1. **GitHub LFS** (primary): `https://github.com/AnEntrypoint/models`
2. **HuggingFace** (fallback): `onnx-community/whisper-base` for STT, `AnEntrypoint/sttttsmodels` for TTS

### Models
- **Whisper Base** (~280MB): encoder + decoder ONNX models, tokenizer, config files
- **TTS Models** (~190MB): mimi encoder/decoder, flow_lm, text_conditioner, tokenizer

### UI Behavior
- Voice tab hidden until models ready; circular progress indicator in header during download
- Model status broadcast via WebSocket `model_download_progress` events
- Cache location: `~/.gmgui/models/`

## Performance Notes

- **Static asset serving:** gzip-only (no brotli — too slow for payloads this size). Pre-compressed once on first request, cached in `_assetCache` Map (etag → `{ raw, gz }`). HTML cached as `_htmlCache` after first request, invalidated on hot-reload.
- **`/api/conversations` N+1 fix:** Uses `getActiveSessionConversationIds()` (single `DISTINCT` query) instead of per-conversation `getSessionsByStatus()` calls.
- **`conv.chunks` since-filter:** Pushed to DB via `getConversationChunksSince(convId, since)` — no JS array filter on full chunk set.
- **Client init:** `loadAgents()`, `loadConversations()`, `checkSpeechStatus()` run in parallel via `Promise.all()`.
- **`perMessageDeflate: false`** on WebSocket server — msgpack binary doesn't compress well, and zlib was blocking the event loop on every streaming_progress send.

## ACP SDK Integration

- **@agentclientprotocol/sdk** (`^0.4.1`) added to dependencies
- Full integration (replacing custom WS protocol) is optional/incremental — current WS already gives logical multiplexing via concurrent async handlers

## Known Gotchas

- **`agent-browser --version`** prints help, not version. Use `-V` flag.
- **`all_conversations_deleted`** must be in `BROADCAST_TYPES` set in server.js or it won't fan-out to all clients.
- **`streaming_start` and `message_created`** are high-priority in WSOptimizer — they flush immediately, not batched.
- **Sidebar animation:** `transition: none !important` in index.html CSS — sidebar snaps instantly on toggle by design.
- **Claude Code always runs with `--dangerously-skip-permissions`** (plugins disabled by design).
- **Tool status race on startup:** `autoProvision()` broadcasts `tool_status_update` for already-installed tools so the UI shows correct state before the first manual fetch.
- **Thinking blocks** are transient (not in DB), rendered only via `handleStreamingProgress()` in client.js. The `renderEvent` switch case for `thinking_block` is disabled to prevent double-render.
- **Terminal output** is base64-encoded (`encoding: 'base64'` field on message). Client decodes with `decodeURIComponent(escape(atob(data)))` pattern for multibyte safety.
- **HTML cache** (`_htmlCache`) is only populated when client accepts gzip. In watch mode it's never cached (always fresh).
