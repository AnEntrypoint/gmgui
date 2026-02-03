# Automatic Continuous Importing Feature

## Overview
AgentGUI now automatically and continuously imports Claude Code conversations **without requiring any user action**. This ensures conversations are always available and up-to-date.

## How It Works

### Server-Side (Every 30 Seconds)
```
Server startup
    ↓
[IMMEDIATE] Import Claude Code conversations (first run)
    ↓
[EVERY 30 SECONDS] Auto-import new conversations
    ↓
If new conversations found:
  • Add them to database
  • Broadcast 'conversations_updated' event to all connected clients
  • Log: "[AUTO-IMPORT] Imported X new Claude Code conversations"
```

### Frontend-Side
```
Page loads
    ↓
[IMMEDIATE] Fetch conversations from API
    ↓
[EVERY 10 SECONDS] Fetch conversations again (as fallback)
    ↓
[ON SYNC EVENT] Receive 'conversations_updated' from server
    ↓
Immediately refresh conversation list
    ↓
Users see new conversations appear in real-time
```

## Key Features

✅ **Automatic**: No user action needed  
✅ **Continuous**: Runs every 30 seconds (server) and 10 seconds (client)  
✅ **Real-time**: New conversations appear immediately via WebSocket  
✅ **No Duplicates**: Skips conversations already imported  
✅ **Cross-tab**: Broadcasts via BroadcastChannel API  
✅ **Resilient**: Fallback mechanism if WebSocket fails  
✅ **Logging**: All imports logged for debugging  

## Where Conversations Come From

### Automatically Discovered From:
1. **Claude Code Projects** (~/.claude/projects/)
   - Scans sessions-index.json files
   - Reads .jsonl message files
   - Imports with "[project] title" format

2. **Created in AgentGUI**
   - New conversations created via UI
   - Automatically stored in database

## Example Flow

### Scenario: User Uses Claude Code, Then Opens AgentGUI

```
11:00:00 - User creates conversation in Claude Code
11:00:15 - AgentGUI server detects new conversation in ~/.claude/projects/
11:00:20 - Server imports conversation automatically
11:00:20 - Server broadcasts 'conversations_updated' event
11:00:21 - All connected browser tabs receive update
11:00:21 - Users see new conversation appear in sidebar
```

### Scenario: Multiple Tabs Open

```
Tab 1 opens AgentGUI
Tab 2 opens AgentGUI (few seconds later)

Tab 1 receives 'conversations_updated' from server
Tab 1 uses BroadcastChannel to notify Tab 2
Tab 2 also refreshes conversation list
Both tabs show latest conversations in sync
```

## Server Logs

You'll see logs like:
```
[AUTO-IMPORT] Imported 2 new Claude Code conversations (42 already exist)
[AUTO-IMPORT] Imported 1 new Claude Code conversation (43 already exist)
[AUTO-IMPORT] (nothing new this cycle)
```

## Client Logs

In browser console:
```
[SYNC] Server imported 3 new conversations, refreshing...
[DEBUG] Init: Auto-imported Claude Code conversations
[DEBUG] Loaded conversations, total: 86
```

## Configuration

### Import Frequency (Server)
Current: **30 seconds**
Location: `server.js` line `setInterval(performAutoImport, 30000);`

To change:
```javascript
setInterval(performAutoImport, 60000); // 60 seconds
setInterval(performAutoImport, 5000);  // 5 seconds
```

### Refresh Frequency (Client)
Current: **10 seconds**
Location: `app.js` line `setInterval(() => { ... }, 10000);`

To change:
```javascript
}, 60000);  // 60 seconds
}, 5000);   // 5 seconds
```

## Data Flow Diagram

