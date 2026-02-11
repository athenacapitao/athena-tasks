# Server Management Guide

## Quick Start: Restart Server

```bash
./restart-server.sh
```

This script:
1. Gracefully stops any running `node server.js` process
2. Waits for clean shutdown
3. Starts a fresh instance in background
4. Reports the new PID

## Manual Server Restart

When developing and testing API changes, you'll need to restart the server frequently:

### Step 1: Stop Running Server
```bash
# Check if running (quiet check)
pgrep -f "node server.js" > /dev/null

# Kill if running (suppresses stderr)
pgrep -f "node server.js" > /dev/null && pkill -f "node server.js" 2>/dev/null

# Wait for clean shutdown
sleep 1
```

### Step 2: Start New Instance
```bash
# Start in background
node server.js &

# Or use helper script
./restart-server.sh
```

## Testing API After Restart

```bash
# Quick health check
curl -s http://127.0.0.1:7700/api/health

# Test with auth (get token from .env)
curl -s -H "Authorization: Bearer $(grep AUTH_TOKEN .env | cut -d= -f2)" \
  http://127.0.0.1:7700/api/tasks
```

## Common Scenarios

### Scenario 1: Server Won't Start (Port in Use)
```bash
# Find process using port 7700
lsof -i :7700

# Or check if node server is running
ps aux | grep "node server.js" | grep -v grep

# Kill it
pkill -f "node server.js"
```

### Scenario 2: Lock File Stuck (ELOCKED Error)
```bash
# Remove lock file if server crashed
rm -f /home/athena/.openclaw/workspace/athena-tasks/data/tasks.json.lock

# Restart server
./restart-server.sh
```

### Scenario 3: Background Process Cleanup
```bash
# List all background node processes
ps aux | grep node

# Kill specific background session (if using exec with sessionId)
# Use process tool: process action:kill sessionId:XXX
```

## Production vs Development

**Development** (current):
- Run in background: `node server.js &`
- Manual restarts for code changes
- Logs go to stdout/stderr

**Production** (future):
- Use systemd user service: `systemctl --user start athena-tasks`
- Auto-restart on crash
- Systemd handles PID management
- Logs: `journalctl --user -u athena-tasks -f`

## Important Notes

1. **SIGTERM is normal**: When using exec tool, you may see "Command aborted by signal SIGTERM" — this is the SHELL process being cleaned up, NOT the node server itself. If the server restart works, ignore it.

2. **Don't use pkill blindly**: Always check with `pgrep` first to avoid errors when server isn't running.

3. **Wait for shutdown**: Always `sleep 1` after killing to ensure process fully terminates before starting new one.

4. **Verify restart**: Check logs or run a health check to confirm server actually started.

## Background Session Management (with OpenClaw process tool)

When using OpenClaw's background sessions:

```bash
# Start server in background session
exec pty:true workdir:/home/athena/.openclaw/workspace/athena-tasks \
  background:true \
  command:"node server.js"
# Returns: sessionId for tracking

# Monitor logs
process action:log sessionId:XXX

# Check if still running
process action:poll sessionId:XXX

# Kill the session
process action:kill sessionId:XXX
```

This approach tracks the server lifecycle properly and provides clean logs.
