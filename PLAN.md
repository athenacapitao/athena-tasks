# Athena Task Dashboard — System Architecture & Implementation Plan v2

**Version:** 2.0
**Date:** 2026-02-09
**Codename:** athena-tasks
**Author:** Wilson Capitão
**For:** Athena (OpenClaw Agent) + Wilson (Human)

---

## Table of Contents

1. Executive Summary
2. System Architecture & Diagrams
3. Data Architecture
4. REST API Specification
5. Athena Integration — The Execution Engine
6. Task Lifecycle & State Machine
7. UI Design Specification
8. Notification & Communication Layer
9. History, Archiving & Reporting
10. Security
11. 10-Phase Implementation Roadmap
12. Success Metrics & KPIs

---

## 1. Executive Summary

A lightweight, self-hosted task management platform purpose-built for human–agent collaboration on the OpenClaw Gateway. The dashboard serves as the single source of truth for all work between Wilson (human) and Athena (AI agent).

**Hard constraints:**
- JSON file storage on VPS — zero external database dependencies
- Dark theme, minimal UI — fast on mobile, fast on desktop
- Accessible via SSH tunnel over Tailscale
- Athena reads/writes tasks via REST API using OpenClaw tools (exec with curl)
- Wilson reads/writes tasks via browser UI
- Complete audit trail — nothing is ever hard-deleted, only archived
- Token-efficient — Athena's reports and API calls minimize LLM token consumption

**What this borrows from professional task managers:**
- From Jira: Typed workflows with explicit state transitions, sub-tasks, activity logs
- From Asana: Project-as-container model, multiple views of the same data, completion celebrations
- From Trello: Card-based simplicity, single-screen visibility, drag-like quick-actions
- From Monday.com: Status-color visual encoding, timeline awareness, automations
- From Linear: Keyboard-first UX, minimal chrome, priority-driven queues, cycles

**What this intentionally omits (scope control):**
- No Gantt charts, no time-tracking beyond per-task estimates
- No user accounts or role-based permissions (two users: Wilson and Athena)
- No real-time WebSocket sync (polling on 5s interval is sufficient)
- No file upload storage (link to GDrive/GitHub instead)
- No recurring tasks engine (use OpenClaw cron directly)

---

## 2. System Architecture

### 2.1 Network Topology

**Machine: Wilson's MacBook (macOS)**
- IP on Tailscale: (dynamic)
- Runs: SSH client, web browser
- Access pattern: SSH tunnel forwards local ports to VPS

**Machine: VPS (Linux, Ubuntu)**
- Hostname: capitao-server
- IP on Tailscale: 100.93.247.25
- OS user: athena
- Runs: Two Node.js processes (OpenClaw Gateway + athena-tasks)

**Connection:**
```
Wilson MacBook --[Tailscale VPN]--> VPS (100.93.247.25)
SSH command: ssh -L 18789:127.0.0.1:18789 -L 7700:127.0.0.1:7700 athena@100.93.247.25
```

This forwards:
- localhost:18789 on MacBook → 127.0.0.1:18789 on VPS (OpenClaw Gateway UI)
- localhost:7700 on MacBook → 127.0.0.1:7700 on VPS (athena-tasks dashboard)

**Process Map on VPS:**

**Process 1: OpenClaw Gateway**
- Binary: node (openclaw)
- Listening: 127.0.0.1:18789 (WebSocket + HTTP)
- Managed by: systemd user unit "openclaw-gateway"
- Contains: Athena AI agent, cron scheduler, tool executor, channel router
- Outbound: Telegram Bot API, Gmail SMTP, GitHub API, web_search, web_fetch

**Process 2: athena-tasks server**
- Binary: node server.js
- Listening: 127.0.0.1:7700 (HTTP only)
- Managed by: systemd user unit "athena-tasks"
- Contains: Express REST API + static HTML UI
- Storage: JSON files at /home/athena/.openclaw/workspace/athena-tasks/data/

**Communication between processes:**
- OpenClaw Gateway → athena-tasks: HTTP requests via `exec` tool (curl to 127.0.0.1:7700)
- Direction: One-way (OpenClaw calls athena-tasks API)
- Auth: Bearer token in Authorization header
- When: During heartbeat checks, cron job runs, and manual Athena commands
- athena-tasks → OpenClaw Gateway: NONE (athena-tasks never calls OpenClaw)

### 2.2 Process Architecture

**VPS — capitao-server (127.0.0.1)**

**PROCESS 1: OpenClaw Gateway (:18789)**
- Cron Scheduler
- Heartbeat Runner (every 30m)
- Telegram Channel (inbound/outbound)
- Athena Agent (LLM runtime, Model: zai/glm-4.7)
  - Workspace: /home/athena/.openclaw/workspace/
  - Tools: exec, read, write, browser, web_search, etc.
- exec tool runs: curl http://127.0.0.1:7700/api/*

