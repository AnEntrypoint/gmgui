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
static/js/features.js            Feature flags
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
- `tts_setup_progress` - Windows pocket-tts setup progress (step, status, message)

## Pocket-TTS Windows Setup (Reliability for Slow/Bad Internet)

On Windows, text-to-speech uses pocket-tts which requires Python and pip install. The setup process is now resilient to slow/unreliable connections:

### Features
- **Extended timeouts**: 120s for pip install (accommodates slow connections)
- **Retry logic**: 3 attempts with exponential backoff (1s, 2s delays)
- **Progress reporting**: Real-time updates via WebSocket to UI
- **Partial install cleanup**: Failed venvs are removed to allow retry
- **Installation verification**: Binary validation via `--version` check
- **Concurrent waiting**: Multiple simultaneous requests wait for single setup (600s timeout)

### Configuration (lib/windows-pocket-tts-setup.js)
```javascript
const CONFIG = {
  PIP_TIMEOUT: 120000,           // 2 minutes
  VENV_CREATION_TIMEOUT: 30000,  // 30 seconds
  MAX_RETRIES: 3,                 // 3 attempts
  RETRY_DELAY_MS: 1000,          // 1 second initial
  RETRY_BACKOFF_MULTIPLIER: 2,   // 2x exponential
};
```

### Network Requirements
- **Minimum**: 50 kbps sustained, < 5s latency, < 10% packet loss
- **Recommended**: 256+ kbps, < 2s latency, < 1% packet loss
- **Expected time on slow connection**: 2-6 minutes with retries

### Progress Messages
During TTS setup on first use, WebSocket broadcasts:
```json
{
  "type": "tts_setup_progress",
  "step": "detecting-python|creating-venv|installing|verifying",
  "status": "in-progress|success|error",
  "message": "descriptive status message with retry count if applicable"
}
```

### Recovery Behavior
1. Network timeout → auto-retry with backoff
2. Partial venv → auto-cleanup before retry
3. Failed verification → auto-cleanup and error
4. Concurrent requests → first starts setup, others wait up to 600s
5. Interrupted setup → cleanup allows fresh retry

### Testing
Setup validates by running pocket-tts binary with `--version` flag to confirm functional installation, not just file existence.

## Model Download Fallback Chain Architecture (Task 1C)

Three-layer resilient fallback for speech models (280MB whisper-base + 197MB TTS). Designed to eliminate single points of failure while maintaining backward compatibility.

### Layer 1: IPFS Gateway (Primary)

Decentralized distribution across three gateways with automatic failover:

```
Cloudflare IPFS     https://cloudflare-ipfs.com/ipfs/        Priority 1 (99.9% reliable)
dweb.link           https://dweb.link/ipfs/                  Priority 2 (99% reliable)
Pinata              https://gateway.pinata.cloud/ipfs/       Priority 3 (99.5% reliable)
```

**Model Distribution**:
- Whisper Base (280MB): `TBD_WHISPER_HASH` → encoder (78.6MB) + decoder (198.9MB) + configs
- TTS Models (197MB): `TBD_TTS_HASH` → mimi_encoder (73MB) + decoders + text_conditioner + flow_lm

**Characteristics**: 30s timeout per gateway, 2 retries before fallback, SHA-256 per-file verification against IPFS-stored manifest

### Layer 2: HuggingFace (Secondary)

Current working implementation via webtalk package. Proven reliable with region-dependent latency.

```
Whisper  https://huggingface.co/onnx-community/whisper-base/resolve/main/
TTS      https://huggingface.co/datasets/AnEntrypoint/sttttsmodels/resolve/main/tts/
```

**Characteristics**: 3 retries with exponential backoff (2^attempt seconds), 30s timeout, file size validation (minBytes thresholds: encoder ≥40MB, decoder ≥100MB, TTS files ≥18-61MB range)

**Implementation Location**: webtalk/whisper-models.js, webtalk/tts-models.js (unchanged, wrapped by fallback logic)

### Layer 3: Local Cache + Fallbacks

**Primary Cache**: `~/.gmgui/models/` with manifest at `~/.gmgui/models/.manifests.json`

**Verification Algorithms**:
1. Size check (minBytes threshold) → corrupted: delete & retry
2. SHA-256 hash against manifest → mismatch: delete & re-download
3. ONNX format validation (header check) → invalid: delete & escalate to primary