```
┌─────────────────────────────────────────────────────┐
│ Claude Code                                          │
│ ~/.claude/projects/*/sessions-index.json            │
└─────────────────┬───────────────────────────────────┘
                  │ (monitors every 30s)
                  ↓
┌─────────────────────────────────────────────────────┐
│ AgentGUI Server                                      │
│ • queries.importClaudeCodeConversations()           │
│ • Stores in ~/.gmgui/data.db                        │
│ • Broadcasts via WebSocket                          │
└──────┬──────────────────────────┬────────────────────┘
       │                          │
       │ (WebSocket event)        │ (HTTP API)
       ↓                          ↓
┌─────────────────────────────────────────────────────┐
│ Browser (Frontend)                                   │
│ • Listens on sync WebSocket                         │
│ • Receives 'conversations_updated' event            │
│ • Calls fetchConversations()                        │
│ • Calls renderChatHistory()                         │
└──────┬──────────────────────────────────────────────┘
       │
       ↓
┌─────────────────────────────────────────────────────┐
│ Chat Sidebar                                         │
│ • Displays conversation list                        │
│ • User can click to view conversation               │
└─────────────────────────────────────────────────────┘
```

## Troubleshooting

### Conversations Not Appearing

**Check 1: Server Auto-Import**
```bash
# Look for these logs in server output
grep "\[AUTO-IMPORT\]" server.log

# If no logs, auto-import might not be running
```

**Check 2: Claude Code Availability**
```bash
# Check if Claude Code projects exist
ls -la ~/.claude/projects/

# Count projects with conversations
find ~/.claude/projects -name "sessions-index.json" | wc -l
```

**Check 3: Browser Sync**
```javascript
// In browser console
// Check if WebSocket is connected
console.log('WebSocket state:', app.syncWs.ws?.readyState);

// Try manual refresh
await app.fetchConversations();
app.renderChatHistory();
```

**Check 4: Database**
```bash
# Check total conversations in DB
node -e "
const DB = require('better-sqlite3');
const db = new DB(process.env.HOME + '/.gmgui/data.db');
const count = db.prepare('SELECT COUNT(*) as c FROM conversations').get();
console.log('Database has:', count.c, 'conversations');
db.close();
"
```

### Too Many Import Logs

If server logs are too verbose:
1. Increase `setInterval` time (30000 → 60000 or more)
2. Add log level filtering

### Conversations Take Too Long to Appear

If new conversations take > 1 minute:
1. Check server auto-import interval (default 30s)
2. Check client refresh interval (default 10s)
3. Check network connectivity
4. Check browser console for errors

## Performance Considerations

### Import Impact
- **Minimal**: Import skips existing conversations
- **Fast**: Only processes new conversations
- **Efficient**: Uses database transactions

### Client Impact
- **WebSocket**: Real-time updates, low bandwidth
- **Polling**: Every 10 seconds, minimal traffic
- **Rendering**: Only updates when conversations change

## Security Notes

- Only imports from user's local `.claude/projects/`
- No external network access needed
- All conversations stored locally
- Respects filesystem permissions

## Future Enhancements

Potential improvements:
- Configurable import interval via UI
- Import from multiple sources
- Batch import optimization
- Import history/logs viewer
- Import statistics dashboard
- Per-project import settings

## Testing

### Manual Test: Add Claude Code Conversation
```bash
# 1. Use Claude Code (creates ~/.claude/projects/*/sessions-index.json)
# 2. Wait up to 30 seconds
# 3. Check browser - should see new conversation appear
# 4. Confirm console logs show "[AUTO-IMPORT] Imported X..."
```

### Manual Test: Force Import
```javascript
// In browser console
await fetch('/gm/api/import/claude-code')
  .then(r => r.json())
  .then(d => console.log('Manual import result:', d));

// Then refresh
await app.fetchConversations();
app.renderChatHistory();
```

## Related Files

- `server.js` - Server auto-import implementation
- `app.js` - Frontend sync handling
- `database.js` - Query functions
- `acp-launcher.js` - Claude Code connection

## Changelog

### Version 1.1.0 (Current)
- ✅ Added automatic server-side importing every 30 seconds
- ✅ Added WebSocket broadcast for instant updates
- ✅ Added client-side sync event handler
- ✅ Integrated with existing periodic sync

### Version 1.0.0 (Previous)
- Manual import on demand via `/api/import/claude-code`
- No automatic background importing
