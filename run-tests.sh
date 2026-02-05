#!/bin/bash

echo "=========================================="
echo "AGENTGUI COMPREHENSIVE TEST EXECUTION"
echo "=========================================="
echo ""

# Check if server is already running
if lsof -i :3000 > /dev/null 2>&1; then
  echo "✓ Server already running on port 3000"
else
  echo "Starting server..."
  cd /home/user/agentgui
  npm run dev > /tmp/server.log 2>&1 &
  SERVER_PID=$!
  echo "Server PID: $SERVER_PID"

  # Wait for server to start
  sleep 3

  # Verify server is running
  if ! curl -s http://localhost:3000 > /dev/null 2>&1; then
    echo "✗ Server failed to start"
    cat /tmp/server.log
    exit 1
  fi
  echo "✓ Server started successfully"
fi

# Verify test repositories
echo ""
echo "Setting up test repositories..."

if [ ! -d "/tmp/test-repos/lodash" ]; then
  echo "Cloning lodash repository..."
  mkdir -p /tmp/test-repos
  git clone --depth 1 https://github.com/lodash/lodash /tmp/test-repos/lodash 2>/dev/null
fi

if [ ! -d "/tmp/test-repos/chalk" ]; then
  echo "Cloning chalk repository..."
  mkdir -p /tmp/test-repos
  git clone --depth 1 https://github.com/chalk/chalk /tmp/test-repos/chalk 2>/dev/null
fi

if [ -f "/tmp/test-repos/lodash/README.md" ] && [ -f "/tmp/test-repos/chalk/README.md" ]; then
  echo "✓ Both test repositories ready"
else
  echo "✗ Test repositories incomplete"
  exit 1
fi

# Run browser tests
echo ""
echo "Running browser tests..."
node /home/user/agentgui/real-browser-test.js

exit_code=$?

echo ""
echo "=========================================="
if [ $exit_code -eq 0 ]; then
  echo "✅ ALL TESTS PASSED - PRODUCTION READY"
else
  echo "⚠️ SOME TESTS FAILED - REVIEW RESULTS"
fi
echo "=========================================="

exit $exit_code
