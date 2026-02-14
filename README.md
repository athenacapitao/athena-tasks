# Athena Tasks Dashboard

A lightweight task management API and dashboard for Wilson and Athena's collaborative workflow.

## What It Does

- **Task Management**: Create, update, track, and complete tasks with priority, status, and assignment
- **Project Organization**: Group tasks by project (capitao.consulting, PetVitaClub, Automation Tools, Personal)
- **Activity Logging**: Track all changes and progress with detailed activity history
- **Self-Verification**: Built-in verification system to ensure task completion quality
- **Dashboard UI**: Web interface at `http://127.0.0.1:7700` for visual task management

## Quick Start

### 1. Start the Server
```bash
cd /home/athena/.openclaw/workspace/athena-tasks
node server.js
```

The server runs on port 7700 by default.

### 2. Access the Dashboard
Open your browser to: [http://127.0.0.1:7700](http://127.0.0.1:7700)

### 3. API Authentication
All API calls require the bearer token:
```
-H "Authorization: Bearer $ATHENA_TASKS_TOKEN"
```

## API Overview

### Core Endpoints

| Method | Endpoint | Description |
|--------|----------|-------------|
| GET | `/api/tasks` | List tasks with filters |
| POST | `/api/tasks` | Create new task |
| PATCH | `/api/tasks/:id` | Update task |
| POST | `/api/tasks/:id/complete` | Complete task with report |
| POST | `/api/tasks/:id/verify` | Self-verify task completion |
| GET | `/api/dashboard` | Dashboard overview |

### Task Query Parameters
- `assigned_to`: wilson, athena, shared
- `status`: backlog, in_progress, blocked, in_review, done
- `priority`: critical, high, medium, low
- `sort`: priority (critical → high → medium → low)
- `overdue`: true (only overdue tasks)

### Task Completion
```bash
curl -X POST 'http://127.0.0.1:7700/api/tasks/:id/complete' \
  -H "Authorization: Bearer $ATHENA_TASKS_TOKEN" \
  -H 'Content-Type: application/json' \
  -d '{
    "summary": "Task completed successfully",
    "verified": true,
    "files_changed": ["path/to/file"],
    "time_spent_minutes": 15
  }'
```

## Task Worker Integration

The system integrates with OpenClaw's cron system for automated task processing:

1. **Task Worker Cron**: Runs periodically to process backlog tasks
2. **Self-Verification**: Automatic verification based on task tags
3. **Priority Queue**: Critical tasks processed first, overdue tasks prioritized
4. **Activity Logging**: All actions logged with timestamps

## Project Structure

- `server.js` - Main Express.js server
- `data.js` - In-memory data store with persistence
- `auth.js` - Authentication middleware
- `ui.html` - Dashboard web interface
- `data/` - JSON storage directory
- `seed.js` - Initial data seeding

## Development

### Adding New Features
1. Update `server.js` with new endpoints
2. Add corresponding UI components to `ui.html`
3. Update `PHASE*-TASKS.md` with verification steps
4. Test with `test-api.sh`

### Server Management
- Use `restart-server.sh` for clean restarts
- Check `server.log` for errors
- Monitor with `pgrep -f "node server.js"`

## Task Lifecycle

1. **Created** → Backlog
2. **Claimed** → In Progress
3. **Work** → Subtasks completed, activity logged
4. **Verified** → Self-verification checks
5. **Completed** → Final report, status Done

## Tags & Verification

Tasks can have tags that trigger automatic verification:
- `coding`: Run tests, check build
- `email`: Confirm sent, check bounce
- `scraping`: Validate output, check data shape
- `research`: Confirm output exists, cross-check facts
- `deployment`: curl URL, check 200 status
- `document`: Confirm file exists, size > 0

## License

Internal tool for Wilson and Athena's workflow.