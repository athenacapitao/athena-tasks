# Phase 3: UI Shell & Task List

**Status:** 📝 Planning - Ingested
**Estimated Time:** ~7 hours 25 minutes
**Task Count:** 19 tasks

---

## Overview

Phase 3 builds the complete web UI for Athena Tasks - a single-page application with task management, project filtering, inline editing, and real-time sync. All UI lives in `ui.html` with inline CSS/JS.

---

## Task Summary

| Task | Title | Priority | Est. Time | Dependencies |
|------|-------|----------|-----------|--------------|
| P3-01 | Token entry and auth handling | Critical | 20 min | P2-01 |
| P3-02 | CSS foundation — Dark theme and variables | Critical | 25 min | — |
| P3-03 | Header bar component | High | 15 min | P3-02 |
| P3-04 | Project tabs bar | High | 25 min | P3-02, P2-12 |
| P3-05 | Filter row with dropdowns | Medium | 30 min | P3-02 |
| P3-06 | Task list — Render task rows | Critical | 40 min | P3-02, P2-03 |
| P3-07 | Done section — Collapsible completed tasks | Medium | 15 min | P3-06 |
| P3-08 | Detail panel — Layout and navigation | Critical | 30 min | P3-06 |
| P3-09 | Detail panel — Inline field editing | Critical | 30 min | P3-08, P2-05 |
| P3-10 | Detail panel — Title and description editing | High | 20 min | P3-08, P2-05 |
| P3-11 | Detail panel — Subtask management | High | 25 min | P3-08, P2-11 |
| P3-12 | Detail panel — Activity log and comment input | High | 25 min | P3-08, P2-07 |
| P3-13 | Detail panel — Report display | Medium | 15 min | P3-08 |
| P3-14 | New Task modal | Critical | 30 min | P3-02, P2-02 |
| P3-15 | Auto-refresh polling (5-second interval) | High | 15 min | P3-06 |
| P3-16 | Footer bar with stats | Medium | 10 min | P3-02 |
| P3-17 | Deadline and tags display/edit | Medium | 20 min | P3-08, P2-05 |
| P3-18 | App state management and render loop | Critical | 30 min | P3-02 |
| P3-19 | Quick-complete checkbox on task rows | Medium | 15 min | P3-06, P2-08 |
| P3-20 | Integration test — Full UI walkthrough | High | 20 min | P3-01 through P3-19 |

---

## Critical Path

The minimal sequence to get a functional UI:

1. **P3-02** (CSS foundation) - Visual baseline
2. **P3-01** (Auth handling) - Login modal + token storage
3. **P3-18** (App state) - Core architecture
4. **P3-06** (Task list rendering) - Main content area
5. **P3-03** (Header) + **P3-04** (Tabs) + **P3-16** (Footer) - Layout shell
6. **P3-08** (Detail panel layout) + **P3-09** (Inline editing) - Task CRUD
7. **P3-14** (New Task modal) - Create capability
8. **P3-15** (Auto-refresh) - Real-time sync

**Result:** Fully functional task management UI

---

## Task Details

### P3-01: Token entry and auth handling
**Priority:** Critical | **Time:** 20 min | **Depends on:** P2-01

On first load, prompt user for API token. Store in localStorage. Attach to all API calls. Show error on invalid token. Provide logout/re-enter option.

**Key Steps:**
1. Check localStorage for 'athena_tasks_token' on load
2. If missing → show modal with input field + 'Connect' button
3. Test token with GET /api/health (auth header)
4. Success → store token, close modal, load dashboard
5. Failure → show 'Invalid token' error
6. Create api() helper for all fetch calls with Authorization header
7. Add 'Disconnect' button to clear token
8. Handle 401 responses globally → clear token + show modal

**Acceptance Criteria:**
- First visit with no token → modal appears
- Valid token → modal closes, dashboard loads
- Invalid token → error message, modal stays open
- Token persists after page reload
- 401 from any API call → redirects to token modal

---

### P3-02: CSS foundation — Dark theme and variables
**Priority:** Critical | **Time:** 25 min | **Depends on:** —

Set up complete CSS foundation inside ui.html <style> block: CSS variables, reset, typography, base layout.