**PROCESS 2: athena-tasks server (:7700)**
- Express Router: GET /api/*, POST /api/*, PATCH /api/*
- Auth Middleware (Bearer token) — Validates all /api/* calls
- Static Files: GET / (Serves to Wilson's browser via ui.html)
- Data Layer (JSON file I/O with file locking)
  - Files: data/tasks.json, data/projects.json, data/archive/*.json, data/backups/*.json

**SSH tunnel over Tailscale:**
- localhost:7700 → 127.0.0.1:7700

**Wilson's MacBook:**
- Browser: Safari
- URL: localhost:7700

### 2.3 Data Flow Diagram

**FLOW 1: Wilson creates task via browser UI**
1. Wilson types in browser form at localhost:7700
2. Browser JavaScript sends POST /api/tasks to localhost:7700
3. SSH tunnel forwards to VPS 127.0.0.1:7700
4. Express receives request, validates Bearer token
5. Server reads data/tasks.json, appends new task, writes back
6. Returns 201 with new task JSON
7. Browser updates UI optimistically

**FLOW 2: Athena creates task via OpenClaw tools**
1. Athena decides to create task (during cron job, heartbeat, or conversation)
2. Agent uses `exec` tool to run: curl -X POST http://127.0.0.1:7700/api/tasks ...
3. Express receives request, validates Bearer token
4. Server reads data/tasks.json, appends new task, writes back
5. Returns 201 with new task JSON
6. Athena logs creation in daily memory file

**FLOW 3: Athena checks for and executes pending tasks**
1. Cron job fires every 30 minutes (or heartbeat triggers check)
2. Agent uses `exec` tool: curl http://127.0.0.1:7700/api/tasks?assigned_to=athena&status=backlog&sort=priority
3. Server returns array of pending tasks sorted by priority
4. If tasks exist, Athena picks the first one (highest priority)
5. Athena calls PATCH /api/tasks/:id with status="in_progress"
6. Athena executes the work using OpenClaw tools (exec, write, browser, etc.)
7. Athena calls POST /api/tasks/:id/verify with verification results
8. Athena calls POST /api/tasks/:id/complete with report
9. Server updates task, sets status="done", records completed_at
10. If task was high/critical priority: Athena sends Telegram notification to Wilson

**FLOW 4: Email auto-creates task**
1. Thread monitoring cron (9am/4pm UTC) checks email
2. Athena reads new email from authorized sender via himalaya
3. Email contains actionable request
4. Athena calls POST /api/tasks with created_by="email" and source metadata
5. Athena sends Telegram notification to Wilson: "Auto-task created from email: {title}"
6. Wilson reviews task in dashboard, can edit/delete/approve

**FLOW 5: Wilson views dashboard**
1. Wilson opens browser to localhost:7700
2. Server serves ui.html (single static file)
3. Browser JavaScript calls GET /api/dashboard for summary stats
4. Browser calls GET /api/tasks for task list
5. Browser calls GET /api/projects for project list
6. UI renders everything client-side
7. Auto-polls GET /api/tasks every 5 seconds for updates

### 2.4 File System Layout

```
/home/athena/.openclaw/workspace/
├── athena-tasks/                         # <-- THIS PROJECT
│   ├── server.js                          # Express server (~500 lines)
│   ├── ui.html                           # Complete frontend (~1000 lines)
│   ├── package.json                      # Dependencies: express, proper-lockfile
│   ├── .env                              # AUTH_TOKEN=xxx, PORT=7700
│   ├── node_modules/                     # npm install (gitignored)
│   └── data/                             # ALL persistent state lives here
│       ├── tasks.json                    # Active tasks array
│       ├── projects.json                 # Projects array
│       ├── archive/                      # Monthly completed task archives
│       │   ├── tasks-2026-02.json
│       │   └── tasks-2026-03.json
│       └── backups/                      # Hourly snapshots (48h rolling)
│           ├── tasks-2026-02-09-14.json
│           └── tasks-2026-02-09-15.json
│
├── skills/
│   └── athena-tasks/
│       └── SKILL.md                      # OpenClaw skill definition
│
├── HEARTBEAT.md                          # Modified: add task dashboard check
├── SOUL.md                               # Unchanged
├── MEMORY.md                             # Unchanged
├── USER.md                               # Unchanged
└── memory/
    └── YYYY-MM-DD.md                     # Daily logs (unchanged)
```

### 2.5 Technology Stack

| Layer | Choice | Rationale |
|-------|--------|-----------|
| Runtime | Node.js v22 (already installed for OpenClaw) | Zero new system dependencies |
| Server | Express.js v4 | Single-file, battle-tested, 50k+ weekly downloads |
| Storage | JSON files on disk + proper-lockfile | Human-readable, git-friendly, no binary deps |
| Frontend | Single HTML file (vanilla JS + CSS) | No build step, no framework, <50KB total |
| Auth | Bearer token (shared secret in .env) | Sufficient for localhost-only binding |
| Process | systemd user unit | Auto-restart on crash, survives VPS reboots |

---

## 3. Data Architecture

### 3.1 Why JSON Files Over SQLite

| Criterion | JSON Files | SQLite |
|-----------|------------|--------|
| Athena fallback access | read/write tools directly | Needs sqlite3 CLI |
| Human readability | Open in any editor | Needs viewer |
| Backup | cp tasks.json tasks.bak | .dump or copy binary |
| Diff/version control | git diff works perfectly | Binary, not diffable |
| Expected volume | Hundreds of tasks | Would handle millions (overkill) |
| Dependencies | Zero binary deps | Needs native sqlite3 binding |
| ACID transactions | No (mitigated by file locking) | Yes |
| Complex queries | No (filter in memory) | Yes |

**Decision: JSON files.** The trade-off of no ACID is acceptable at this scale. File locking + hourly backups provide sufficient safety.

### 3.2 Task Schema (Complete)

```json
{
  "id": "t_1707480000_a1b2c3",
  "title": "Build landing page for PetVitaClub",
  "description": "Create a responsive landing page with email capture form. Requirements:\n- Hero section with product photos\n- Email capture via Mailchimp\n- Mobile responsive\n- Deploy to capitao.consulting/petvita",
  "project_id": "proj_petvitaclub",
  "status": "in_progress",
  "priority": "high",
  "assigned_to": "athena",
  "created_by": "wilson",
  "tags": ["coding", "frontend", "launch"],
  "deadline": "2026-02-15T23:59:00Z",
  "created_at": "2026-02-09T10:30:00Z",
  "updated_at": "2026-02-09T14:22:00Z",
  "completed_at": null,
  "subtasks": [
    { "id": "st_001", "title": "Design wireframe", "done": true },
    { "id": "st_002", "title": "Build HTML/CSS", "done": true },
    { "id": "st_003", "title": "Add email capture backend", "done": false },
    { "id": "st_004", "title": "Deploy to server", "done": false }
  ],
  "report": null,
  "activity": [
    { "at": "2026-02-09T10:30:00Z", "by": "wilson", "action": "created", "detail": null },
    { "at": "2026-02-09T14:22:00Z", "by": "athena", "action": "status_changed", "detail": "backlog -> in_progress" },
    { "at": "2026-02-09T14:25:00Z", "by": "athena", "action": "comment", "detail": "Starting wireframe. Using brand colors from GDrive." }
  ],
  "links": {
    "github_issue": null,
    "github_pr": null,
    "gdrive_doc": null,
    "email_thread": null
  },
  "source": {
    "type": "manual",
    "sender": null,
    "subject": null,
    "received_at": null,
    "raw_excerpt": null
  }
}
```

**Field constraints:**

| Field | Type | Required | Allowed Values |
|-------|------|----------|----------------|
| id | string | Auto-generated | t_{unix_ms}_{random_hex_6} |
| title | string | Yes (min 3 chars) | Free text, max 200 chars |
| description | string | No | Free text, max 5000 chars |
| project_id | string | No (defaults to "proj_personal") | Must reference existing project |
| status | string | Auto (defaults "backlog") | backlog, in_progress, blocked, in_review, done |
| priority | string | No (defaults "medium") | critical, high, medium, low |
| assigned_to | string | No (defaults "shared") | wilson, athena, shared |
| created_by | string | Auto | wilson, athena, email, system |
| tags | string[] | No | Array of lowercase strings |
| deadline | string/null | No | ISO 8601 datetime or null |
| subtasks | object[] | No | Array of {id, title, done} |
| links | object | No | All fields nullable strings |
| source | object | Auto | Set for email/system-created tasks |

**Report schema (set on completion):**

```json
{
  "summary": "One paragraph max describing what was done and how.",
  "files_changed": ["/path/to/file1", "/path/to/file2"],
  "time_spent_minutes": 45,
  "verified": true,
  "verified_at": "2026-02-10T08:15:00Z",
  "verification_notes": "Page loads on mobile+desktop. Form submits correctly."
}
```

### 3.3 Project Schema

```json
{
  "id": "proj_petvitaclub",
  "name": "PetVitaClub",
  "code": "PVC",
  "description": "Natural pet food e-commerce — validation phase",
  "status": "active",
  "color": "#10B981",
  "created_at": "2026-02-01T00:00:00Z",
  "links": {
    "website": "https://petvitaclub.com",
    "gdrive_folder": "https://drive.google.com/drive/folders/...",
    "github_repo": "https://github.com/athenacapitao/petvitaclub"
  }
}
```

**Project field constraints:**

| Field | Type | Required | Allowed Values |
|-------|------|----------|----------------|
| id | string | Auto | proj_{slug} |
| name | string | Yes | Max 60 chars |
| code | string | Yes | 2-5 uppercase letters |
| status | string | Auto (defaults "active") | active, paused, completed, archived |
| color | string | No (auto-assigned) | Hex color code |
| links | object | No | All fields nullable URL strings |

**Seed projects (created in Phase 1):**

| ID | Name | Code | Color |
|----|------|------|-------|
| proj_capitao | capitao.consulting | CAP | #3B82F6 (blue) |
| proj_petvitaclub | PetVitaClub | PVC | #10B981 (green) |
| proj_automation | Automation Tools | AUT | #8B5CF6 (purple) |
| proj_personal | Personal | PER | #6B7280 (gray) |

---

## 4. REST API Specification

### 4.1 Authentication

Every /api/* request requires:
- Header: `Authorization: Bearer <AUTH_TOKEN>`
- Token is stored in .env file
- Unauthenticated requests return 401 { "error": "Unauthorized" }
- The root path GET / serves ui.html without authentication (the UI itself handles token entry via localStorage)

### 4.2 Endpoints — Tasks

**GET /api/tasks** — List tasks with filters

**GET /api/tasks/:id** — Get single task with all fields

**POST /api/tasks** — Create new task

**PATCH /api/tasks/:id** — Update task fields (partial update)

**DELETE /api/tasks/:id** — Soft-delete (moves to archive)

**POST /api/tasks/:id/activity** — Append activity entry (comment, note)

**POST /api/tasks/:id/complete** — Set status=done + attach report

**POST /api/tasks/:id/reopen** — Move done task back to backlog

**POST /api/tasks/:id/verify** — Attach self-verification result

**POST /api/tasks/:id/subtasks** — Add subtask

**PATCH /api/tasks/:id/subtasks/:stid** — Toggle subtask done/undone

**DELETE /api/tasks/:id/subtasks/:stid** — Remove subtask

**GET /api/tasks query parameters:**

| Param | Type | Default | Example |
|-------|------|----------|---------|
| status | comma-separated string | all | ?status=backlog,in_progress |
| priority | comma-separated string | all | ?priority=critical,high |
| project_id | string | all | ?project_id=proj_petvitaclub |
| assigned_to | string | all | ?assigned_to=athena |
| created_by | string | all | ?created_by=email |
| tag | string | all | ?tag=coding |
| overdue | boolean | false | ?overdue=true |
| search | string | none | ?search=landing%20page (searches title+description) |
| sort | string | priority | ?sort=deadline (priority, deadline, created_at, updated_at) |
| order | string | asc for priority, desc for dates | ?order=desc |
| include_done | boolean | false | ?include_done=true |
| limit | integer | 100 | ?limit=20 |
| offset | integer | 0 | ?offset=20 |

Priority sort order: critical=0, high=1, medium=2, low=3 (ascending = most urgent first).

### 4.3 Endpoints — Projects

**GET /api/projects** — List all projects with computed task stats

**GET /api/projects/:id** — Get single project + its tasks

**POST /api/projects** — Create new project

**PATCH /api/projects/:id** — Update project fields

**Computed _stats field on each project** (calculated at read time, not stored):

```json
{
  "_stats": {
    "total": 12,
    "backlog": 3,
    "in_progress": 2,
    "blocked": 1,
    "in_review": 0,
    "done": 6,
    "completion_pct": 50,
    "overdue": 1,
    "critical_count": 2
  }
}
```

### 4.4 Endpoints — Dashboard & History

**GET /api/dashboard** — Aggregated overview (project stats, urgent items, recent activity)

**GET /api/history** — Paginated completed tasks (?page=1&per_page=20&project_id=...)

**GET /api/health** — Server health check (returns uptime, task count, disk usage)

**POST /api/backup** — Trigger manual backup of tasks.json

### 4.5 Example Calls — Athena via curl

```bash
# Check pending work (Athena runs this every heartbeat/cron)
curl -s "http://127.0.0.1:7700/api/tasks?assigned_to=athena&status=backlog&sort=priority&limit=1" \
  -H "Authorization: Bearer $ATHENA_TASKS_TOKEN"

# Claim a task
curl -s -X PATCH "http://127.0.0.1:7700/api/tasks/t_1707480000_a1b2c3" \
  -H "Authorization: Bearer $ATHENA_TASKS_TOKEN" \
  -H "Content-Type: application/json" \
  -d '{"status": "in_progress"}'

# Add progress comment
curl -s -X POST "http://127.0.0.1:7700/api/tasks/t_1707480000_a1b2c3/activity" \
  -H "Authorization: Bearer $ATHENA_TASKS_TOKEN" \
  -H "Content-Type: application/json" \
  -d '{"by": "athena", "action": "comment", "detail": "Wireframe complete. Starting CSS."}'

# Mark subtask done
curl -s -X PATCH "http://127.0.0.1:7700/api/tasks/t_1707480000_a1b2c3/subtasks/st_002" \
  -H "Authorization: Bearer $ATHENA_TASKS_TOKEN" \
  -H "Content-Type: application/json" \
  -d '{"done": true}'

# Complete with report
curl -s -X POST "http://127.0.0.1:7700/api/tasks/t_1707480000_a1b2c3/complete" \
  -H "Authorization: Bearer $ATHENA_TASKS_TOKEN" \
  -H "Content-Type: application/json" \
  -d '{
    "summary": "Landing page built and deployed. Responsive grid, Mailchimp form, nginx proxy.",
    "files_changed": ["/var/www/petvita/index.html"],
    "time_spent_minutes": 45,
    "verified": true,
    "verification_notes": "Loads on mobile+desktop. Test email received."
  }'
```

---

## 5. Athena Integration — The Execution Engine

### 5.1 Integration Points

OpenClaw has three trigger mechanisms that interact with the task dashboard:

**TRIGGER 1: Heartbeat (every ~30 minutes, main session)**
- Context: Runs in Athena's main session with conversation history.
- Purpose: Quick check — are there pending tasks?
- Action:
  1. GET /api/tasks?assigned_to=athena&status=backlog&sort=priority&limit=1
  2. If result is empty: skip (HEARTBEAT_OK)
  3. If result has tasks: execute the first one (see Task Execution Protocol)
- Token cost: Minimal (one curl call + response parsing)
- Modified file: HEARTBEAT.md (add task check to checklist)

**TRIGGER 2: Task Worker Cron (every 30 minutes, isolated session)**
- Context: Runs in isolated session, no conversation carry-over.
- Purpose: Dedicated task execution with clean context.
- Action:
  1. GET /api/tasks?assigned_to=athena&status=backlog&sort=priority&limit=3
  2. If empty: exit silently
  3. If tasks: pick first, claim it, execute, verify, complete
  4. If time/tokens remain: pick next task
- Token cost: Moderate (full agent turn per task)
- OpenClaw cron config:
  - Name: "Task Worker"
  - Schedule: "*/30 * * * *"
  - Session: isolated
  - Delivery: announce (summary to main session)

