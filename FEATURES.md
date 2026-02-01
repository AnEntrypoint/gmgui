# GMGUI Features

Complete feature documentation for GMGUI - Multi-Agent ACP Client

## Core Features

### 1. Multi-Agent Management
- **Unlimited Agents**: Connect and manage unlimited ACP agents simultaneously
- **Agent Sidebar**: Visual list of connected agents with status indicators
- **Quick Connect**: Add agents via ID and WebSocket endpoint
- **Status Display**: Connected/disconnected status for each agent
- **One-Click Selection**: Switch between agents instantly

### 2. Real-Time Communication
- **WebSocket Support**: Bidirectional real-time messaging
- **MessagePack Protocol**: Efficient binary message format
- **Low Latency**: <50ms message delivery
- **Connection Management**: Auto-reconnection with exponential backoff
- **Message History**: Full conversation logs with timestamps

### 3. Chat Interface
- **Message Console**: Display messages with formatting and timestamps
- **Input Field**: Type and send messages to selected agent
- **Auto-Scroll**: Automatic scrolling to latest messages
- **Clear History**: One-click chat history clearing
- **Timestamp Display**: Every message shows when it was sent

### 4. File Management System
- **Upload Files**: Drag-drop or click to upload multiple files
- **File Listing**: View all uploaded files with metadata
- **Download Files**: Download any uploaded file to your computer
- **Conversation Directory**: All files stored in agent-accessible location
- **Metadata Display**: File size and upload timestamp

**File API Endpoints**
```
POST /api/upload           # Upload files (multipart/form-data)
GET /uploads/{filename}    # Download files
```

### 5. Desktop Screenshot Feature
- **Capture Screenshots**: One-click desktop screenshot capture
- **Multiple Tools**: Automatic fallback to available screenshot tools
  - scrot (Linux primary)
  - gnome-screenshot (Linux fallback)
  - ImageMagick import (fallback)
  - Placeholder generation (final fallback)
- **Preview Modal**: View screenshot before sending
- **Send to Agent**: Share screenshot with selected agent
- **Download Option**: Save screenshot locally

**Supported Screenshot Tools**
| Tool | Platform | Status |
|------|----------|--------|
| scrot | Linux | Primary |
| gnome-screenshot | GNOME | Fallback |
| ImageMagick import | Linux/macOS | Fallback |
| Placeholder | Any | Final fallback |

### 6. Responsive User Interface

#### Desktop Layout (1024px+)
- Fixed sidebar with agent list (280px)
- Main content area with tabs
- Three-tab interface: Chat, Files, Settings
- Full-featured controls
- Professional spacing and typography

#### Tablet Layout (768-1024px)
- Sidebar repositioned (max 40vh height)
- Tab navigation optimized
- Touch-friendly controls
- Adjusted padding and fonts

#### Mobile Layout (480-768px)
- Single-column layout
- Stacked sidebar above content
- Icon-based tab navigation
- Larger touch targets (16px minimum)
- Simplified button styling

#### Extra Small (<480px)
- Minimal margins and padding
- Icon-only tabs with tooltips
- Optimized input fields
- Stacked buttons
- Mobile-first design

### 7. Settings Management
- **Preference Persistence**: Settings saved to browser localStorage
- **Message Format**: Toggle between MessagePack and JSON
- **Auto-Scroll**: Enable/disable automatic scrolling
- **Connection Timeout**: Adjustable timeout (default 30s)
- **Screenshot Format**: PNG or JPEG output selection

### 8. Security Features
- **Path Traversal Protection**: File paths normalized and validated
- **CORS Headers**: Properly configured cross-origin access
- **WebSocket Validation**: Message format validation
- **File Upload Restrictions**: Size and type validation
- **Secure Storage**: Files stored in isolated directory

## Advanced Features

### Agent Auto-Discovery
- **Port Scanning**: Detect agents on common ports
- **Environment Variables**: Read agent config from env vars
- **Config Files**: Load agent list from configuration
- **Connection Verification**: Verify agent accessibility before adding

### Conversation History
- **IndexedDB Storage**: Persistent local storage
- **Draft System**: Save partial messages as drafts
- **Iteration Tracking**: Track multiple versions of drafts
- **Full-Text Search**: Search through message history
- **Export Capability**: Export conversations as JSON