**Key Steps:**
1. Define CSS variables in :root:
   - Background: --bg-base:#0D0D0D, --bg-surface:#161616, --bg-elevated:#1E1E1E, --bg-hover:#252525
   - Text: --text-primary:#E5E5E5, --text-secondary:#888, --text-muted:#555
   - Border: --border:#2A2A2A, --border-focus:#404040
   - Status: backlog=#6B7280, in_progress=#3B82F6, blocked=#EF4444, in_review=#F59E0B, done=#10B981
   - Priority: critical=#DC2626, high=#F97316, medium=#EAB308, low=#6B7280
   - Accent: --accent:#3B82F6, --accent-hover:#2563EB
2. CSS reset: *, *::before, *::after { margin:0; padding:0; box-sizing:border-box }
3. Font: Google Fonts Inter with system fallback
4. Monospace: 'SF Mono','JetBrains Mono','Consolas', monospace
5. Base layout: body flexbox column, 100vh. Header fixed 48px, footer fixed 28px, content flex-grow overflow-y:auto
6. Mobile breakpoint: @media (max-width: 640px)

**Acceptance Criteria:**
- All CSS variables defined and accessible
- Page background is #0D0D0D, text is #E5E5E5
- Inter font loads from Google Fonts
- Layout: header and footer fixed, content scrolls
- Mobile breakpoint at 640px

---

### P3-03: Header bar component
**Priority:** High | **Time:** 15 min | **Depends on:** P3-02

Fixed header bar: logo text on left, search icon and '+ New' button on right.

**Key Steps:**
1. Create header element: fixed top, 48px height, full width
2. Left: 'athena-tasks' text (--text-secondary, 13px)
3. Right: Search icon button + '+ New' primary button
4. Style '+ New' button: bg --accent, white, radius 8px, height 36px, padding 0 16px
5. Search icon: magnifier emoji or SVG, ghost button style
6. Flexbox layout: justify-content space-between, padding 0 16px

**Acceptance Criteria:**
- Header fixed at top, 48px height
- Logo on left, buttons on right
- '+ New' button styled with accent color
- Does not scroll with content

---

### P3-04: Project tabs bar
**Priority:** High | **Time:** 25 min | **Depends on:** P3-02, P2-12

Horizontal tab bar below header showing 'ALL' + each project with active task count. Click to filter.

**Key Steps:**
1. Fetch projects from GET /api/projects (includes _stats)
2. Render tab bar: 40px height, horizontal scroll (overflow-x auto)
3. First tab: 'ALL ({total_active_count})'
4. Subsequent tabs: '{project.name} ({active_count})'
5. Active tab: text --text-primary, bottom border 2px with project color
6. Inactive tab: text --text-secondary, no underline
7. Click handler: set active project filter → re-render task list
8. Store selected project in app state

**Acceptance Criteria:**
- ALL tab + one tab per project rendered
- Each tab shows correct active task count
- Clicking tab filters task list
- Active tab has colored underline
- Horizontal scroll on mobile

---

### P3-05: Filter row with dropdowns
**Priority:** Medium | **Time:** 30 min | **Depends on:** P3-02

Filter row below tabs with dropdowns for Status, Priority, Assigned, Tags. Active filters show as pills.

**Key Steps:**
1. Create filter row: 36px height, flex row, gap 8px
2. Each filter: dropdown button with label + current value
3. Dropdown content: checkboxes for multi-select
   - Status: backlog, in_progress, blocked, in_review
   - Priority: critical, high, medium, low
   - Assigned: wilson, athena, shared
   - Tags: dynamic from all tasks
4. Active filters show as colored pills
5. 'Clear' link resets all filters
6. Filters combine with AND logic
7. Store filter state → re-render on change

**Acceptance Criteria:**
- Four dropdown buttons render
- Multi-select works for each filter
- Active filters show as removable pills
- Filters apply immediately
- 'Clear' resets all filters
- AND logic for multiple filters

---

### P3-06: Task list — Render task rows
**Priority:** Critical | **Time:** 40 min | **Depends on:** P3-02, P2-03

Main content area: render each task as 56px row with priority bar, checkbox, title, metadata, status pill, subtask progress.