**TRIGGER 3: Direct Wilson Command (main session, on-demand)**
- Context: Wilson messages Athena directly via Telegram.
- Example: "Check the task board and work on the highest priority item"
- Action: Athena queries API, picks task, executes
- Token cost: Full conversation turn

**TRIGGER 4: Email Thread Monitor (existing cron, 9am/4pm UTC)**
- Context: Existing cron job checks email threads.
- Addition: If email contains actionable request from authorized sender:
  1. POST /api/tasks (create task with source.type="email")
  2. Send Telegram notification to Wilson
- Token cost: Minimal (one POST call added to existing job)

### 5.2 Task Execution Protocol

This is the step-by-step procedure Athena follows for every task. Each step includes the specific API call.

**Step 1: DISCOVER**
- API: GET /api/tasks?assigned_to=athena&status=backlog&sort=priority&limit=1
- Result: Array of tasks. If empty, stop.
- Pick: First task in array (highest priority, earliest deadline).

**Step 2: CLAIM**
- API: PATCH /api/tasks/:id body: {"status": "in_progress"}
- API: POST /api/tasks/:id/activity body: {"by":"athena","action":"started","detail":"Beginning work"}
- Purpose: Prevents double-claiming. Other triggers will see status=in_progress and skip.

**Step 3: PLAN (internal, no API call)**
- Read task description and subtasks.
- Determine which OpenClaw tools are needed.
- For coding tasks: identify repo, files, testing approach.
- For research tasks: identify sources, output format.
- For email tasks: identify recipients, thread context.

**Step 4: EXECUTE**
- Use OpenClaw tools: exec, write, read, browser, web_search, etc.
- For each subtask completed:
  - API: PATCH /api/tasks/:id/subtasks/:stid body: {"done": true}
- For significant progress:
  - API: POST /api/tasks/:id/activity body: {"by":"athena","action":"comment","detail":"Progress note"}

**Step 5: SELF-VERIFY**
- Verification depends on task type (see Verification Matrix below).
- API: POST /api/tasks/:id/verify body: {"verified": true/false, "notes": "verification details"}
- If verification fails:
  - Attempt fix, re-verify (max 2 retries).
  - If still failing: set status="blocked", notify Wilson.

**Step 6: COMPLETE**
- API: POST /api/tasks/:id/complete body: {
    "summary": "1-2 sentences max",
    "files_changed": ["list of files"],
    "time_spent_minutes": N,
    "verified": true,
    "verification_notes": "1 sentence"
  }
- Task status is automatically set to "done" by the server.
- completed_at is automatically set by the server.

