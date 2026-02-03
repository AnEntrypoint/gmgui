# AgentGUI Recent Updates

## Overview
AgentGUI has been significantly enhanced to use local Claude Code OAuth authentication and provide rich, metadata-aware response rendering.

## Key Changes

### 1. OAuth Authentication via Local Claude Code
**File**: `acp-launcher.js`, `server.js`

- **Binary Discovery**: Automatically finds `claude-code-acp` in common installation locations
  - `/config/.gmweb/npm-global/bin/claude-code-acp`
  - `~/.local/bin/claude-code-acp`
  - Falls back to PATH if configured

- **PATH Management**: Enhanced environment variable handling to ensure npm global binaries are discoverable

- **Timeout Optimization**:
  - Initialize: 4s → 10s
  - Session creation: 4s → 30s
  - Mode setting: 2s → 10s
  - Handshake deadline: 5s → 60s

**Benefits**: 
- Uses existing Claude Code authentication
- No additional API key setup needed
- Seamless integration with system auth

### 2. Response Segmentation & Metadata Extraction
**Files**: `response-formatter.js`, `server.js`, `static/app.js`

#### ResponseFormatter
- Intelligent parsing of Claude responses into semantic units:
  - Code blocks (with language detection)
  - Headings (h1-h6)
  - Text paragraphs
  - Blockquotes
  - Lists

- Metadata extraction:
  - Tool calls and function names
  - Thinking/reasoning blocks
  - Task references
  - Subagent usage

- Proper formatting with inline code highlighting

#### Frontend Rendering
- `renderSegment()`: Beautiful display of each segment type
- `renderMetadata()`: Rich metadata sidebar with:
  - Tools used (with code highlighting)
  - Thinking blocks (collapsible details element)
  - Subagents employed
  - Tasks referenced

### 3. Rich HTML/RippleUI Responses
**Files**: `acp-launcher.js`, `static/app.js`

#### System Prompt Enhancement
Comprehensive instruction set forcing Claude to respond with HTML:
- RippleUI components (cards, alerts, tables, badges)
- Tailwind CSS styling
- Semantic HTML structure
- Code block formatting with language hints
- Never raw text - always wrapped HTML

#### HTML Detection Improvement
- Detects HTML by tags, structure, AND Tailwind classes
- Lower tag count threshold for detection (2 vs 3)
- Better recognition of styled components

### 4. Professional CSS Styling
**File**: `static/styles.css`

Added comprehensive styling for:
- Code blocks with language-specific colors
- Inline code with syntax highlighting
- Markdown formatting (bold, italic, code)
- Collapsible thinking blocks
- Metadata sections with visual hierarchy
- Print-friendly styles
- Dark mode support

### 5. Hot Reload Infrastructure
**File**: `hot-reload-manager.js`

Prepared for hot reloading:
- File watching with debouncing
- WebSocket-based reload signaling
- Graceful client-side reloading
- Ready for future implementation

## System Architecture

### Ports
- Production: **9897** (via system startup)
- Development: **3000** (via `npm start`)

### Request Flow
```
User Message
    ↓
API endpoint (/api/conversations/:id/messages)
    ↓
Server (processMessage)
    ↓
getACP() - Gets or creates connection
    ↓
conn.sendPrompt() - Sends to Claude Code via ACP bridge
    ↓
ResponseFormatter.segmentResponse()
    ↓
Database storage with segments + metadata
    ↓
Frontend display with rich rendering
```

### Connection Management
- ACP Pool: Maintains persistent connections per agent
- OAuth via local Claude Code credentials
- Graceful error handling and fallback
- Automatic reconnection

## Display Examples

### Segmented Response
Plain text becomes:
```
[Heading] Problem Analysis
[Text] Explanation paragraph
[Code] javascript function example
[Metadata] Tools used, reasoning blocks
```

### Metadata Display
- **Tools Used**: List of functions/tools called
- **Reasoning**: Collapsible thinking process
- **Subagents**: External agents employed  
- **Tasks**: Itemized task list

## Configuration

### Environment Variables
```bash
PORT=9897              # Server port (default: 3000)
BASE_URL=/gm          # Route prefix (default: /gm)
HOT_RELOAD=false      # Disable hot reload (default: true)
```

### Database
- Location: `~/.gmgui/data.db`
- Persists conversations, messages, sessions
- Auto-created on first run

## Testing

### Quick Start
```bash
npm start              # Start on port 3000
PORT=9897 npm start   # Start on port 9897
```

### Test Endpoints
```bash
# Get agents
curl http://localhost:3000/gm/api/agents

# Create conversation
curl -X POST http://localhost:3000/gm/api/conversations \
  -H "Content-Type: application/json" \
  -d '{"agentId": "claude-code", "title": "Test"}'

# Send message
curl -X POST http://localhost:3000/gm/api/conversations/{id}/messages \
  -H "Content-Type: application/json" \
  -d '{"agentId": "claude-code", "content": "Hello"}'

# Get messages
curl http://localhost:3000/gm/api/conversations/{id}/messages
```

## Future Enhancements

1. **Full Hot Reloading**: Complete implementation of HotReloadManager
2. **Streaming Responses**: Real-time message streaming to client
3. **Task Tracking**: Enhanced task and subagent visualization
4. **Export Functions**: Share/export conversations as HTML/PDF
5. **Theme Customization**: Allow user-defined themes

## Files Modified

- `acp-launcher.js` - OAuth and timeout fixes, system prompt
- `server.js` - Response segmentation, metadata extraction
- `static/app.js` - Rich rendering, HTML detection
- `static/styles.css` - Professional styling for all components
- `response-formatter.js` - NEW: Response parsing and formatting
- `hot-reload-manager.js` - NEW: Hot reload infrastructure

## Git Commits

1. **Fix OAuth Connection** - Binary discovery and PATH management
2. **Increase ACP Timeouts** - Proper timeout values for connection establishment
3. **Rich Response Formatting** - Segmentation and metadata rendering
4. **Enforce HTML Responses** - System prompt and detection improvements

---

**Last Updated**: February 3, 2026
**Version**: 1.0.15