**Key Steps:**
1. Fetch tasks: GET /api/tasks with filters
2. For each task, create row (56px height):
   - Left edge: 3px vertical bar in priority color
   - Checkbox: circle for quick-complete
   - Title: 16px, font-weight 500, --text-primary
   - Metadata line (13px, --text-secondary): project · tags · Due {date}
   - Right: status pill (24px rounded, status color)
   - Subtask progress bar: thin 2px below metadata
3. Overdue: deadline in red with '⚠ OVERDUE'
4. Blocked rows: subtle red-tinted background
5. Click row → open detail panel
6. Use textContent (XSS safe)

**Acceptance Criteria:**
- All active tasks render with correct styling
- Priority color bar visible on left
- Status pill shows correct color/text
- Overdue tasks show red warning
- Blocked rows have tinted background
- Subtask progress bar shows correct ratio
- Click row opens detail panel

---

### P3-07: Done section — Collapsible completed tasks
**Priority:** Medium | **Time:** 15 min | **Depends on:** P3-06

Below active task rows, render collapsible '▸ Done (N)' section showing last 20 completed tasks.

**Key Steps:**
1. Fetch done tasks: GET /api/tasks?include_done=true&status=done&limit=20
2. Render toggle header: '▸ Done ({count})' — collapsed by default
3. On click: expand to show done tasks in muted style
   - Opacity 0.5, strikethrough on title
   - Show completed_at date
4. Toggle icon: ▸ (collapsed) / ▾ (expanded)
5. Store collapsed/expanded state

**Acceptance Criteria:**
- 'Done (N)' header shows correct count
- Collapsed by default
- Click toggles visibility
- Done tasks show muted/strikethrough style
- Sorted by completed_at descending

---

### P3-08: Detail panel — Layout and navigation
**Priority:** Critical | **Time:** 30 min | **Depends on:** P3-06

Slide-in panel from right showing all task details. Back button to close. Sections: title, dropdowns, deadline/tags, description, subtasks, links, activity, report.

**Key Steps:**
1. Create panel container: position fixed, right 0, 100vh height, 420px width
   - bg --bg-surface, left border 1px --border, z-index 100
   - Slide animation: translateX(100%) → translateX(0), 200ms ease
2. Panel header: '← Back' button + '⋮ More' menu (48px)
3. Scrollable content with sections:
   - Title (20px semibold)
   - 2×2 grid: Status, Priority, Assigned, Project dropdowns
   - Deadline + Tags row
   - Description
   - Subtasks
   - Links
   - Activity log
   - Report (only when status=done)
4. '← Back' or Esc → close panel with reverse animation
5. Mobile (<640px): full-screen overlay

**Acceptance Criteria:**
- Panel slides in from right
- All section areas visible
- Back button closes panel
- Esc key closes panel
- 420px width desktop, full-screen mobile
- Smooth slide animation

---

### P3-09: Detail panel — Inline field editing
**Priority:** Critical | **Time:** 30 min | **Depends on:** P3-08, P2-05

Make status/priority/assigned/project fields clickable dropdowns that update via PATCH. Optimistic UI.

**Key Steps:**
1. Each field displays current value as styled element
2. Click → opens dropdown with allowed values
   - Status: valid transitions only
   - Priority: color-coded options
   - Assigned: wilson, athena, shared
   - Project: list from /api/projects
3. Select → optimistic UI update
4. Call PATCH /api/tasks/:id with new value
5. On success: keep updated value
6. On error: revert, show toast
7. Close dropdown on selection/click-outside

**Acceptance Criteria:**
- Click status → dropdown shows valid transitions
- Select new priority → updates immediately, PATCH sent
- API error → value reverts, toast shown
- Project dropdown lists all projects
- Dropdown closes on selection/click-outside

---

### P3-10: Detail panel — Title and description editing
**Priority:** High | **Time:** 20 min | **Depends on:** P3-08, P2-05

Make title and description editable inline. Click to edit, blur/Enter to save.

**Key Steps:**
1. Title: display as text. Click → switch to <input>
   - Enter/blur → PATCH /api/tasks/:id {title: newValue}
   - Esc → cancel, revert
   - Validate: 3-200 chars