**Step 7: NOTIFY (conditional)**
- If task.priority is "critical" or "high":
  - Send Telegram to Wilson: "✅ Done: {title} — {summary}"
- If task.priority is "medium" or "low":
  - No notification. Visible in dashboard.

**Step 8: NEXT (if cron worker has budget remaining)**
- Go back to Step 1.
- Max 3 tasks per cron run to control token spend.

### 5.3 Self-Verification Matrix

| Task Type (by tag) | Verification Steps |
|-------------------|-------------------|
| coding | Run tests if they exist. Check build succeeds. If web: load URL, check HTTP 200. |
| email | Confirm via himalaya that email left sent folder. Check no immediate bounce. |
| scraping | Validate output is non-empty. Check data shape (has expected fields). Sample 3 rows. |
| research | Confirm output file exists and has content. Cross-check 1 key fact against a second source. |
| deployment | HTTP GET the deployed URL. Check response status 200. Check response body contains expected string. |
| document | Confirm file exists. Check file size > 0. If PDF/docx: validate with a quick read. |
| configuration | Run relevant status command. Confirm expected output. |
| other | Check that described deliverable exists. Log "manual verification recommended". |

### 5.4 Priority Queue Order

When multiple tasks are in backlog, Athena processes them in this order (the API sort handles this):

**Priority ranking (ascending number = do first):**
- Rank 1: critical + overdue → IMMEDIATE. Drop everything.
- Rank 2: critical + due today → IMMEDIATE.
- Rank 3: critical + due this week → Next available slot.
- Rank 4: high + overdue → Next after critical.
- Rank 5: high + due today → Next.
- Rank 6: high + due this week → Next.
- Rank 7: medium + overdue → When available.
- Rank 8: medium + has deadline → When available.
- Rank 9: medium + no deadline → Filler work.
- Rank 10: low → Only when queue is empty.

**Tie-breaking within same rank:**
1. Earlier deadline wins
2. Earlier created_at wins (FIFO)

**Server implements this via sort function:**
- Primary sort: priority_weight (critical=0, high=10, medium=20, low=30)
- Secondary sort: deadline proximity (-overdue_days for overdue, +days_until for future)
- Tertiary sort: created_at ascending

### 5.5 Token Budget Management

Athena's token usage per task interaction:

| Operation | Estimated Tokens |
|-----------|------------------|
| Heartbeat check (GET + parse) | ~200 tokens |
| Claim + status update | ~150 tokens |
| Simple task execution | ~2,000-5,000 tokens |
| Complex coding task | ~10,000-30,000 tokens |
| Completion report | ~300 tokens |
| Total per simple task | ~3,000-6,000 tokens |
| Total per complex task | ~11,000-31,000 tokens |

**Token efficiency rules for Athena:**
1. Reports are max 2 sentences for summary, 1 sentence for verification
2. Activity comments are max 1 sentence
3. Never dump full file contents in reports — reference file paths instead
4. Subtask names are max 60 characters
5. Task Worker cron: max 3 tasks per run (budget cap)

---

## 6. Task Lifecycle & State Machine

### 6.1 State Transitions

**States and their meanings:**
- BACKLOG = Task exists, not started. Waiting in queue.
- IN_PROGRESS = Someone (Wilson or Athena) is actively working on it.
- BLOCKED = Cannot proceed. Waiting on external input or dependency.
- IN_REVIEW = Work complete, pending verification.
- DONE = Verified complete. Immutable (except reopen).

**Valid transitions (source -> target : who can trigger : how):**
- BACKLOG -> IN_PROGRESS : Wilson or Athena : PATCH status
- BACKLOG -> BLOCKED : Wilson or Athena : PATCH status (pre-blocked dependency)
- BACKLOG -> DONE : Wilson : PATCH status (instant complete for trivial tasks)
- IN_PROGRESS -> BLOCKED : Wilson or Athena : PATCH status (hit a wall)
- IN_PROGRESS -> IN_REVIEW : Athena : POST /verify (auto-moves if verified=true)
- IN_PROGRESS -> DONE : Wilson : POST /complete (Wilson skips review)
- BLOCKED -> BACKLOG : Wilson or Athena : PATCH status (unblocked, back to queue)
- BLOCKED -> IN_PROGRESS : Wilson or Athena : PATCH status (unblocked, resume immediately)
- IN_REVIEW -> DONE : Wilson or Athena : POST /complete
- IN_REVIEW -> IN_PROGRESS : Wilson : PATCH status (review failed, back to work)
- DONE -> BACKLOG : Wilson : POST /reopen (needs more work)

**Invalid transitions (server rejects):**
- DONE -> IN_PROGRESS (must reopen to backlog first)
- DONE -> BLOCKED (must reopen first)
- Any state -> BACKLOG for Athena (only Wilson can move things backward, except BLOCKED->BACKLOG)

**Visual flow:**
```
┌─────────┐    ┌─────────────┐    ┌───────────┐    ┌──────┐
│ BACKLOG │───>│ IN_PROGRESS │───>│ IN_REVIEW │───>│ DONE │
└────┬────┘    └──────┬──────┘    └─────┬─────┘    └──┬───┘
     │               │                  │              │
     ▼               │                  │
┌───────────┐        │                  │
│ BLOCKED   │<─────────────┘              │
└───────────┘                              │
<──────────────────────────────────────────────┘
              (reopen)
```

### 6.2 Automatic Side Effects

When certain transitions happen, the server automatically performs additional actions:

**Transition: ANY -> IN_PROGRESS**
- Server sets: updated_at = now
- Server appends to activity: {action: "status_changed", detail: "X -> in_progress"}

**Transition: ANY -> BLOCKED**
- Server sets: updated_at = now
- Server appends to activity: {action: "blocked", detail: from request body}

**Transition: ANY -> DONE (via /complete endpoint)**
- Server sets: status = "done"
- Server sets: completed_at = now
- Server sets: updated_at = now
- Server sets: report = from request body
- Server appends to activity: {action: "completed", detail: report.summary}

**Transition: DONE -> BACKLOG (via /reopen endpoint)**
- Server sets: status = "backlog"
- Server sets: completed_at = null
- Server sets: report = null (cleared)
- Server sets: updated_at = now
- Server appends to activity: {action: "reopened", detail: reason from request body}

**Any PATCH to status:**
- Server validates transition is allowed (see valid transitions above)
- Server rejects invalid transitions with 400 error
- Server always sets updated_at = now

---

## 7. UI Design Specification

### 7.1 Design Philosophy

MINIMAL → FUNCTIONAL → BEAUTIFUL (in that order, never reversed)

Borrowed from Linear's design principles:
- One screen does it all — No multi-page navigation
- Information density over whitespace — Show data, not chrome
- Keyboard-first, touch-friendly — Power users and phone users equally served
- Color means something — Every color is a data signal, not decoration

### 7.2 Color System (Dark Theme)

```css
:root {
  /* Background hierarchy (darkest to lightest) */
  --bg-base: #0D0D0D;      /* Page background */
  --bg-surface: #161616;    /* Cards, task rows */
  --bg-elevated: #1E1E1E;   /* Modals, dropdowns, inputs */
  --bg-hover: #252525;      /* Interactive hover */

  /* Text hierarchy */
  --text-primary: #E5E5E5;  /* Titles, body */
  --text-secondary: #888888;  /* Labels, metadata */
  --text-muted: #555555;    /* Disabled, placeholder */

  /* Borders */
  --border: #2A2A2A;        /* Default */
  --border-focus: #404040;   /* Focused inputs */

  /* Status colors — muted, never neon */
  --status-backlog: #6B7280;      /* Gray */
  --status-in-progress: #3B82F6;  /* Blue */
  --status-blocked: #EF4444;      /* Red */
  --status-in-review: #F59E0B;    /* Amber */
  --status-done: #10B981;         /* Green */

  /* Priority indicators — dots/bars only */
  --priority-critical: #DC2626;
  --priority-high: #F97316;
  --priority-medium: #EAB308;
  --priority-low: #6B7280;

  /* Accent */
  --accent: #3B82F6;           /* Primary buttons, links */
  --accent-hover: #2563EB;
}
```

