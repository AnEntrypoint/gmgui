#!/bin/bash
# End-to-end browser test execution script

set -e

echo "========================================="
echo "PHASE 0: PREPARATION"
echo "========================================="

cd /home/user/agentgui

# Create test directory
mkdir -p /tmp/test-repos
echo "✓ Test directory created"

echo ""
echo "========================================="
echo "PHASE 1: SERVER STARTUP"
echo "========================================="

# Start server in background
npm run dev > /tmp/server.log 2>&1 &
SERVER_PID=$!
echo "Server PID: $SERVER_PID"

# Wait for server to start
sleep 3

# Verify server is running
echo "Checking server on port 3000..."
if curl -s http://localhost:3000 > /dev/null 2>&1; then
    echo "✓ Server responding on port 3000"
else
    echo "✗ Server failed to start"
    kill $SERVER_PID 2>/dev/null || true
    exit 1
fi

echo ""
echo "========================================="
echo "PHASE 3: REPOSITORY SETUP"
echo "========================================="

cd /tmp/test-repos

# Clone lodash if not already cloned
if [ ! -d "lodash" ]; then
    echo "Cloning lodash..."
    git clone --depth 1 https://github.com/lodash/lodash lodash 2>&1 | head -5
fi

if [ -f "lodash/README.md" ]; then
    echo "✓ Lodash cloned successfully"
else
    echo "✗ Lodash clone failed"
    kill $SERVER_PID 2>/dev/null || true
    exit 1
fi

# Clone chalk if not already cloned
if [ ! -d "chalk" ]; then
    echo "Cloning chalk..."
    git clone --depth 1 https://github.com/chalk/chalk chalk 2>&1 | head -5
fi

if [ -f "chalk/README.md" ]; then
    echo "✓ Chalk cloned successfully"
else
    echo "✗ Chalk clone failed"
    kill $SERVER_PID 2>/dev/null || true
    exit 1
fi

echo ""
echo "========================================="
echo "REPOSITORIES READY FOR BROWSER TEST"
echo "========================================="
echo ""
echo "✓ Server running on http://localhost:3000"
echo "✓ Lodash repo: /tmp/test-repos/lodash"
echo "✓ Chalk repo: /tmp/test-repos/chalk"
echo ""
echo "Browser test can now proceed. Server PID: $SERVER_PID"
echo "To stop server: kill $SERVER_PID"
echo ""

# Keep server running
wait $SERVER_PID