2. Description: display as text block. Click → switch to <textarea>
   - Blur → PATCH /api/tasks/:id {description: newValue}
   - Esc → cancel, revert
   - Auto-resize textarea
3. Show subtle edit icon on hover
4. Render description with preserved line breaks (pre-wrap)

**Acceptance Criteria:**
- Click title → becomes editable input
- Enter/blur saves new title via PATCH
- Esc cancels edit without saving
- Click description → becomes editable textarea
- Line breaks preserved
- Edit icon visible on hover

---

### P3-11: Detail panel — Subtask management
**Priority:** High | **Time:** 25 min | **Depends on:** P3-08, P2-11

Subtask section: checkbox toggle, add new subtask, delete subtask. Shows count header.

**Key Steps:**
1. Section header: 'SUBTASKS ({done}/{total})'
2. Render each subtask as row (32px height):
   - Checkbox (checked if done)
   - Title text (strikethrough if done, --text-muted)
   - Delete '×' button on hover
3. Checkbox click → PATCH /api/tasks/:id/subtasks/:stid {done: !current}
4. Delete click → DELETE /api/tasks/:id/subtasks/:stid (confirm)
5. '+ Add subtask' at bottom:
   - Click → show inline input
   - Enter → POST /api/tasks/:id/subtasks {title: value}
   - Clear input after creation
6. Optimistic UI for toggle and add

**Acceptance Criteria:**
- Subtask count header shows correct done/total
- Checkbox toggles done state via API
- Done subtasks show strikethrough
- '+ Add subtask' creates new subtask
- Delete button removes subtask
- Optimistic updates for toggle

---

### P3-12: Detail panel — Activity log and comment input
**Priority:** High | **Time:** 25 min | **Depends on:** P3-08, P2-07

Activity log: reverse-chronological list of all activity entries. Comment input at bottom.

**Key Steps:**
1. Section header: 'ACTIVITY'
2. Render each activity entry:
   - Actor + relative timestamp: 'Athena · 2h ago' (11px, --text-secondary)
   - Action detail text (14px, --text-primary)
   - Status changes: 'Status: old → new'
   - Comments: show detail text
3. Order: reverse-chronological
4. Comment input at bottom:
   - Text input: 'Add a comment...' placeholder
   - Enter → POST /api/tasks/:id/activity {by:'wilson', action:'comment', detail: value}
   - Clear input after submit
5. Relative time function: just now, Nm ago, Nh ago, Nd ago, or date string

**Acceptance Criteria:**
- Activity entries render reverse-chronological
- Each entry shows actor, relative time, detail
- Status changes formatted 'old → new'
- Comment input submits new entry
- New comment appears immediately at top
- Relative timestamps are human-readable

---

### P3-13: Detail panel — Report display
**Priority:** Medium | **Time:** 15 min | **Depends on:** P3-08

When task is done and has report, display completion report: verified status, summary, files changed, time spent.

**Key Steps:**
1. Show report section only when task.status === 'done' AND task.report exists
2. Section header: 'REPORT'
3. Render:
   - Verification badge: '✅ Verified · {date}' or '⚠ Not verified'
   - Summary text (14px)
   - Files changed: list of file paths in monospace
   - Time spent: '{N} minutes'
   - Verification notes (if present)
4. Style: bg --bg-elevated, padding 12px, radius 8px

**Acceptance Criteria:**
- Report section visible only for done tasks with report
- Verified badge shows correct state and date
- Summary, files, and time rendered correctly
- Hidden for non-done tasks
- Monospace font for file paths

---

### P3-14: New Task modal
**Priority:** Critical | **Time:** 30 min | **Depends on:** P3-02, P2-02

Modal dialog for creating new task. Title (required), description, project, priority, assigned, deadline, tags.

**Key Steps:**
1. Trigger: '+ New' button in header
2. Modal: centered, max-width 480px, bg --bg-elevated, overlay rgba(0,0,0,0.7)
3. Fields:
   - Title: text input (auto-focus on open), required
   - Description: textarea, 4 rows default, optional
   - Two-column grid: Project + Priority dropdowns
   - Two-column grid: Assigned + Deadline input
   - Tags: text input (comma-separated)