### 7.3 Typography

```css
/* Primary: Inter (load from Google Fonts, fallback to system) */
font-family: 'Inter', -apple-system, system-ui, sans-serif;

/* Monospace: for IDs, code, tags */
font-family: 'SF Mono', 'JetBrains Mono', 'Consolas', monospace;

/* Scale */
--text-xs: 11px;   /* Timestamps, metadata */
--text-sm: 13px;   /* Secondary labels, tags */
--text-base: 14px;  /* Body, descriptions */
--text-lg: 16px;    /* Task titles */
--text-xl: 20px;    /* Section headers */
```

### 7.4 Page Layout

**UI LAYOUT — DESKTOP (>640px)**

Full viewport, no scrolling for header/footer. Content area scrolls.

```
┌──────────────────────────────────────────────────────────────────────┐
│ HEADER BAR — fixed, height: 48px, bg: --bg-surface, border-bottom │
│                                                                    │
│ Left: Logo text "athena-tasks" (--text-secondary, 13px)            │
│ Center: (empty)                                                    │
│ Right: Search icon (🔍) | New Task button (+ New)                 │
│                                                                    │
├──────────────────────────────────────────────────────────────────────┤
│ PROJECT TABS — height: 40px, horizontal scroll, bg: --bg-base     │
│                                                                    │
│ [ALL (12)] [capitao.consulting (5)] [PetVitaClub (4)] [Auto (3)] │
│                                                                    │
│ Each tab shows: project name + active task count                   │
│ Active tab: underline with project color, text --text-primary      │
│ Inactive tab: text --text-secondary                                │
│ Click tab: filters task list to that project                      │
│                                                                    │
├──────────────────────────────────────────────────────────────────────┤
│ FILTER ROW — height: 36px, bg: --bg-base                          │
│                                                                    │
│ [Status ▾] [Priority ▾] [Assigned ▾] [Tags ▾]                     │
│                                                                    │
│ Each is a dropdown/pill filter. Active filters show as pills.      │
│ Clear all filters: "✕ Clear" link on right side.                    │
│                                                                    │
├──────────────────────────────────────────────────────────────────────┤
│ TASK LIST — flex-grow, scrollable                                   │
│                                                                    │
│ Each task is a row, height: 56px, bg: --bg-surface, border-bottom │
│                                                                    │
│ ┌─ 3px priority color bar (left edge)                             │
│ │                                                                │
│ │ ┌─ Checkbox (click to quick-complete) ──────────── Right side:  │
│ │ │                                                            │
│ │ │ TITLE (16px, medium, --text-primary) [STATUS PILL] [AVATAR]│
│ │ │ Project · tag1 tag2 · Due Feb 15 ████░░ 3/5               │
│ │ │ (13px, --text-secondary) (subtask bar)                      │
│ │ │                                                            │
│ │ If overdue: deadline shows in red "⚠ OVERDUE Feb 12"          │
│ │ If blocked: row has subtle red-tinted background               │
│ │                                                            │
│ Click row → opens DETAIL PANEL (right side)                       │
│                                                                │
│ ... more task rows ...                                            │
│                                                                │
│ ▸ Done (24) — collapsed section, click to expand                 │
│ Shows completed tasks in muted style, most recent first             │
│                                                                │
├──────────────────────────────────────────────────────────────────────┤
│ FOOTER BAR — fixed, height: 28px, bg: --bg-surface                │
│                                                                    │
│ Left: "12 active · 24 done · 1 overdue"                            │
│ Right: "Synced 2s ago" (auto-updates)                             │
│                                                                    │
└──────────────────────────────────────────────────────────────────────┘
```

**UI LAYOUT — DETAIL PANEL**

When a task row is clicked, a panel slides in from the right.
Width: 420px on desktop, full screen on mobile.
Background: --bg-surface with left border.

```
┌──────────────────────────────────────┐
│ ← Back                [⋮ More]      │ 48px header
├──────────────────────────────────────┤
│                                      │
│ TITLE (20px, semibold)              │ Editable on click
│ Build landing page for PetVitaClub  │
│                                      │
│ ┌────────────┐ ┌─────────────┐       │ Inline dropdowns
│ │Status: ▾ │ │Priority: ▾  │       │ Click to change
│ │IN_PROGRESS│ │HIGH         │       │
│ └────────────┘ └─────────────┘       │
│ ┌────────────┐ ┌─────────────┐       │
│ │Assigned: ▾│ │Project: ▾   │       │
│ │Athena     │ │PetVitaClub  │       │
│ └────────────┘ └─────────────┘       │
│                                      │
│ Deadline: Feb 15, 2026 [Edit]        │
│ Tags: coding · frontend · launch     │
│                                      │
│ ─── DESCRIPTION ───────────────────── │
│                                      │
│ Create a responsive landing page      │
│ with email capture form...          │ Editable textarea
│                                      │
│ ─── SUBTASKS (3/5) ────────────── │
│                                      │
│ ✓ Design wireframe                  │ Click checkbox
│ ✓ Build HTML/CSS                   │ to toggle
│ ☐ Add email capture backend         │
│ ☐ Deploy to server                 │
│ [+ Add subtask]                     │
│                                      │
│ ─── LINKS ───────────────────────── │
│                                      │
│ GitHub Issue #3                     │ Clickable links
│ GDrive Doc                          │
│ [+ Add link]                        │
│                                      │
│ ─── ACTIVITY ────────────────────── │
│                                      │
│ Athena · 2h ago                    │ Reverse-chronological
│ Starting wireframe. Using brand     │
│ colors from GDrive.                │
│                                      │
│ Athena · 3h ago                    │
│ Status: backlog → in_progress      │
│                                      │
│ Wilson · 5h ago                    │
│ Created task                        │
│                                      │
│ ┌──────────────────────────────────┐ │
│ │ Add a comment...                │ │ Input at bottom
│ └──────────────────────────────────┘ │
│                                      │
│ ─── REPORT (visible when done) ──── │
│                                      │
│ Verified · Feb 10, 08:15            │
│ Landing page built and deployed...   │
│ Files: /var/www/petvita/index.html │
│ Time: 45 minutes                    │
│                                      │
└──────────────────────────────────────┘
```

**UI LAYOUT — NEW TASK MODAL**

Centered modal, max-width: 480px.
Background: --bg-elevated. Overlay: rgba(0,0,0,0.7).
Only title is required. Everything else has defaults.

```
┌──────────────────────────────────────┐
│ New Task                    [✕]     │ Modal header
├──────────────────────────────────────┤
│                                      │
│ Title *                              │
│ ┌──────────────────────────────────┐ │
│ │ Build landing page for PetVita  │ │ Auto-focus on open
│ └──────────────────────────────────┘ │
│                                      │
│ Description                         │
│ ┌──────────────────────────────────┐ │
│ │ Requirements:                    │ │ Optional, textarea
│ │ - Hero section with photos       │ │ 4 rows default
│ └──────────────────────────────────┘ │
│                                      │
│ ┌──────────┐ ┌──────────────┐       │
│ │Project ▾ │ │Priority ▾    │       │ Two-column grid
│ │All       │ │Medium        │       │
│ └──────────┘ └──────────────┘       │
│ ┌──────────┐ ┌──────────────┐       │
│ │Assign ▾  │ │Deadline      │       │
│ │Shared    │ │ YYYY-MM-DD    │       │
│ └──────────┘ └──────────────┘       │
│                                      │
│ Tags (comma-separated)               │
│ ┌──────────────────────────────────┐ │
│ │ coding, frontend                │ │
│ └──────────────────────────────────┘ │
│                                      │
│                [Cancel] [Create Task ↵] │ Enter key submits
│                                      │
└──────────────────────────────────────┘
```

### 7.5 Component Specifications

