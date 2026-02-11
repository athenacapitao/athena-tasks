# Phase 2 Tasks — Core API

**Goal:** Full CRUD for tasks and projects. Athena and UI can both create, read, update, and delete tasks.
**Time estimate:** 3-4 hours
**Status:** 📝 Tasks loaded from Google Sheet

---

## Task List

| ID | Title | Priority | Est. Time | Depends On | Assigned To | Status |
|-----|--------|-----------|------------|-------------|--------|
| P2-01 | Auth middleware — Bearer token validation | Critical | 20 min | P1-05 | Athena | ✅ Done |
| P2-02 | POST /api/tasks — Create new task | Critical | 30 min | P2-01 | — | ⏸️ To Do |
| P2-03 | GET /api/tasks — List tasks with filters and sorting | Critical | 45 min | P2-02 | — | ⏸️ To Do |
| P2-04 | GET /api/tasks/:id — Get single task | Critical | 10 min | P2-02 | — | ⏸️ To Do |
| P2-05 | PATCH /api/tasks/:id — Update task with state validation | Critical | 40 min | P2-04 | — | ⏸️ To Do |
| P2-06 | DELETE /api/tasks/:id — Soft delete (archive) | High | 20 min | P2-04 | — | ⏸️ To Do |
| P2-07 | POST /api/tasks/:id/activity — Add comment/note | High | 15 min | P2-04 | — | ⏸️ To Do |
| P2-08 | POST /api/tasks/:id/complete — Mark task done with report | Critical | 25 min | P2-05 | — | ⏸️ To Do |
| P2-09 | POST /api/tasks/:id/reopen — Reopen completed task | High | 15 min | P2-08 | — | ⏸️ To Do |
| P2-10 | POST /api/tasks/:id/verify — Attach verification result | High | 15 min | P2-05 | — | ⏸️ To Do |
| P2-11 | Subtask endpoints (add, toggle, delete) | High | 25 min | P2-04 | — | ⏸️ To Do |
| P2-12 | Project endpoints (list, get, create, update) | High | 30 min | P2-03 | — | ⏸️ To Do |
| P2-13 | GET /api/dashboard — Aggregated overview | Medium | 20 min | P2-03, P2-12 | — | ⏸️ To Do |
| P2-14 | GET /api/health — Enhanced with task/project counts | Low | 10 min | P2-03 | — | ⏸️ To Do |
| P2-15 | Input validation helpers | Medium | 20 min | P2-01 | — | ⏸️ To Do |
| P2-16 | Integration test — Full API round-trip via curl | High | 30 min | P2-01 through P2-14 | — | ⏸️ To Do |

---

## Task Details

### P2-01: Auth middleware — Bearer token validation