4. Buttons: 'Cancel' (secondary) + 'Create Task ↵' (primary)
5. Enter key submits (not in textarea)
6. Esc key closes modal
7. On submit: POST /api/tasks → close modal → refresh task list
8. Validation: show inline error if title empty

**Acceptance Criteria:**
- Modal opens from '+ New' button
- Title input auto-focused
- Only title required — others have defaults
- Enter submits, Esc cancels
- Successful create → modal closes, task appears
- Empty title → inline error
- Tags parsed as comma-separated lowercase

---

### P3-15: Auto-refresh polling (5-second interval)
**Priority:** High | **Time:** 15 min | **Depends on:** P3-06

Poll GET /api/tasks every 5 seconds to keep UI in sync with changes made by Athena or other sources.

**Key Steps:**
1. Set interval at 5000ms calling fetchAndRender()
2. fetchAndRender():
   - GET /api/tasks with current filters
   - Compare with current state
   - If changed: re-render task list
   - If unchanged: skip (avoid flicker)
3. Update lastSyncTime on each successful poll
4. Footer 'Synced' indicator: update every second showing 'Synced Ns ago'
5. Pause polling when document.hidden
6. Resume when tab visible

**Acceptance Criteria:**
- Task list updates within 5 seconds of external change
- 'Synced Ns ago' updates in real-time
- No flicker on unchanged data
- Polling pauses when tab hidden
- Scroll position preserved on re-render

---

### P3-16: Footer bar with stats
**Priority:** Medium | **Time:** 10 min | **Depends on:** P3-02

Fixed footer bar: left side shows task stats, right side shows sync indicator.

**Key Steps:**
1. Create footer: fixed bottom, full width, 28px height, bg --bg-surface, border-top
2. Left: '{N} active · {N} done · {N} overdue' (--text-secondary, 11px)
3. Right: 'Synced {N}s ago' (--text-muted, 11px)
4. Update stats from fetched task data
5. Overdue count in red if > 0

**Acceptance Criteria:**
- Footer fixed at bottom, 28px height
- Stats show correct active, done, overdue counts
- Sync indicator shows time since last poll
- Overdue count highlighted in red when > 0

---

### P3-17: Deadline and tags display/edit
**Priority:** Medium | **Time:** 20 min | **Depends on:** P3-08, P2-05

In detail panel: display deadline with edit capability (date picker), display tags as pills with add/remove.

**Key Steps:**
1. Deadline display: 'Due {formatted date}' or 'No deadline'
   - [Edit] link → show date input (type='date')
   - On change → PATCH /api/tasks/:id {deadline: ISO string}
   - If overdue → red text with '⚠ OVERDUE'
2. Tags display: row of pill elements
   - Each pill: 22px height, bg --bg-elevated, radius 4px, padding 2px 8px
   - Click '×' → remove tag via PATCH
   - '+ Add tag' → show inline input
   - Enter → add tag via PATCH, clear input
3. Tags are always lowercase, trimmed

**Acceptance Criteria:**
- Deadline displays formatted date
- Edit opens date picker, saves on change
- Overdue deadline shows red warning
- Tags render as pills
- Can add and remove tags
- Tags are always lowercase

---

### P3-18: App state management and render loop
**Priority:** Critical | **Time:** 30 min | **Depends on:** P3-02

Core JavaScript architecture: app state object, render functions, event binding pattern.

**Key Steps:**
1. Create app state object:
   ```
   const state = {
     tasks: [], projects: [], token: null,
     filters: {status:[], priority:[], assigned_to:null, project_id:null, tag:null},
     selectedTaskId: null, selectedProject: null,
     panelOpen: false, modalOpen: false,
     lastSync: null
   }
   ```
2. Create render functions:
   - renderProjectTabs()
   - renderTaskList()
   - renderDetailPanel(taskId)
   - renderFooter()
3. Main loop: fetchData() → update state → call render functions
4. Event delegation: attach listeners to parent containers, use data-* attributes
5. api() function: centralized fetch with auth header and error handling

**Acceptance Criteria:**
- State object holds all app data
- Render functions update DOM from state
- Event delegation handles clicks efficiently
- api() helper handles auth, JSON parsing, error handling
- State changes trigger appropriate re-renders

