# Phase 4: Athena Integration — Task List

**Date:** 2026-02-12
**Total Tasks:** 7

---

## Task Status

| Task | Title | Priority | Est. Time | Status |
|------|-------|----------|-----------|--------|
| P4-01 | Set ATHENA_TASKS_TOKEN environment variable in OpenClaw | Critical | 10 min | To Do |
| P4-02 | Create SKILL.md — API reference for Athena | Critical | 30 min | To Do |
| P4-03 | Update HEARTBEAT.md — Add task dashboard check | Critical | 15 min | To Do |
| P4-04 | Verify Athena can query the API via exec tool | Critical | 15 min | To Do |
| P4-05 | Test: Create task in UI → Athena sees it on heartbeat | High | 15 min | To Do |
| P4-06 | Test: Athena queries filtered endpoints (projects, dashboard) | Medium | 10 min | To Do |
| P4-07 | Test: Athena creates a task via the API | High | 10 min | To Do |

---

## Task Details

### P4-01: Set ATHENA_TASKS_TOKEN environment variable in OpenClaw
**Priority:** Critical | **Est. Time:** 10 min | **Depends On:** P1-02

**Description:**
Make the athena-tasks API token available to the Athena agent process so she can reference it in exec/curl calls. Set it as an environment variable accessible within OpenClaw's runtime.

**Steps:**
1. Read the AUTH_TOKEN value from /home/athena/.openclaw/workspace/athena-tasks/.env
2. Add the token as an environment variable available to the OpenClaw Gateway process
   - Option A — workspace .env file: Add ATHENA_TASKS_TOKEN=<token> to /home/athena/.openclaw/workspace/.env
   - Option B — systemd unit override: systemctl --user edit openclaw-gateway, Add: Environment=ATHENA_TASKS_TOKEN=<token>
   - Option C — shell profile: Add export ATHENA_TASKS_TOKEN=<token> to ~/.bashrc
3. Restart the OpenClaw Gateway to pick up the new variable: systemctl --user restart openclaw-gateway
4. Verify from within an Athena exec call: exec: echo $ATHENA_TASKS_TOKEN → should print the token

**Acceptance Criteria:**
- Athena can reference $ATHENA_TASKS_TOKEN in exec tool calls
- Token value matches AUTH_TOKEN in athena-tasks/.env
- Token is not visible in any log output
- OpenClaw Gateway restart completes cleanly

---

### P4-02: Create SKILL.md — API reference for Athena
**Priority:** Critical | **Est. Time:** 30 min | **Depends On:** P4-01, P2-16

**Description:**
Create the OpenClaw skill file at skills/athena-tasks/SKILL.md. This is Athena's instruction manual for the task dashboard API — she reads this skill before interacting with the system. Must be concise and token-efficient.

**Steps:**
1. Create directory: mkdir -p /home/athena/.openclaw/workspace/skills/athena-tasks/
2. Create SKILL.md with sections:
   - Overview: One paragraph: what the dashboard is, where it runs (127.0.0.1:7700), how to auth
   - Authentication: All API calls require: -H 'Authorization: Bearer $ATHENA_TASKS_TOKEN'. Show the curl pattern once
   - Quick Reference — Common Curl Commands: List the 8 most-used commands Athena needs
   - API Endpoints (full reference): Compact table listing all endpoints, methods, and body params
   - Task Schema: Show the field list with types and allowed values. Keep compact
   - Token Efficiency Rules: Reports: max 2 sentences summary, 1 sentence verification. Activity comments: max 1 sentence. Never dump file contents — reference file paths. Subtask names: max 60 chars
3. Keep total SKILL.md under 300 lines for token efficiency

**Acceptance Criteria:**
- File exists at skills/athena-tasks/SKILL.md
- Skill appears in Athena's available skills list (verify via OpenClaw)
- All curl examples are valid and runnable
- File is under 300 lines
- Covers: auth, all endpoints, task schema, token efficiency rules

---

### P4-03: Update HEARTBEAT.md — Add task dashboard check
**Priority:** Critical | **Est. Time:** 15 min | **Depends On:** P4-02

**Description:**
Modify Athena's existing HEARTBEAT.md to include a task dashboard check step. During each heartbeat (~30 min), Athena should query for pending tasks assigned to her.

**Steps:**
1. Open /home/athena/.openclaw/workspace/HEARTBEAT.md
2. Add a new checklist item in the heartbeat procedure:
   - Run: curl -s 'http://127.0.0.1:7700/api/tasks?assigned_to=athena&status=backlog&sort=priority&limit=3' -H 'Authorization: Bearer $ATHENA_TASKS_TOKEN'
   - If result is empty array []: No pending tasks. Continue heartbeat
   - If result has tasks: Report count and titles in heartbeat summary. Example: '📋 Task queue: 2 pending — [title1], [title2]'
   - Do NOT auto-execute tasks during heartbeat (that's the Task Worker cron's job)
   - Exception: If a task is marked 'critical' priority, claim and execute immediately
3. Position: Add this check after existing system checks, before the heartbeat summary