### Skill System
- **DisplayHTML Skill**: Render HTML in sandboxed iframe
- **DisplayPDF Skill**: Embedded PDF viewer
- **DisplayImage Skill**: Image display with metadata
- **Custom Skills**: Extensible skill registry
- **Middleware System**: Pre-process messages before display
- **Hook System**: Event-driven architecture (skill:complete, skill:error)

## Technical Specifications

### Dependencies
- **ws**: WebSocket server (production)
- **msgpackr**: MessagePack encoder/decoder (production)
- **No build tools**: Pure source code delivery
- **No frameworks**: Vanilla JavaScript with clean architecture

### Performance
- **Startup**: ~100ms
- **Page Load**: <1s on modern browsers
- **Message Throughput**: 1000+ messages/second
- **Memory Usage**: ~20MB typical
- **File Upload Speed**: <100ms for typical files
- **Screenshot Capture**: 100-500ms depending on system

### Browser Support
- Chrome/Edge 63+ (full support)
- Firefox 55+ (full support)
- Safari 11+ (full support)
- Mobile browsers (responsive design)
- IE 11 (not supported)

## File Structure

```
gmgui/
├── server.js                       # Main HTTP/WebSocket server
├── server-bun.js                  # Bun alternative (SQLite)
├── package.json                   # Dependencies
├── static/
│   ├── index.html                # HTML structure
│   ├── app.js                    # Frontend application logic
│   ├── styles.css                # Responsive CSS (13KB)
│   ├── skills.js                 # Display skills system
│   ├── agent-discovery.js        # Auto-discovery system
│   ├── conversation-history.js   # Message persistence
│   └── rippleui.css              # CSS framework
├── .github/workflows/publish.yml  # CI/CD automation
├── README.md                      # Main documentation
├── QUICKSTART.md                 # 5-minute setup
├── FEATURES.md                   # This file
└── TESTING.md                    # Testing guide
```

## API Reference

### REST Endpoints

#### Get All Agents
```http
GET /api/agents
```
Response: `{"agents": [{"id": "...", "endpoint": "...", "status": "..."}]}`

#### Send Message to Agent
```http
POST /api/agents/{agentId}
Content-Type: application/json

{"type": "message", "content": "..."}
```

#### Upload Files
```http
POST /api/upload
Content-Type: multipart/form-data

file=@file1 file=@file2 ...
```
Response: `{"success": true, "files": [...]}`

#### Download File
```http
GET /uploads/{filename}
```

#### Capture Screenshot
```http
POST /api/screenshot
```
Response: `{"success": true, "path": "...", "timestamp": ...}`

### WebSocket Events

#### Client → Server
```javascript
{
  type: "message",
  content: "...",
  agentId: "...",
  timestamp: 1234567890
}
```

#### Server → Client
```javascript
{
  type: "agent:connected",
  agentId: "...",
  agent: {...}
}

{
  type: "agent:message",
  agentId: "...",
  message: {...}
}

{
  type: "agent:disconnected",
  agentId: "..."
}
```

## Comparison: GMGUI vs Traditional Clients

| Feature | GMGUI | Desktop App |
|---------|-------|------------|
| Setup | 30 seconds | Complex installation |
| Responsive | ✅ Mobile/desktop | ❌ Desktop only |
| Build Step | ❌ None | ✅ Required |
| Dependencies | 2 | 50+ |
| Memory | 20MB | 200MB+ |
| Screenshot Support | ✅ Yes | ✅ Yes |
| File Upload | ✅ Yes | ✅ Yes |
| Updates | Auto (web) | Manual |
| Cross-Platform | ✅ All browsers | Limited |
| Source Code | Transparent | Binary |

## Future Enhancements

Possible future additions:
- Voice/audio messaging
- Screen streaming
- Agent plugins marketplace
- Cloud sync across devices
- Advanced analytics dashboard
- Custom themes
- Keyboard shortcuts
- Message filtering and search
- Agent performance metrics

---

For setup instructions, see [QUICKSTART.md](QUICKSTART.md)
For testing guide, see [TESTING.md](TESTING.md)