---

### P3-19: Quick-complete checkbox on task rows
**Priority:** Medium | **Time:** 15 min | **Depends on:** P3-06, P2-08

Checkbox on each task row for quick completion. Click triggers POST /complete with minimal report.

**Key Steps:**
1. Render checkbox circle on left side of task row
2. Click checkbox → prevent row click (stopPropagation)
3. If task is backlog → first PATCH to in_progress, then POST /complete
4. POST /api/tasks/:id/complete with minimal report:
   `{summary:'Completed via quick action', verified:false}`
5. Optimistic UI: immediately move task to done section with fade-out
6. Brief celebration: green checkmark animation or subtle confetti
7. On error: revert, show toast

**Acceptance Criteria:**
- Checkbox click completes task via API
- Task moves to done section with animation
- Does not trigger row click (detail panel)
- Optimistic update with rollback on error
- Brief visual celebration on complete

---

### P3-20: Integration test — Full UI walkthrough
**Priority:** High | **Time:** 20 min | **Depends on:** P3-01 through P3-19

Manual integration test: verify full UI works end-to-end. Test on desktop and mobile viewport.

**Test Steps:**
1. Test auth flow: enter token, verify dashboard loads
2. Test project tabs: click each tab, verify filtering
3. Test filters: apply status + priority filters, verify results
4. Test new task: create via modal, verify appears in list
5. Test detail panel: click task, verify all sections render
6. Test inline editing: change status, priority, title, description
7. Test subtasks: add, toggle, delete
8. Test activity: add comment, verify in log
9. Test quick-complete: checkbox on task, verify done section
10. Test auto-refresh: create task via curl, verify appears within 5s
11. Test mobile: resize to <640px, verify all interactions work
12. Test footer: verify stats and sync indicator

**Acceptance Criteria:**
- All 12 test steps pass
- No JavaScript console errors
- Mobile viewport: all interactions functional
- Auto-refresh detects external changes within 5s
- All CRUD operations work via UI

---

## Technical Stack

- **Framework:** Vanilla JavaScript (no frameworks)
- **Storage:** localStorage for auth token
- **API Fetch:** Custom api() helper with auth header
- **CSS:** All inline in ui.html <style> block
- **Fonts:** Google Fonts Inter (with system fallback)
- **Rendering:** DOM manipulation with textContent (XSS safe)
- **State:** Simple object with reactive render pattern
- **Events:** Event delegation with data-* attributes

---

## File Structure

```
athena-tasks/
├── ui.html                    # Single-page UI (all HTML/CSS/JS inline)
├── server.js                  # Express server (Phase 2 complete)
├── data/
│   ├── tasks.json             # Task storage
│   ├── projects.json          # Project registry
│   └── archive/               # Soft-deleted tasks
├── PLAN.md                    # Full roadmap
├── PHASE1-TASKS.md            # Foundation (✅ complete)
├── PHASE2-TASKS.md            # API endpoints (✅ complete)
└── PHASE3-TASKS.md            # UI shell (📝 this file)
```

---

## Dependencies on Previous Phases

- **P2-01:** GET /api/health - Health check endpoint
- **P2-02:** POST /api/tasks - Create task endpoint
- **P2-03:** GET /api/tasks - List tasks with filters endpoint
- **P2-05:** PATCH /api/tasks/:id - Update task endpoint
- **P2-07:** GET /api/tasks/:id/activity - Activity log endpoint
- **P2-08:** POST /api/tasks/:id/complete - Complete task endpoint
- **P2-11:** Subtask endpoints (add, toggle, delete)
- **P2-12:** GET /api/projects - Projects list endpoint

All Phase 2 endpoints must be complete and tested before Phase 3.

---

## Next Steps

1. **Review all tasks** with Wilson — confirm scope and priorities
2. **Update PLAN.md** with Phase 3 breakdown
3. **Create ui.html** with basic HTML structure
4. **Start execution** following the critical path sequence
5. **Test incrementally** — each task verified before moving to next

---

**Document created:** 2026-02-11
**Phase 3 ready for execution:** ✅
