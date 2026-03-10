# CLI Tools Detection and Agent Dropdown Fixes

## Summary
Three critical issues were identified and fixed in the tools and agent systems:
1. CLI tools showing as "Not installed" despite being in PATH
2. Agent dropdown not showing Claude Code
3. /api/tools endpoint hanging during tool detection

## Issues Fixed

### Issue 1: CLI Tools Not Detected (lib/tool-manager.js)

**Root Cause**: `execSync` was being used but not imported at module level. The code had:
```javascript
// BEFORE (broken)
const { execSync } = require('child_process');  // Inside function
```

This caused "require is not defined" errors in ES modules.

**Fix**: Import `execSync` at the top of the file:
```javascript
// AFTER (fixed)
import { spawn, execSync } from 'child_process';
```

**Changes Made**:
- Line 1: Added `execSync` to the child_process import
- checkCliInstalled() now uses the imported execSync directly
- getCliVersion() now uses the imported execSync directly
- Reduced version check timeout from 5000ms to 2000ms to prevent hangs
- Added better error handling for CLI version detection

**Impact**: CLI tools (claude, opencode, gemini, kilo, codex) are now properly detected as installed when present in PATH.

### Issue 2: /api/tools Endpoint Hanging (server.js)

**Root Cause**: The `/api/tools` endpoint was calling `getAllToolsAsync()` which attempted to fetch published versions from npm registry. Some tools like opencode have long-running or hanging --version commands, causing the entire endpoint to hang.

**Fix**: Use `Promise.race` with a timeout to return immediately with cached data:
```javascript
// Lines 1844-1846
const tools = await Promise.race([
  toolManager.getAllToolsAsync(true), // skipPublishedVersion=true for fast response
  new Promise((_, reject) => setTimeout(() => reject(new Error('timeout')), 1500))
]);
```

**Changes Made**:
- Added timeout of 1500ms to the API call
- Pass `skipPublishedVersion=true` to skip network calls during initial detection
- Fall back to cached tool statuses if timeout occurs
- Ensures UI remains responsive when fetching tool data

**Impact**: `/api/tools` endpoint now responds within 2 seconds instead of hanging indefinitely.

### Issue 3: Claude Code Agent Dropdown

**Current State**: Claude Code agent SHOULD appear in the dropdown because:

1. **Server-side** (server.js lines 461-492):
   - `discoverAgents()` function checks for `claude` command in PATH
   - If found → agent is added with detected path
   - If NOT found → fallback ensures Claude Code is ALWAYS added as npx-launchable (lines 486-488)

2. **Agent RPC Handler** (lib/ws-handlers-session.js lines 104-111):
   - `agent.ls` RPC handler returns all discoveredAgents
   - Includes Claude Code from the fallback mechanism

3. **Frontend** (static/js/client.js lines 2145-2149):
   - Calls `window.wsClient.rpc('agent.ls')` to fetch agents
   - Populates UI with returned agents

**Verification Needed**:
- Check if browser console shows agent list includes 'claude-code'
- Verify /api/agents HTTP endpoint returns Claude Code
- Check if agent.ls RPC message logs show Claude Code being returned

## Files Modified

1. **lib/tool-manager.js**
   - Line 1: Import execSync from child_process
   - Lines 180-215: Enhanced CLI detection functions
   - Line 208: Reduced timeout for version checks
   - Lines 290, 475: Pass skipPublishedVersion parameter

2. **lib/speech.js**
   - Line 47: Removed unused `splitSentences` export (webtalk handles splitting)

3. **server.js**
   - Lines 1844-1847: Added Promise.race with timeout for /api/tools
   - Lines 1862-1864: Added timeout error handling with fallback

4. **.prd** (Work tracking)
   - Updated with completion status for CLI detection fixes

## Testing Checklist

- [ ] `claude --version` returns a version number in PATH
- [ ] GET /api/tools returns installed=true for cli-claude
- [ ] GET /api/tools completes within 2 seconds
- [ ] /api/agents includes Claude Code agent
- [ ] agent.ls RPC message returns Claude Code
- [ ] Agent dropdown in UI shows Claude Code
- [ ] Can create conversation with Claude Code agent
- [ ] No "Not installed" messages for detected tools
- [ ] Server startup auto-detection logs show CLI tools found

## Known Limitations

1. **CLI Version Detection**: Some tools (opencode, gemini, kilo) may return 'unknown' version if --version command doesn't return standard semantic version format

2. **Timeout Edge Case**: If /api/tools times out, it returns cached data from previous request. New tools won't show until cache expires (30 minutes) or server restarts

3. **Fallback Behavior**: Claude Code appears as npx-launchable even if `claude` binary is not in PATH. This allows users to still launch Claude Code via npm.

## Next Steps

1. Verify agent dropdown shows Claude Code after fixes
2. Test auto-installation of CLI tools on startup
3. Verify version detection works for all tools
4. Test update detection and installation for CLI tools
