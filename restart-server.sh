#!/bin/bash

# Clean server restart for athena-tasks development
# This script handles server shutdown gracefully without SIGTERM confusion

# Kill any existing node server process (quietly)
pgrep -f "node server.js" > /dev/null && pkill -f "node server.js" 2>/dev/null

# Wait for process to fully terminate
sleep 1

# Verify it's gone
if pgrep -f "node server.js" > /dev/null; then
  echo "⚠️  Warning: server process still running, forcing kill"
  pkill -9 -f "node server.js" 2>/dev/null
  sleep 1
fi

# Start server in background
echo "🚀 Starting athena-tasks server..."
node server.js &
SERVER_PID=$!

echo "Server started with PID: $SERVER_PID"
echo "Listening on: http://127.0.0.1:7700"
