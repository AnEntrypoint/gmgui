#!/bin/bash
cd /config/workspace/agentgui
git add server.js
git commit -m "fix: Tool update complete feedback with fresh version detection

- Use checkToolStatusAsync instead of checkToolStatus for fresh version detection
- Send complete freshStatus data in WebSocket completion events
- Includes isUpToDate, installed, upgradeNeeded, installedVersion, publishedVersion
- Fixes version detection and UI feedback after install/update
- Resolves stale cache issues preventing version change detection"
git push