**Acceptance Criteria:**
- HEARTBEAT.md contains the task dashboard check step
- Next heartbeat run includes task queue query
- Heartbeat reports task count if tasks exist
- Heartbeat does NOT execute non-critical tasks
- Critical tasks trigger immediate execution during heartbeat

---

### P4-04: Verify Athena can query the API via exec tool
**Priority:** Critical | **Est. Time:** 15 min | **Depends On:** P4-01, P4-02

**Description:**
Live integration test: tell Athena via Telegram to check the task board. Verify she queries the API correctly and reports the result. This validates the full chain: OpenClaw → exec tool → curl → athena-tasks API → response parsing.

**Steps:**
1. Ensure at least 1 task exists in the dashboard (create via UI if needed)
2. Send Athena a message via Telegram: 'Check the task board and tell me what tasks are pending'
3. Observe Athena's response:
   - She should use the exec tool to run the curl command from SKILL.md
   - She should parse the JSON response
   - She should report task titles, priorities, and assignment
4. Verify the curl command she used is correct:
   curl -s 'http://127.0.0.1:7700/api/tasks?assigned_to=athena&status=backlog&sort=priority' -H 'Authorization: Bearer $ATHENA_TASKS_TOKEN'
5. Check that the token works (no 401 error)
6. Check the response matches what the UI shows

**Acceptance Criteria:**
- Athena successfully queries the API via exec tool
- No 401 authentication errors
- Athena reports task list accurately
- Response matches dashboard UI content
- Athena references the athena-tasks skill in her reasoning

---

### P4-05: Test: Create task in UI → Athena sees it on heartbeat
**Priority:** High | **Est. Time:** 15 min | **Depends On:** P4-03, P4-04

**Description:**
End-to-end validation: Wilson creates a task assigned to Athena via the browser UI, then waits for the next heartbeat to confirm Athena reports it. Validates the full human→API→agent loop.

**Steps:**
1. Open the dashboard in browser (localhost:7700)
2. Create a new task via the UI:
   - Title: 'Test task — Athena heartbeat visibility'
   - Priority: High
   - Assigned to: Athena
   - Project: Automation Tools
3. Wait for next heartbeat cycle (~30 min max) OR manually trigger: send Athena 'run your heartbeat check'
4. Observe Athena's heartbeat output:
   - She should report: '📋 Task queue: 1 pending — Test task — Athena heartbeat visibility'
5. Verify the task appears in her response with correct priority and assignment
6. Clean up: delete or complete the test task

**Acceptance Criteria:**
- Task created in UI appears in Athena's heartbeat report
- Athena correctly identifies title, priority, and assignment
- No data discrepancy between UI and Athena's view
- End-to-end latency: task is visible to Athena within one heartbeat cycle

---

### P4-06: Test: Athena queries filtered endpoints (projects, dashboard)
**Priority:** Medium | **Est. Time:** 10 min | **Depends On:** P4-04

**Description:**
Verify Athena can use the full API beyond basic task listing: project stats, dashboard overview, and filtered queries. This ensures the SKILL.md documentation covers enough for Athena to navigate the API flexibly.

**Steps:**
1. Ask Athena via Telegram: 'How many projects are in the dashboard? What are the stats?' — She should call GET /api/projects and report names + _stats
2. Ask Athena: 'Show me the dashboard overview' — She should call GET /api/dashboard and summarize
3. Ask Athena: 'Are there any overdue tasks?' — She should call GET /api/tasks?overdue=true
4. Ask Athena: 'What tasks are in the PetVitaClub project?' — She should call GET /api/tasks?project_id=proj_petvitaclub
5. Verify each response is accurate against the UI

**Acceptance Criteria:**
- Athena retrieves project stats correctly
- Dashboard overview response is accurate
- Filtered queries (overdue, by project) return correct results
- Athena selects appropriate endpoints without guidance

---

### P4-07: Test: Athena creates a task via the API
**Priority:** High | **Est. Time:** 10 min | **Depends On:** P4-04

**Description:**
Verify Athena can create tasks via POST /api/tasks. This is important for email-to-task automation (Phase 9) and for Athena self-generating follow-up tasks.

**Steps:**
1. Ask Athena via Telegram: 'Create a task on the dashboard: Research Node.js 22 LTS features, assign it to yourself, priority medium, project Automation Tools, tag it research'
2. Athena should call POST /api/tasks with: {title:'Research Node.js 22 LTS features', assigned_to:'athena', priority:'medium', project_id:'proj_automation', tags:['research']}
3. Verify the task appears in the UI dashboard
4. Check all fields are set correctly in the detail panel
5. Verify activity[0] shows created_by:'athena'
6. Clean up: delete or keep the test task

**Acceptance Criteria:**
- Athena successfully creates a task via POST
- Task appears in UI with correct fields
- created_by field is 'athena'
- Activity log shows 'athena created' entry
- All fields (priority, tags, project, assigned_to) match request

---

## Summary

**Total Tasks:** 7
**Critical Path:** P4-01 → P4-02 → P4-03 → P4-04 → P4-05, P4-07
**Estimated Total Time:** 1 hour 45 minutes

**Phase 4 Status:** 🔄 Ready to begin