**Status:** ✅ Done
**Priority:** Critical
**Est. Time:** 20 min
**Completed:** 2026-02-11 02:37 UTC
**Depends On:** P1-05 ✅
**Assigned To:** Athena
**Description:**
Create Express middleware that validates Authorization: Bearer <token> header on all /api/* routes. Unauthenticated requests return 401.

**Steps:**
1. Create authMiddleware function:
   - Extract Authorization header
   - Check format: 'Bearer <token>'
   - Compare token to process.env.AUTH_TOKEN
   - If invalid/missing → res.status(401).json({error:'Unauthorized'})
   - If valid → next()
2. Apply to all /api/* routes: app.use('/api', authMiddleware)
3. Exclude GET /api/health from auth (move health route before middleware, or whitelist)
4. GET / (ui.html) must NOT require auth — UI handles token entry via localStorage

**Technical Notes:**
Use timing-safe comparison (crypto.timingSafeEqual) to prevent timing attacks on token validation. Health endpoint should remain unauthenticated for monitoring/liveness checks.

**Acceptance Criteria:**
- Request without Authorization header → 401 {error:'Unauthorized'}
- Request with wrong token → 401
- Request with correct Bearer token → passes through to route handler
- GET / (ui.html) works without any auth header
- GET /api/health works without auth

---

### P2-02: POST /api/tasks — Create new task

**Status:** ⏸️ To Do
**Priority:** Critical
**Est. Time:** 30 min
**Depends On:** P2-01
**Assigned To:** —
**Description:**
Create endpoint to add a new task. Validates input, generates ID, sets defaults, appends 'created' activity entry, writes to tasks.json via withData().

**Steps:**
1. Validate required fields: title (string, 3-200 chars)
2. Generate ID: t_{Date.now()}_{crypto.randomBytes(3).toString('hex')}
3. Apply defaults:
   - status: 'backlog'
   - priority: 'medium' (validate: critical|high|medium|low)
   - assigned_to: 'shared' (validate: wilson|athena|shared)
   - created_by: from body or 'wilson'
   - project_id: 'proj_personal' (validate exists in projects.json)
   - tags: [] (validate: array of lowercase strings)
   - subtasks: [], links: {}, source: {type:'manual'}
4. Set timestamps: created_at=now, updated_at=now, completed_at=null
5. Create activity[0]: {at:now, by:created_by, action:'created', detail:null}
6. withData('tasks.json', data => { data.push(task); return data; })
7. Return 201 with full task object

**Technical Notes:**
Validate project_id exists by reading projects.json. description is optional (max 5000 chars). deadline is optional (ISO 8601 or null). Inline validation — no schema library needed. Return 400 with specific error message on validation failure.

**Acceptance Criteria:**
- POST with valid title → 201 with task including generated id, created_at, activity[0]
- POST with missing title → 400 {error:'Title is required...'}
- POST with title < 3 chars → 400
- Defaults applied: status=backlog, priority=medium, assigned_to=shared
- Task appears in data/tasks.json after creation
- Invalid project_id → 400

---

### P2-03: GET /api/tasks — List tasks with filters and sorting

**Status:** ⏸️ To Do
**Priority:** Critical
**Est. Time:** 45 min
**Depends On:** P2-02
**Assigned To:** —
**Description:**
List endpoint with full query parameter support: status, priority, project_id, assigned_to, created_by, tag, overdue, search, sort, order, include_done, limit, offset.

**Steps:**
1. Read tasks.json via readData()
2. Apply filters sequentially:
   - status: comma-sep → filter tasks matching any listed status. Default excludes 'done'
   - priority: comma-sep filter
   - project_id: exact match
   - assigned_to: exact match
   - created_by: exact match
   - tag: task.tags.includes(tag)
   - overdue=true: deadline exists AND deadline < now AND status != done
   - include_done=true: include status=done in results
   - search: case-insensitive substring on title + description
3. Sort: implement priority sort with weight mapping:
   critical=0, high=10, medium=20, low=30
   Add overdue penalty: -1000 to weight if overdue
   Sort by weight ASC → deadline ASC (nulls last) → created_at ASC
   For date sorts (deadline, created_at, updated_at): default order=desc
4. Apply limit (default 100) and offset (default 0)
5. Return array of tasks

**Technical Notes:**
Priority sort is the core of Athena's task queue — it must be correct. The sort function: primary=priority_weight, secondary=deadline proximity (overdue gets -days, future gets +days), tertiary=created_at ascending (FIFO). Search is simple case-insensitive includes() — no full-text index needed at this scale.

**Acceptance Criteria:**
- Default GET returns non-done tasks sorted by priority
- ?status=backlog,in_progress filters correctly
- ?assigned_to=athena returns only Athena's tasks
- ?search=landing matches title/description case-insensitively
- ?overdue=true returns only past-deadline non-done tasks
- ?sort=priority returns critical first, then high, medium, low
- ?include_done=true includes completed tasks
- ?limit=5&offset=5 paginates correctly

---

### P2-04: GET /api/tasks/:id — Get single task

**Status:** ⏸️ To Do
**Priority:** Critical
**Est. Time:** 10 min
**Depends On:** P2-02
**Assigned To:** —
**Description:**
Return a single task by ID with all fields. Return 404 if not found.

**Steps:**
1. Read tasks.json via readData()
2. Find task by id: tasks.find(t => t.id === req.params.id)
3. If not found → 404 {error: 'Task not found'}
4. Return 200 with full task object

**Technical Notes:**
Simple lookup. No filtering or sorting needed. Return complete task object including all nested fields (subtasks, activity, links, source, report).

**Acceptance Criteria:**
- Valid ID → 200 with complete task object
- Invalid/nonexistent ID → 404 {error:'Task not found'}
- All nested fields present (subtasks, activity, links, report)

---

### P2-05: PATCH /api/tasks/:id — Update task with state validation

**Status:** ⏸️ To Do
**Priority:** Critical
**Est. Time:** 40 min
**Depends On:** P2-04
**Assigned To:** —
**Description:**
Partial update endpoint. Accepts any subset of editable fields. If status is being changed, validates transition against state machine. Auto-appends activity entry for status changes.

**Steps:**
1. Find task by ID (404 if missing)
2. Define allowed fields: title, description, priority, assigned_to, project_id, tags, deadline, status, links
3. If status change requested, validate transition:
   - VALID: backlog→in_progress, backlog→blocked, backlog→done(wilson only),
   - in_progress→blocked, in_progress→in_review, in_progress→done(wilson),
   - blocked→backlog, blocked→in_progress,
   - in_review→done, in_review→in_progress(wilson)
   - INVALID: done→anything (must use /reopen), backwards for athena
4. Apply field updates via Object.assign or manual merge
5. Set updated_at = now
6. If status changed: append activity {action:'status_changed', detail:'old→new'}
7. If status→blocked: append activity {action:'blocked', detail: req.body.reason}
8. withData() to persist
9. Return 200 with updated task

**Technical Notes:**
State transition validation is critical — this prevents Athena from accidentally moving tasks backward or completing tasks without /complete endpoint (which requires a report). Validate field types on update (e.g., priority must be valid enum, tags must be array).

**Acceptance Criteria:**
- Valid field update → 200 with updated task, updated_at changed
- Status backlog→in_progress → 200 + activity entry appended
- Status done→in_progress → 400 {error:'Invalid transition...'}
- Unknown task ID → 404
- Invalid priority value → 400
- Empty body → 400 {error:'No fields to update'}

---

### P2-06: DELETE /api/tasks/:id — Soft delete (archive)

**Status:** ⏸️ To Do
**Priority:** High
**Est. Time:** 20 min
**Depends On:** P2-04
**Assigned To:** —
**Description:**
Soft-delete: remove task from tasks.json and append it to current month's archive file. Nothing is ever hard-deleted.

**Steps:**
1. Find task by ID in tasks.json (404 if missing)
2. Remove task from tasks array
3. Add archived_at timestamp to task object
4. Determine archive filename: archive/tasks-YYYY-MM.json (based on current month)
5. withData() on archive file: read existing array (or []), push task, write back
6. withData() on tasks.json: filter out deleted task
7. Return 200 {message:'Task archived', id: task.id}

**Technical Notes:**
Use two sequential withData() calls — first archive, then remove from active. If archive write succeeds but active removal fails, task exists in both (safe — just a duplicate to clean up). The reverse order would risk data loss.

**Acceptance Criteria:**
- Valid ID → task removed from tasks.json
- Task appears in data/archive/tasks-YYYY-MM.json
- Archived task has archived_at timestamp
- Invalid ID → 404
- Archive file created if it doesn't exist

---

### P2-07: POST /api/tasks/:id/activity — Add comment/note

**Status:** ⏸️ To Do
**Priority:** High
**Est. Time:** 15 min
**Depends On:** P2-04
**Assigned To:** —
**Description:**
Append an activity entry (comment, note, or other action) to a task's activity log.

**Steps:**
1. Find task by ID (404 if missing)
2. Validate body: by (required: wilson|athena|system), action (required: comment|note|etc), detail (required: string, max 500 chars)
3. Create activity entry: {at: now_ISO, by, action, detail}
4. Push to task.activity array
5. Set task.updated_at = now
6. withData() to persist
7. Return 200 with new activity entry

**Technical Notes:**
Activity entries are append-only — never edit or delete them. This is the audit trail. Keep detail field concise (max 500 chars) for token efficiency when Athena reads tasks.

**Acceptance Criteria:**
- Valid comment → activity entry appended, updated_at set
- Missing 'by' field → 400
- Missing 'detail' field → 400
- Invalid task ID → 404
- Activity log order is chronological (oldest first)

---

### P2-08: POST /api/tasks/:id/complete — Mark task done with report

**Status:** ⏸️ To Do
**Priority:** Critical
**Est. Time:** 25 min
**Depends On:** P2-05
**Assigned To:** —
**Description:**
Complete a task: sets status=done, records completed_at, attaches completion report. Only valid from in_progress or in_review status.

**Steps:**
1. Find task by ID (404 if missing)
2. Validate current status is in_progress or in_review (400 otherwise)
3. Validate report body:
   - summary: required, string, max 500 chars
   - files_changed: optional, array of strings
   - time_spent_minutes: optional, integer
   - verified: optional, boolean
   - verification_notes: optional, string
4. Set: status='done', completed_at=now, updated_at=now
5. Set: report = {summary, files_changed, time_spent_minutes, verified, verified_at, verification_notes}
6. Append activity: {action:'completed', detail: report.summary}
7. withData() to persist
8. Return 200 with updated task

**Technical Notes:**
This is the primary completion path for Athena. Wilson can also complete tasks directly (he may skip in_review). The report is stored on the task object — it's the deliverable proof. verified_at is set automatically when verified=true.

**Acceptance Criteria:**
- in_progress task + valid report → status=done, completed_at set, report attached
- in_review task → also completes successfully
- backlog task → 400 {error:'Cannot complete task from backlog'}
- Missing summary → 400
- Activity entry includes report.summary

---

### P2-09: POST /api/tasks/:id/reopen — Reopen completed task

**Status:** ⏸️ To Do
**Priority:** High
**Est. Time:** 15 min
**Depends On:** P2-08
**Assigned To:** —
**Description:**
Move a done task back to backlog. Clears completed_at and report. Requires a reason.

**Steps:**
1. Find task by ID (404 if missing)
2. Validate current status is 'done' (400 otherwise)
3. Validate body: reason (required, string)
4. Set: status='backlog', completed_at=null, report=null, updated_at=now
5. Append activity: {action:'reopened', by: req.body.by || 'wilson', detail: reason}
6. withData() to persist
7. Return 200 with updated task

**Technical Notes:**
Only Wilson should reopen tasks (Athena doesn't move things backward). The reason is mandatory for audit trail — prevents accidental reopens.

**Acceptance Criteria:**
- done task + reason → status=backlog, completed_at=null, report=null
- non-done task → 400 {error:'Only done tasks can be reopened'}
- Missing reason → 400
- Activity entry records reopened action + reason

---

### P2-10: POST /api/tasks/:id/verify — Attach verification result

**Status:** ⏸️ To Do
**Priority:** High
**Est. Time:** 15 min
**Depends On:** P2-05
**Assigned To:** —
**Description:**
Attach self-verification results to a task. Used by Athena after executing work to record whether output was verified.

**Steps:**
1. Find task by ID (404 if missing)
2. Validate body: verified (boolean, required), notes (string, optional)
3. Set or create report object on task:
   - report.verified = body.verified
   - report.verified_at = now (if verified=true)
   - report.verification_notes = body.notes
4. If verified=true and status=in_progress → optionally move to in_review
5. Append activity: {action:'verified', detail: notes || 'Verification passed/failed'}
6. Set updated_at = now
7. withData() to persist
8. Return 200 with updated task

**Technical Notes:**
If the task doesn't have a report yet, create a minimal one. Verification is separate from completion — Athena verifies first, then completes. If verified=false, Athena may retry or set status to blocked.

**Acceptance Criteria:**
- verified=true → report.verified=true, report.verified_at set
- verified=false → report.verified=false, no verified_at
- Activity entry logged
- Invalid task ID → 404

---

### P2-11: Subtask endpoints (add, toggle, delete)

**Status:** ⏸️ To Do
**Priority:** High
**Est. Time:** 25 min
**Depends On:** P2-04
**Assigned To:** —
**Description:**
Three endpoints for managing subtasks within a task: POST to add, PATCH to toggle done, DELETE to remove.

**Steps:**

**1. POST /api/tasks/:id/subtasks**
   - Validate: title (required, max 60 chars)
   - Generate subtask ID: st_{3-digit sequential}
   - Create: {id, title, done: false}
   - Push to task.subtasks array
   - Return 201 with new subtask

**2. PATCH /api/tasks/:id/subtasks/:stid**
   - Find subtask by stid within task.subtasks
   - Validate body: done (boolean, required)
   - Toggle: subtask.done = body.done
   - Return 200 with updated subtask

**3. DELETE /api/tasks/:id/subtasks/:stid**
   - Find and remove subtask from array
   - Return 200 {message:'Subtask removed'}

**All three:** set task.updated_at=now, withData() to persist, 404 if task/subtask not found

**Technical Notes:**
Subtask IDs are sequential within a task (st_001, st_002, ...). Find max existing number and increment. Subtask titles max 60 chars for token efficiency. No activity entry needed for subtask changes — they're tracked implicitly.

**Acceptance Criteria:**
- POST with title → subtask added with generated ID, done=false
- PATCH with done:true → subtask toggled
- DELETE → subtask removed from array
- Invalid task ID → 404
- Invalid subtask ID → 404
- Subtask title > 60 chars → 400

---

### P2-12: Project endpoints (list, get, create, update)

**Status:** ⏸️ To Do
**Priority:** High
**Est. Time:** 30 min
**Depends On:** P2-03
**Assigned To:** —
**Description:**
CRUD endpoints for projects. GET endpoints compute _stats from tasks.json at read time (not stored).

**Steps:**

**1. GET /api/projects**
   - Read projects.json + tasks.json
   - For each project, compute _stats by filtering tasks:
     total, backlog, in_progress, blocked, in_review, done,
     completion_pct (done/total * 100), overdue count, critical_count
   - Return array of projects with _stats

**2. GET /api/projects/:id**
   - Find project by ID (404 if missing)
   - Compute _stats
   - Optionally include project's tasks array
   - Return project with _stats

**3. POST /api/projects**
   - Validate: name (required, max 60), code (required, 2-5 uppercase)
   - Generate ID: proj_{slugified_name}
   - Defaults: status='active', color=auto-assign from palette
   - Return 201

**4. PATCH /api/projects/:id**
   - Partial update: name, code, description, status, color, links
   - Return 200

**Technical Notes:**
_stats are always computed at read time, never stored. This keeps data consistent without sync issues. Slugify name for ID: lowercase, replace spaces with underscores, strip non-alphanumeric. completion_pct should handle division by zero (0 tasks = 0%).

**Acceptance Criteria:**
- GET /api/projects → array with _stats on each project
- _stats.total matches actual task count for that project
- _stats.completion_pct correct (handles 0 tasks)
- POST with valid name+code → 201 with generated ID
- Duplicate code → 400
- PATCH updates fields, returns updated project

---

### P2-13: GET /api/dashboard — Aggregated overview

**Status:** ⏸️ To Do
**Priority:** Medium
**Est. Time:** 20 min
**Depends On:** P2-03, P2-12
**Assigned To:** —
**Description:**
Single endpoint returning a dashboard summary: project stats, urgent items, overdue count, recent activity. Designed for UI landing view.

**Steps:**
1. Read tasks.json and projects.json
2. Compute per-project stats (reuse logic from P2-12)
3. Compute global stats:
   - total_active (non-done tasks)
   - total_done
   - overdue_count
   - critical_count (critical priority + non-done)
   - blocked_count
4. Get recent_activity: flatten all task activities, sort by timestamp desc, take top 10
5. Get urgent_tasks: critical/high priority + non-done, sorted by priority, limit 5
6. Return: {stats, projects: [...with _stats], recent_activity, urgent_tasks}

**Technical Notes:**
This endpoint is called on UI page load and every poll cycle. Keep response compact — don't include full task objects in urgent_tasks, just id, title, priority, status, deadline, assigned_to.

**Acceptance Criteria:**
- Returns stats object with total_active, total_done, overdue_count, etc.
- projects array includes _stats per project
- recent_activity returns max 10 entries, sorted newest-first
- urgent_tasks returns max 5 high/critical non-done tasks
- Response is compact (no full task bodies in urgent list)

---

### P2-14: GET /api/health — Enhanced with task/project counts

**Status:** ⏸️ To Do
**Priority:** Low
**Est. Time:** 10 min
**Depends On:** P2-03
**Assigned To:** —
**Description:**
Upgrade Phase 1 health endpoint to include task_count, project_count, and data directory disk usage.

**Steps:**
1. Read tasks.json → count tasks
2. Read projects.json → count projects
3. Get data dir size: sum file sizes in data/ directory
4. Return: {ok:true, uptime_seconds, timestamp, task_count, project_count, data_size_kb}

**Technical Notes:**
Keep this lightweight — it's called frequently for monitoring. Don't JSON.parse full files just to count; use a simple array length check. The disk usage is informational only.

**Acceptance Criteria:**
- Returns task_count and project_count as integers
- Returns data_size_kb as number
- Response time < 50ms
- Still works without auth (liveness check)

---

### P2-15: Input validation helpers

**Status:** ⏸️ To Do
**Priority:** Medium
**Est. Time:** 20 min
**Depends On:** P2-01
**Assigned To:** —
**Description:**
Create reusable validation helper functions used across all endpoints. Centralizes validation logic to avoid duplication and ensure consistent error messages.

**Steps:**
1. Create validation helpers (inline or separate module):
   - validateString(val, field, min, max) → error message or null
   - validateEnum(val, field, allowed) → error message or null
   - validateISO8601(val, field) → error message or null
   - validateArray(val, field) → error message or null
2. Create sendError(res, status, message) helper
3. Create findTaskOr404(tasks, id, res) helper → returns task or sends 404
4. Refactor existing endpoints to use these helpers

**Technical Notes:**
No schema library (Joi, Zod, etc.) needed. Keep it simple — each helper returns null on success or an error string on failure. This can be done as a refactoring pass after core endpoints work, or upfront if preferred.

**Acceptance Criteria:**
- All validation errors return 400 with {error: 'specific message'}
- Error messages are human-readable and specific
- No duplicate validation logic across endpoints
- Helpers are reusable by all route handlers

---

### P2-16: Integration test — Full API round-trip via curl

**Status:** ⏸️ To Do
**Priority:** High
**Est. Time:** 30 min
**Depends On:** P2-01 through P2-14
**Assigned To:** —
**Description:**
Write a shell script (or run manually) that tests the full API lifecycle: create task → list → update → add subtasks → add comment → verify → complete → reopen → delete. This validates Phase 2 end-to-end.

**Steps:**
1. Create test script: test-api.sh
2. Test sequence:
   a. POST /api/tasks → create task, capture ID
   b. GET /api/tasks → verify task appears in list
   c. GET /api/tasks/:id → verify single task
   d. PATCH /api/tasks/:id {status:'in_progress'} → verify transition
   e. POST /api/tasks/:id/subtasks → add 2 subtasks
   f. PATCH /api/tasks/:id/subtasks/:stid {done:true} → toggle
   g. POST /api/tasks/:id/activity → add comment
   h. POST /api/tasks/:id/verify → self-verify
   i. POST /api/tasks/:id/complete → complete with report
   j. POST /api/tasks/:id/reopen → reopen
   k. DELETE /api/tasks/:id → soft delete
   l. GET /api/projects → verify _stats
   m. GET /api/dashboard → verify aggregates
3. Test error cases: invalid token, missing fields, invalid transitions
4. All tests pass = Phase 2 complete

**Technical Notes:**
Use curl with -s -w '\n%{http_code}' to capture status codes. Compare expected vs actual. This script doubles as documentation for how Athena will call the API. Keep it in the project root as test-api.sh.

**Acceptance Criteria:**
- Full lifecycle (create→list→update→subtask→comment→verify→complete→reopen→delete) passes
- All expected status codes match (201, 200, 400, 404, 401)
- Invalid token returns 401
- Invalid state transitions return 400
- Dashboard and project stats reflect task changes correctly

---

## Progress Summary

- **Total Tasks:** 16
- **Critical:** 5 tasks
- **High:** 7 tasks
- **Medium:** 3 tasks
- **Low:** 1 task
- **Completed:** 1/16
- **Estimated Time:** 3-4 hours
- **Latest Completion:** P2-01 (Auth middleware) - 2026-02-11 02:37 UTC

**Phase 2 Goal:** Full CRUD for tasks and projects. Athena and UI can both create, read, update, and delete tasks.

---

## Differences from PLAN.md

The Google Sheet has the following differences from the original PLAN.md Phase 2 specification:

1. **P2-11 (Subtask endpoints)**: Combined what was P2-11, P2-12, P2-13 in PLAN.md into a single task covering three endpoints (add, toggle, delete)
2. **Added P2-15 (Input validation helpers)**: New task to centralize validation logic across endpoints
3. **Added P2-16 (Integration test)**: New task for end-to-end API testing
4. **Reorganized dependencies**: Some tasks have different dependencies in the sheet vs PLAN.md

These changes reflect optimizations and additional tasks identified during implementation planning.

---

## Dependencies

- **Phase 1 complete:** Required
- **Phase 3 (UI Shell):** Can start in parallel after P2-01 (auth middleware), but full UI needs most P2 tasks
- **Phase 4 (Athena Read):** Needs P2-03 (GET /api/tasks), P2-12 (GET /api/projects)
- **Phase 5 (Athena Execute):** Needs all task CRUD endpoints (P2-02 through P2-10)

---

*This file tracks Phase 2 tasks from the Google Sheet (athena-tasks-phase2-3.xlsx). Each task includes description, steps, technical notes, and acceptance criteria.*
