#!/bin/bash
set -e

echo "Starting integration test..."
echo

# Start server in background
echo "[1/3] Starting gmgui server..."
npm start &
SERVER_PID=$!
sleep 2

# Start mock agent in background
echo "[2/3] Starting mock agent..."
node examples/mock-agent.js --port 3001 --name "TestAgent" &
AGENT_PID=$!
sleep 2

# Start agent client
echo "[3/3] Connecting agent client..."
timeout 5 node examples/agent-client.js \
  --id test-agent \
  --gui http://localhost:3000 \
  --endpoint ws://localhost:3001 \
  --verbose &
CLIENT_PID=$!

sleep 3

# Cleanup
echo
echo "Stopping processes..."
kill $SERVER_PID 2>/dev/null || true
kill $AGENT_PID 2>/dev/null || true
kill $CLIENT_PID 2>/dev/null || true

echo "Integration test complete!"