| Component | Height | Padding | Radius | Interactive |
|-----------|--------|---------|--------|-------------|
| Task row | 56px | 12px | 0 | Click → detail, checkbox → done |
| Status pill | 24px | 4px 12px (full pill) | 50% | Click → cycle status |
| Priority dot | 8px × 8px | — | — | Display only |
| Button (primary) | 36px | 0 16px | 8px | Click |
| Button (secondary) | 36px | 0 16px | 8px | Click |
| Input field | 36px | 6px 12px | 4px | Type |
| Dropdown | 36px | 8px 12px | 4px | Click to open |
| Tag pill | 22px | 2px 8px | 4px | Click to filter |
| Subtask row | 32px | 4px | 0 | Checkbox toggle |
| Activity entry | Auto | 8px | 0 | Display only |

### 7.6 Keyboard Shortcuts

| Key | Action | Context |
|-----|--------|---------|
| n | Open new task modal | Task list |
| / | Focus search | Anywhere |
| Esc | Close modal/panel | When modal/panel open |
| ↑ / ↓ | Navigate task list | Task list |
| Enter | Open selected task | Task list |
| 1-4 | Set priority (1=critical, 4=low) | Task detail |
| s | Cycle status | Task detail |

### 7.7 Mobile Adaptations (< 640px)

- Project tabs: horizontal scroll with momentum
- Filter row: collapsed into single "Filter" button → bottom sheet
- Task rows: full width, 64px height (larger touch target)
- Detail panel: full-screen overlay instead of side panel
- New task: full-screen overlay
- No keyboard shortcuts (touch-only)

---

## 8. Notification & Communication Layer

### 8.1 Telegram Notifications

