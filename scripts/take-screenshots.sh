#!/usr/bin/env bash
set -eu

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
DOCS_DIR="$SCRIPT_DIR/../docs"
SESSION="agentgui-screenshots"
LOG_FILE="/config/logs/services/agentgui.log"

PORT=$(grep -oP 'localhost:\K[0-9]+(?=/gm/)' "$LOG_FILE" 2>/dev/null | tail -1)
PORT="${PORT:-9897}"
BASE_URL="http://localhost:$PORT/gm/"

ab() {
  agent-browser --session "$SESSION" "$@"
}

cleanup() {
  agent-browser --session "$SESSION" close 2>/dev/null || true
}
trap cleanup EXIT

echo "Taking screenshots from $BASE_URL"
echo "Saving to $DOCS_DIR"

ab open "$BASE_URL"
ab wait --load networkidle
sleep 1

ab screenshot --full "$DOCS_DIR/screenshot-main.png"
echo "Saved screenshot-main.png"

ab eval 'document.querySelector(".conversation-item")?.click()'
sleep 3
ab wait --load networkidle
sleep 2

# Wait for conversation content to render
ab eval '(async()=>{for(let i=0;i<20;i++){if(document.querySelector("#output .event-block, #output .message-block")){return"ready"}await new Promise(r=>setTimeout(r,500))}return"timeout"})()'
sleep 1

# Scroll down to show action content
ab eval 'var s=document.getElementById("output-scroll")||document.getElementById("output");if(s){s.scrollTop=Math.min(s.scrollHeight*0.4,800)}'
sleep 1

ab screenshot --full "$DOCS_DIR/screenshot-chat.png"
echo "Saved screenshot-chat.png"

ab screenshot --full "$DOCS_DIR/screenshot-conversation.png"
echo "Saved screenshot-conversation.png"

ab eval 'var b=document.getElementById("toolsManagerBtn"); if(b){b.style.display="";b.click();}'
sleep 1

ab screenshot --full "$DOCS_DIR/screenshot-tools-popup.png"
echo "Saved screenshot-tools-popup.png"

ab eval 'var p=document.getElementById("toolsPopup"); if(p)p.classList.remove("open");'
sleep 0.5

ab eval 'document.querySelector(".view-toggle-btn[data-view=\"files\"]")?.click()'
sleep 2
ab wait --load networkidle

ab screenshot --full "$DOCS_DIR/screenshot-files.png"
echo "Saved screenshot-files.png"

ab eval 'document.querySelector(".view-toggle-btn[data-view=\"terminal\"]")?.click()'
sleep 3

# Wait for terminal to have content
ab eval '(async()=>{for(let i=0;i<10;i++){var t=document.querySelector("#terminalOutput .xterm-screen");if(t&&t.textContent.trim().length>5)return"ready";await new Promise(r=>setTimeout(r,500))}return"timeout"})()'
sleep 1

ab screenshot --full "$DOCS_DIR/screenshot-terminal.png"
echo "Saved screenshot-terminal.png"

echo "All screenshots saved to $DOCS_DIR"