**Bundled Models** (future): `agentgui/bundled-models.tar.gz` (~50-80MB) for offline-first deployments

**Peer-to-Peer** (future): mDNS discovery for LAN sharing across multiple AgentGUI instances

### Download Decision Logic

```
1. Check local cache validity → RETURN if valid, record cache_hit metric
2. TRY PRIMARY (IPFS): attempt 3 gateways sequentially, 2 retries each
   - VERIFY size + sha256 → ON SUCCESS: record primary_success, return
3. TRY SECONDARY (HuggingFace): 3 attempts with exponential backoff
   - VERIFY file size → ON SUCCESS: record secondary_success, return
4. TRY TERTIARY (Bundled): extract tarball if present
   - VERIFY extraction → ON SUCCESS: record tertiary_bundled_success, return
5. TRY TERTIARY (Peer): query mDNS if enabled, fetch from peer
   - VERIFY checksum → ON SUCCESS: record tertiary_peer_success, return
6. FAILURE: record all_layers_exhausted metric, throw error (optional: activate degraded mode)
```

### Metrics Collection

**Storage**: `~/.gmgui/models/.metrics.json` (append-only, rotated daily)

**Per-Download Fields**: timestamp, modelType, layer, gateway, status, latency_ms, bytes_downloaded/total, error_type/message

**Aggregations**: per-layer success rate, per-gateway success rate, avg latency per layer, cache effectiveness

**Dashboard Endpoints**:
- `GET /api/metrics/downloads` - all metrics
- `GET /api/metrics/downloads/summary` - aggregated stats
- `GET /api/metrics/downloads/health` - per-layer health
- `POST /api/metrics/downloads/reset` - clear history

### Cache Invalidation Strategy

**Version Manifest** (`~/.gmgui/models/.manifests.json`):
```json
{
  "whisper-base": {
    "currentVersion": "1.0.0",
    "ipfsHash": "QmXXXX...",
    "huggingfaceTag": "revision-hash",
    "downloadedAt": "ISO8601",
    "sha256": { "file": "hash...", ... }
  },
  "tts-models": { ... }
}
```

**Version Mismatch Detection** (on startup + periodic background check):
- Query HuggingFace API HEAD for latest revision
- Query IPFS gateway for latest dag-json manifest
- If new version: log warning, set flag in `/api/status`, prompt user (not auto-download)
- If corrupted: quarantine to `.bak`, mark invalid, trigger auto-download from primary on next request

**Stale Cache Handling**:
- Max age: 90 days → background check queries IPFS for new hash
- Stale window: 7 days after max age → serve stale if live fetch fails
- Offline degradation: serve even if 365 days old when network down

**Cleanup Policy**:
- Backup retention: 1 previous version (`.bak`) for 7 days
- Failed downloads: delete `*.tmp` after 1 hour idle
- Old versions: delete if > 90 days old
- Disk threshold: warn if `~/.gmgui/models` exceeds 2GB

### Design Rationale

**Why Three Layers?** IPFS (decentralized, no SPoF) + HuggingFace (proven, existing) + Local (offline-ready, LAN-resilient)

**Why Metrics First?** Enables data-driven gateway selection, identifies reliability in production, guides timeout/retry tuning

**Why No Auto-Upgrade?** User controls timing, allows staged rollout, supports version pinning, reduces surprise breakage

**Why Bundled Models?** Enables air-gapped deployments, reduces network load, supports edge environments with poor connectivity

### Implementation Roadmap

| Phase | Description | Priority |
|-------|-------------|----------|
| 1 | Integrate IPFS gateway discovery (default configurable) | HIGH |
| 2 | Refactor `ensureModelsDownloaded()` to use fallback chain | HIGH |
| 3 | Add metrics collection to download layer | HIGH |
| 4 | Implement manifest-based version tracking | MEDIUM |
| 5 | Add stale-while-revalidate background checks | MEDIUM |
| 6 | Integrate bundled models option | LOW |
| 7 | Add peer-to-peer discovery | LOW |

### Critical TODOs Before Implementation

1. Publish whisper-base to IPFS → obtain ipfsHash
2. Publish TTS models to IPFS → obtain ipfsHash
3. Create manifest templates for both models
4. Design metrics storage schema (SQLite vs JSON)
5. Plan background check scheduler
6. Define dashboard UI for metrics visualization