Athena sends notifications via the OpenClaw message tool (Telegram channel to Wilson's chat ID 538939197).

| Event | Priority | Required | Format |
|-------|----------|----------|--------|
| Task auto-created from email | Any | Auto-task: {title} | |
| Task completed by Athena | critical, high | Done: {title} — {1-line summary} | |
| Task blocked by Athena | Any | Blocked: {title} — {reason} | |
| Critical task overdue | critical | OVERDUE: {title} (was due {date}) | |
| High task overdue (daily digest) | high | Overdue digest: N tasks past deadline | |

### 8.2 Notification Rules

- Quiet hours: No notifications 22:00–07:00 UTC, except critical overdue.
- Rate limit: Max 5 individual notifications per hour. If more: batch into single digest message.
- Medium/low completion: No notification. Visible in dashboard only.
- Deduplication: Same task ID won't trigger same notification type twice in 1 hour.

---

## 9. History, Archiving & Reporting

### 9.1 Archive Strategy

**Task created**
→ Lives in data/tasks.json as status: backlog/in_progress/blocked/in_review

**Task completed (status: done)**
→ Stays in data/tasks.json for 30 days
→ Visible in "Done" section of task list
→ Visible in history API

**Monthly archive cron (1st of each month, 3am UTC)**
→ Reads data/tasks.json
→ Finds all tasks where status=done AND completed_at < 30 days ago
→ Moves them to data/archive/tasks-YYYY-MM.json (by completion month)
→ Removes them from data/tasks.json
→ This keeps tasks.json small and fast

**Hourly backup (built into server.js)**
→ Every hour, copies data/tasks.json to data/backups/tasks-YYYY-MM-DD-HH.json
→ Prunes backups older than 48 hours
→ This protects against corruption or accidental data loss

**Manual backup**
→ POST /api/backup triggers immediate snapshot
→ Returns backup filename

### 9.2 History API

GET /api/history?page=1&per_page=20&project_id=proj_petvitaclub&month=2026-02

Returns completed tasks with their reports. Searches both tasks.json (recently completed) and archive/ files (older). Sorted by completed_at descending.

---

## 10. Security

| Threat | Mitigation |
|--------|------------|
| Unauthorized API access | Bearer token required on all /api/* endpoints |
| External network access | Server binds 127.0.0.1 only, never 0.0.0.0 |
| Man-in-the-middle | Tailscale provides encrypted tunnel; SSH adds another layer |
| Concurrent write corruption | proper-lockfile on every write operation |
| Data loss | Hourly backups (48h rolling), monthly archives |
| Prompt injection via email tasks | Tasks from email tagged created_by:"email", include raw source for audit, never auto-execute |
| Malicious task content in description | Task descriptions stored/displayed only, never passed to eval or exec |
| Token/secret leakage | .env file with 600 permissions, token never logged, never in task data |
| XSS in UI | All user-provided text rendered via textContent (not innerHTML) |

---

## 11. 10-Phase Implementation Roadmap

### Phasing Philosophy

The phases follow a CTO's build order: infrastructure first, then core loop, then feedback, then integrations, then polish. Each phase produces a working, testable increment. No phase depends on a future phase — you can stop at any phase and have a useful system.

**Phase Dependency Map:**
```
Phase 1: Foundation (server + data)
│
├──> Phase 2: API (CRUD endpoints)
│   │
│   ├──> Phase 3: UI Shell (frontend renders data from API)
│   │   │
│   │   └──> Phase 7: UI Polish (keyboard, mobile, search)
│   │
│   ├──> Phase 4: Athena Read (Athena can query tasks)
│   │   │
│   │   └──> Phase 5: Athena Execute (full execution loop)
│   │       │
│   │       └──> Phase 6: Notifications (Telegram alerts)
│   │           │
│   │           └──> Phase 9: Email-to-Task (auto-creation)
│   │
│   └──> Phase 8: History & Backup (archiving, snapshots)
│
└──> Phase 10: Integrations (GitHub, GDrive links)
```

**Critical path (minimum viable):** 1 → 2 → 3 → 4 → 5
Everything else is valuable but not blocking.

### Phase 1: Foundation

**Goal:** Server process running, data files initialized, reachable from MacBook.
**Time estimate:** 2-3 hours
**Why first:** Nothing else can exist without the running process and data layer.

**Deliverables:**

| # | Task | Acceptance Criteria |
|---|------|-------------------|
| 1.1 | Create project directory at /home/athena/.openclaw/workspace/athena-tasks/ | Directory exists with correct ownership |
| 1.2 | Create package.json with express and proper-lockfile dependencies | npm install succeeds |
| 1.3 | Create .env with PORT=7700 and AUTH_TOKEN=<generate random 32-char hex> | File exists, 600 permissions |
| 1.4 | Create server.js with: Express app, .env loading, bind to 127.0.0.1:7700, health endpoint (GET /api/health returns {"ok":true}), static file serving (GET / serves ui.html) | node server.js starts, curl localhost:7700/api/health returns 200 |
| 1.5 | Create data/ directory with empty-array tasks.json ([]) and seed projects.json with 4 starter projects (CAP, PVC, AUT, PER) | Files exist, valid JSON |
| 1.6 | Create data/archive/ and data/backups/ directories | Directories exist |
| 1.7 | Create placeholder ui.html that shows "athena-tasks is running" | Browser at localhost:7700 shows page |
| 1.8 | Create systemd user unit ~/.config/systemd/user/athena-tasks.service | systemctl --user start athena-tasks works |
| 1.9 | Test SSH tunnel from MacBook: ssh -L 7700:127.0.0.1:7700 athena@100.93.247.25 | Browser on MacBook at localhost:7700 shows placeholder page |

**Technical decisions:**
- Use dotenv package? No. Read .env manually with 3 lines of code (split, trim, assign to process.env). One less dependency.
- File locking: implement in Phase 1 as a withData(file, mutator) helper. All future phases use this.
- Error handling: return JSON {"error": "message"} for all errors. Set up global error handler.

### Phase 2: Core API

**Goal:** Full CRUD for tasks and projects. Athena and the UI can both create, read, update, and delete tasks.
**Time estimate:** 3-4 hours
**Why second:** The API is the contract between all consumers (UI, Athena, cron). It must be right before anything else is built on top of it.

**Deliverables:**

| # | Task | Acceptance Criteria |
|---|------|-------------------|
| 2.1 | Auth middleware: validate Bearer token on all /api/* routes | 401 on missing/wrong token, 200 on correct |
| 2.2 | POST /api/tasks — create task with validation | Returns 201 with task including generated id, created_at, activity[0] |
| 2.3 | GET /api/tasks — list with all query params (status, priority, project_id, assigned_to, tag, overdue, sort, order, include_done, limit, offset) | Returns filtered, sorted array. Default excludes done tasks. |
| 2.4 | GET /api/tasks/:id — single task | Returns task or 404 |
| 2.5 | PATCH /api/tasks/:id — partial update with state transition validation | Rejects invalid transitions with 400. Appends status_changed to activity. Sets updated_at. |
| 2.6 | DELETE /api/tasks/:id — soft delete (move to archive) | Task removed from tasks.json, appended to archive |
| 2.7 | POST /api/tasks/:id/activity — append comment/note | Appends to activity array, sets updated_at |
| 2.8 | POST /api/tasks/:id/complete — set done + report | Sets status=done, completed_at=now, report=body |
| 2.9 | POST /api/tasks/:id/reopen — move done→backlog | Clears completed_at and report, sets status=backlog |
| 2.10 | POST /api/tasks/:id/verify — attach verification | Sets report.verified, report.verified_at, report.verification_notes |
| 2.11 | POST /api/tasks/:id/subtasks — add subtask | Appends to subtasks array |
| 2.12 | PATCH /api/tasks/:id/subtasks/:stid — toggle subtask | Flips done boolean |
| 2.13 | DELETE /api/tasks/:id/subtasks/:stid — remove subtask | Removes from subtasks array |
| 2.14 | GET /api/projects — list with computed _stats | Stats calculated from tasks.json at read time |
| 2.15 | POST /api/projects / PATCH /api/projects/:id — create/update project | Standard CRUD |
| 2.16 | GET /api/dashboard — aggregated overview | Returns: project stats, overdue count, critical count, recent 10 activity entries |
| 2.17 | GET /api/health — enhanced | Returns {ok, uptime_seconds, task_count, project_count} |

**Technical decisions:**
- Priority sort implementation: Map priority strings to numbers (critical=0, high=10, medium=20, low=30). Add overdue penalty (-1000 to sort weight). Sort by weight ascending, then deadline ascending, then created_at ascending.
- Search (?search=): Simple case-insensitive substring match on title + description. No full-text index needed at this scale.
- Validation: Inline validation in each route handler. No schema library. Keep it readable. Return 400 with specific error message.
- ID generation: t_${Date.now()}_${crypto.randomBytes(3).toString('hex')} — unique, sortable, readable.

### Phase 3: UI Shell

**Goal:** Wilson can view, create, edit, and manage tasks in the browser. The full single-page application.
**Time estimate:** 6-8 hours (largest phase — the UI is the product for Wilson)
**Why third:** The API is stable. Now Wilson needs to see and use it. This is human interface.

**Deliverables:**

| # | Task | Acceptance Criteria |
|---|------|-------------------|
| 3.1 | Token entry: On first load, prompt for API token. Token persists across browser sessions. Store in localStorage. Invalid token shows error. | Works |
| 3.2 | Header bar: Logo, search trigger, "New Task" button | Fixed header, renders correctly |
| 3.3 | Project tabs: Horizontal tab bar with project names + counts | Click tab filters task list. Active tab highlighted with project color. |
| 3.4 | Filter row: Dropdowns for status, priority, assigned, tags | Filters apply immediately. Multiple filters combine (AND logic). Clear all button. |
| 3.5 | Task list: Renders all active tasks as rows | Shows priority dot, title, metadata line (project, tags, deadline), status pill |
| 3.6 | Task row interactions: Click opens detail panel | Smooth transition |
| 3.7 | Subtask progress bar on task rows | Thin bar showing done/total ratio |
| 3.8 | Overdue indicator: Red text replaces deadline when past due | Visually distinct |
| 3.9 | Done section: Shows last 20 completed tasks in muted style | Collapsed by default, expandable |
| 3.10 | Detail panel: Slide-in from right (420px desktop, full-screen mobile) | All task fields visible and editable |
| 3.11 | Inline editing: Click status/priority/assigned dropdowns to change directly | PATCH API call on change, optimistic UI update |
| 3.12 | Description editing: Click to enter edit mode, blur to save | PATCH API call on blur |
| 3.13 | Subtask management: Checkbox toggle, add new, delete | API calls per action |
| 3.14 | Activity log display: Reverse-chronological list in detail panel | Each entry shows actor, timestamp, message |
| 3.15 | Comment input: Text field at bottom of detail panel | POST /api/tasks/:id/activity on submit |
| 3.16 | New Task modal: Title (required), description, project, priority, assigned, deadline, tags | POST /api/tasks on submit. Close modal. Refresh list. |
| 3.17 | Auto-refresh: Poll GET /api/tasks every 5 seconds | UI updates without manual refresh. "Synced Ns ago" in footer. |
| 3.18 | Footer bar: Active count, done count, overdue count, sync time | Fixed footer |
| 3.19 | Report display: Show completion report when task is done | Visible in detail panel under activity |
| 3.20 | Dark theme: Full CSS with color system from spec | All components use CSS variables |

**Technical decisions:**
- No framework. Vanilla JS with a simple render-loop pattern: fetchTasks() → renderTaskList() → bindEvents().
- State held in plain JS objects. No store, no reactive bindings.
- DOM manipulation via document.createElement + textContent (XSS safe).
- CSS: All in <style> block within ui.html. No external stylesheet.
- Fonts: Single <link> to Google Fonts for Inter. Fallback to system fonts if CDN unavailable.

### Phase 4: Athena Read Access

**Goal:** Athena can query the task dashboard and understand her current workload.
**Time estimate:** 1-2 hours
**Why fourth:** The API and UI are working. Now connect to agent. Read-only first to validate integration path before granting write access.

**Deliverables:**

| # | Task | Acceptance Criteria |
|---|------|-------------------|
| 4.1 | Set ATHENA_TASKS_TOKEN as environment variable in OpenClaw config (or workspace .env) | Athena can reference $ATHENA_TASKS_TOKEN in exec calls |
| 4.2 | Create skills/athena-tasks/SKILL.md with API documentation | Skill appears in Athena's available skills list |
| 4.3 | Add task check to HEARTBEAT.md | Heartbeat runs include task query |
| 4.4 | Test: Tell Athena via Telegram "check the task board" | Athena queries API and reports task list |
| 4.5 | Test: Create a task via UI, verify Athena sees it on next heartbeat | Athena mentions of new task |

### Phase 5: Athena Execute Loop

**Goal:** Athena can autonomously claim, execute, verify, and complete tasks.
**Time estimate:** 2-3 hours
**Why fifth:** Read access is proven. Now grant the full execution loop. This is core value proposition — autonomous task execution.

**Deliverables:**

| # | Task | Acceptance Criteria |
|---|------|-------------------|
| 5.1 | Add Task Worker cron job (30-min interval, isolated session) | Cron job appears in openclaw cron list |
| 5.2 | Write execution protocol instructions in SKILL.md | Protocol matches spec (claim → execute → verify → complete) |
| 5.3 | Test simple task: Create "Write a haiku about tasks" in UI, assign to Athena | Athena claims, executes, completes with report within 30 minutes |
| 5.4 | Test coding task: Create "Create a hello.py script that prints system info" | Athena creates file, verifies it runs, reports path |
| 5.5 | Test blocked flow: Create task that Athena can't complete (e.g., "Ask Wilson for API key") | Athena sets status to blocked, activity explains why |
| 5.6 | Test priority ordering: Create 3 tasks with different priorities | Athena picks critical first, then high, then medium |
| 5.7 | Document max-tasks-per-cron-run limit (3) in SKILL.md | Athena stops after 3 tasks per cron cycle |

### Phase 6: Notifications

**Goal:** Wilson receives Telegram notifications for important task events.
**Time estimate:** 1-2 hours
**Why sixth:** Athena is executing tasks. Wilson needs visibility without watching the dashboard. Notifications close the feedback loop.

**Deliverables:**

| # | Task | Acceptance Criteria |
|---|------|-------------------|
| 6.1 | Add notification logic to Athena's execution protocol in SKILL.md | Completion of high/critical tasks triggers Telegram |
| 6.2 | Add blocked-task notification instruction to SKILL.md | Block events trigger Telegram |
| 6.3 | Add quiet hours rule (22:00-07:00 UTC) to SKILL.md | No non-critical notifications during quiet hours |
| 6.4 | Test: Complete a high-priority task | Wilson receives "✅ Done:" message on Telegram |
| 6.5 | Test: Block a task | Wilson receives "⚠ Blocked:" message on Telegram |

### Phase 7: UI Polish

**Goal:** The dashboard feels professional. Keyboard shortcuts, search, mobile layout, smooth interactions.
**Time estimate:** 4-5 hours
**Why seventh:** Core functionality works for both Wilson and Athena. Now make the human experience excellent. This is where daily usability lives.

**Deliverables:**

| # | Task | Acceptance Criteria |
|---|------|-------------------|
| 7.1 | Keyboard shortcuts: n (new), / (search), Esc (close), ↑↓ (navigate) | All shortcuts work without interfering with text inputs |
| 7.2 | Search: Full-text filter on title + description | Instant filtering as user types |
| 7.3 | Mobile responsive layout (< 640px breakpoint) | Task list, detail panel, modals all work on iPhone screen |
| 7.4 | Quick status change: Click status pill to cycle through states | Dropdown or single-click cycle |
| 7.5 | Empty states: Show helpful message when no tasks match filter | "No tasks in backlog" etc. |
| 7.6 | Loading states: Skeleton UI on initial load | Brief skeleton before data arrives |
| 7.7 | Optimistic updates: UI updates before API confirms | Rollback on error with toast notification |
| 7.8 | Toast notifications: Brief message for actions (created, updated, error) | Appears top-right, auto-dismisses in 3 seconds |
| 7.9 | Link management: Add/edit links in detail panel (GitHub, GDrive, email thread) | Click to add URL, renders as clickable link |
| 7.10 | Project dashboard view: Summary cards for each project with stats bars | Accessible via "Dashboard" tab or home icon |

### Phase 8: History & Backup

**Goal:** Complete data safety net. Nothing is lost. Old work is browsable.
**Time estimate:** 2-3 hours
**Why eighth:** System is working and generating data. Now protect that data and make it explorable.

**Deliverables:**

| # | Task | Acceptance Criteria |
|---|------|-------------------|
| 8.1 | Hourly backup in server.js: setInterval every 60 minutes copies tasks.json to backups/ | Backup files appear in data/backups/ |
| 8.2 | Backup pruning: Delete backups older than 48 hours during each backup cycle | Only ~48 backup files at any time |
| 8.3 | POST /api/backup — manual backup trigger | Returns backup filename |
| 8.4 | GET /api/history — paginated completed tasks across tasks.json + archive/ | Returns correct results spanning both sources |
| 8.5 | Monthly archive cron job (1st of month, 3am UTC) | Moves 30+ day old completed tasks to archive/ |
| 8.6 | History view in UI: Tab or section showing completed tasks with reports | Paginated list, searchable by project |

### Phase 9: Email-to-Task Automation

**Goal:** Actionable emails automatically become tasks. Wilson never has to manually transcribe email requests.
**Time estimate:** 2-3 hours
**Why ninth:** All manual workflows are working. Now automate most common input path — email.

**Deliverables:**

| # | Task | Acceptance Criteria |
|---|------|-------------------|
| 9.1 | Update thread monitoring cron instructions to check for actionable requests | Cron job includes task creation logic |
| 9.2 | Define authorized senders list in SKILL.md | Only whitelisted emails trigger auto-tasks |
| 9.3 | Email task template: title from subject, description from body excerpt, tags=["auto-email"] | Auto-tasks are clearly marked and auditable |
| 9.4 | Prompt injection detection instructions in SKILL.md | Reject emails with suspicious patterns |
| 9.5 | Notification on auto-creation: "📬 Auto-task: {title}" to Wilson | Wilson can review/delete/edit immediately |
| 9.6 | Test: Send email from Wilson's account to Athena with actionable request | Task appears in dashboard with source metadata |

### Phase 10: External Integrations

**Goal:** Tasks link to external systems. The dashboard becomes central hub connecting GitHub, GDrive, and other tools.
**Time estimate:** 3-4 hours (per integration, can be done incrementally)
**Why last:** Everything works standalone. Integrations add convenience but are not critical path. Each can be added independently.

**Deliverables:**

| # | Task | Acceptance Criteria |
|---|------|-------------------|
| 10.1 | GitHub link field: Store issue/PR URLs in task.links | Links render as clickable in UI |
| 10.2 | GitHub auto-link: When Athena creates a GitHub issue as part of a task, store URL | Link populated automatically |
| 10.3 | GDrive link field: Store doc/folder URLs in task.links | Links render as clickable in UI |
| 10.4 | Email thread link: Store memory/threads/ path in task.links | Link renders in UI, Athena can reference thread |
| 10.5 | Deadline reminder cron: Daily at 8am UTC, check for tasks due within 24 hours | Telegram reminder: "📅 Due today: {title}" |
| 10.6 | Overdue escalation: Daily digest of all overdue tasks | Single Telegram message listing all overdue |
| 10.7 | Project status auto-update: When all tasks in a project are done, suggest marking project complete | Athena mentions it in heartbeat |

### Phase Summary

| Phase | Name | Time | Cumulative | What Works After |
|--------|------|------|------------|-----------------|
| 1 | Foundation | 2-3h | 2-3h | Server running, reachable from MacBook |
| 2 | Core API | 3-4h | 5-7h | Full CRUD via curl, data persisted |
| 3 | UI Shell | 6-8h | 11-15h | Wilson manages tasks in browser |
| 4 | Athena Read | 1-2h | 12-17h | Athena sees her task queue |
| 5 | Athena Execute | 2-3h | 14-20h | **MVP:** Athena autonomously completes tasks |
| 6 | Notifications | 1-2h | 15-22h | Wilson gets Telegram alerts |
| 7 | UI Polish | 4-5h | 19-27h | Professional daily-driver UI |
| 8 | History & Backup | 2-3h | 21-30h | Data safety, browsable archive |
| 9 | Email-to-Task | 2-3h | 23-33h | Email automation pipeline |
| 10 | Integrations | 3-4h | 26-37h | Full ecosystem connectivity |

**MVP milestone:** After Phase 5 (~14-20 hours total). At that point:
- Wilson creates tasks in the UI
- Athena picks them up, executes, verifies, and marks complete
- All data is persisted and auditable

---

## 12. Success Metrics & KPIs

### Week 1 (Phases 1–5 complete)

| Metric | Target |
|--------|---------|
| Tasks created | 10+ |
| Tasks completed by Athena | 5+ |
| API uptime | 99%+ (no unplanned crashes) |
| Mean task completion time | < 2 hours from creation to done |
| Data loss incidents | 0 |

### Week 2 (Phases 6–8 complete)

| Metric | Target |
|--------|---------|
| Tasks completed by Athena | 20+ cumulative |
| Wilson daily dashboard visits | 1+ per day |
| Notification accuracy | No false positives, no missed criticals |
| Backup integrity | All hourly backups valid JSON |

### Month 1 (All phases complete)

| Metric | Target |
|--------|---------|
| Tasks completed | 50+ |
| Athena autonomous completions/day | 3+ |
| Projects tracked | 4+ |
| Email-to-task conversions | 5+ |
| API response time (p95) | < 200ms |
| Data loss | 0 incidents |

---

**This document is single source of truth for Athena Task Dashboard system. All implementation decisions should reference this plan.**

**Version 2.0 — 2026-02-09**
