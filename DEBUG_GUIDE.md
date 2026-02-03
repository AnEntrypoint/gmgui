# Debug Guide - Conversation Display Issue

## Problem
Imported Claude Code conversations (83 total) are not visible in the chat list when the application loads, despite being stored in the database and returned by the API.

## API Status - ✅ VERIFIED
- Server is running on `http://localhost:9897`
- API endpoint `/api/conversations` returns 83 conversations
- Response structure is correct with proper ID, agentId, title, created_at, updated_at, status fields

## Debug Logging Added
We've added comprehensive debug logging to trace the initialization flow. The logging will help identify where conversations are being lost.

### Enhanced Logging Points:
1. **Init sequence** - Logs each step of initialization
2. **fetchConversations** - Logs API request, response status, data received
3. **renderAll** - Logs conversation count before rendering
4. **renderChatHistory** - Logs final conversation count and whether empty state is shown

## How to Debug

### Step 1: Open the Application
1. Open your web browser
2. Navigate to: `http://localhost:9897/gm/`
3. Press **F12** to open Developer Tools
4. Go to the **Console** tab

### Step 2: Look for Debug Logs
Watch for logs starting with `[DEBUG]`. You should see:

```
[DEBUG] Init: Starting initialization
[DEBUG] Init: Fetched home
[DEBUG] Init: Fetched agents, count: X
[DEBUG] Init: Auto-imported Claude Code conversations
[DEBUG] fetchConversations: Starting fetch from http://localhost:9897/gm/api/conversations
[DEBUG] fetchConversations: Response status: 200
[DEBUG] fetchConversations response count: 83
[DEBUG] fetchConversations response data: {...}
[DEBUG] fetchConversations: Cleared conversations map
[DEBUG] Loaded conversations, total: 83
[DEBUG] First few conversation IDs: [...]
[DEBUG] Init: Fetched conversations, count: 83
[DEBUG] Init: About to renderAll with 83 conversations
[DEBUG] renderAll: Called with 83 conversations
[DEBUG] renderChatHistory - conversations.size: 83
[DEBUG] renderChatHistory - sorted conversations count: 83
[DEBUG] Init: renderAll completed
```

### Step 3: Analyze the Logs

Check these specific values:

| Log | Expected | Issue If Different |
|-----|----------|-------------------|
| `response count: 83` | 83 | API not returning conversations |
| `Loaded conversations, total: 83` | 83 | Data not being added to map |
| `About to renderAll with 83 conversations` | 83 | Conversations lost between fetch and render |
| `renderChatHistory - conversations.size: 83` | 83 | Size changes between renderAll and renderChatHistory |
| `No conversations to display - showing empty state` | Should NOT appear | renderChatHistory shows empty when size > 0 |

### Step 4: Check Browser State
In the Console, type:
```javascript
// Check if conversations were loaded into the app
app.conversations.size

// Check the actual conversations
app.conversations

// Check first conversation
Array.from(app.conversations.values())[0]

// Check if BASE_URL is correct
BASE_URL
```

### Step 5: Check Network Tab
1. Go to **Network** tab in DevTools
2. Filter for `/api/conversations` request
3. Check:
   - Request Status: Should be 200
   - Response body: Should contain array of 83 conversations
   - Response headers: Should show correct content-type

## Possible Issues and Solutions

### Issue 1: API returns 0 conversations
**Symptom**: `response count: 0`
- Check: Is the database populated?
- Command: `sqlite3 /config/workspace/agentgui/data/gmgui.db "SELECT COUNT(*) FROM conversations;"`
- Fix: Import conversations or check database connection

### Issue 2: API returns data but conversations.size is 0
**Symptom**: `response count: 83` but `Loaded conversations, total: 0`
- Likely cause: Data structure mismatch or forEach not working
- Fix: Check if data.conversations is an array
- Check: Are the conversation objects being created properly?

### Issue 3: Conversations loaded but renderChatHistory shows empty
**Symptom**: `About to renderAll with 83 conversations` but `No conversations to display`
- Likely cause: Something clears conversations.map between renderAll and renderChatHistory
- Check: Look for any handleSyncEvent calls that might clear or reset conversations
- Fix: Add logging to sync event handlers

### Issue 4: Conversations load but don't display in UI
**Symptom**: All debug logs show 83 conversations, but chat list still shows "No chats yet"
- Likely cause: CSS hiding, DOM structure issue, or rendering issue
- Check: Look at HTML element with id="chatList" - is it hidden?
- Check: Are chat items being created in the DOM?
- Solution: Open Elements tab and expand chatList to see if items exist

## Next Steps After Debugging

1. **Identify the root cause** using the logs above
2. **Document which log shows the problem**
3. **Implement the appropriate fix**:
   - If API issue: Fix server endpoint
   - If data structure issue: Fix response parsing
   - If sync issue: Fix sync event handlers
   - If UI issue: Fix CSS or rendering logic
4. **Verify fix** with the debug logs
5. **Commit changes** to git

## File Locations
- Frontend code: `/config/workspace/agentgui/static/app.js`
- Server code: `/config/workspace/agentgui/server.js`
- Database: `/config/workspace/agentgui/data/gmgui.db`
- API responses return from: `/api/conversations` endpoint in server.js

## Important Notes
- Hot reload is enabled for CSS/HTML/frontend JS
- Debug logs will auto-reload in browser when app.js changes
- Check DevTools console IMMEDIATELY after loading the page
- Some logs may scroll off - use DevTools console filter to search for `[DEBUG]`
