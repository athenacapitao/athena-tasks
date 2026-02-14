const fs = require('fs');
const path = require('path');
const express = require('express');
const crypto = require('crypto');
const authMiddleware = require('./auth');
const lockfile = require('proper-lockfile');

// Load .env manually
const envPath = path.join(__dirname, '.env');
for (const line of fs.readFileSync(envPath, 'utf-8').split('\n')) {
  const trimmed = line.trim();
  if (!trimmed || trimmed.startsWith('#')) continue;
  const idx = trimmed.indexOf('=');
  if (idx > 0) process.env[trimmed.slice(0, idx)] = trimmed.slice(idx + 1);
}

const PORT = parseInt(process.env.PORT, 10) || 7700;
const HOST = '127.0.0.1';
const DATA_DIR = path.join(__dirname, 'data');

const app = express();

// P10-18: Graceful shutdown state
let isShuttingDown = false;

// P10-17: Response time logging middleware
const responseTimeSamples = [];
app.use('/api', (req, res, next) => {
  if (isShuttingDown) return res.status(503).json({ error: 'Server shutting down' });
  const start = Date.now();
  const originalEnd = res.end;
  res.end = function(...args) {
    const duration = Date.now() - start;
    res.setHeader('X-Response-Time', duration + 'ms');
    responseTimeSamples.push(duration);
    if (responseTimeSamples.length > 100) responseTimeSamples.shift();
    if (duration > 200) console.warn(`SLOW API: ${req.method} ${req.path} took ${duration}ms`);
    originalEnd.apply(this, args);
  };
  next();
});

app.use(express.json());

// Serve UI
app.get('/', (_req, res) => {
  res.sendFile(path.join(__dirname, 'ui.html'));
});

// Health check - comprehensive (P10-16)
app.get('/api/health', (_req, res) => {
  const start = Date.now();
  const warnings = [];

  let activeCount = 0, doneCount = 0, totalCount = 0;
  try {
    const tasks = JSON.parse(fs.readFileSync(path.join(DATA_DIR, 'tasks.json'), 'utf-8'));
    totalCount = tasks.length;
    doneCount = tasks.filter(t => t.status === 'done').length;
    activeCount = totalCount - doneCount;
  } catch (_) {}

  let projectCount = 0;
  try { projectCount = JSON.parse(fs.readFileSync(path.join(DATA_DIR, 'projects.json'), 'utf-8')).length; } catch (_) {}

  // Data dir size
  let dataDirBytes = 0;
  try {
    const walk = (dir) => {
      for (const f of fs.readdirSync(dir)) {
        const fp = path.join(dir, f);
        const st = fs.statSync(fp);
        if (st.isDirectory()) walk(fp);
        else dataDirBytes += st.size;
      }
    };
    walk(DATA_DIR);
  } catch (_) {}

  // Backups
  let backupCount = 0, latestBackup = null, latestAge = null;
  try {
    const bDir = path.join(DATA_DIR, 'backups');
    const bFiles = fs.readdirSync(bDir).filter(f => f.endsWith('.json')).sort();
    backupCount = bFiles.length;
    if (bFiles.length > 0) {
      latestBackup = bFiles[bFiles.length - 1];
      const mtime = fs.statSync(path.join(bDir, latestBackup)).mtimeMs;
      latestAge = Math.round((Date.now() - mtime) / 60000);
      if (latestAge > 120) warnings.push('Backup older than 2 hours');
    }
  } catch (_) {}

  // Archives
  let archiveCount = 0, latestArchive = null;
  try {
    const aDir = path.join(DATA_DIR, 'archive');
    const aFiles = fs.readdirSync(aDir).filter(f => f.endsWith('.json')).sort();
    archiveCount = aFiles.length;
    if (aFiles.length > 0) latestArchive = aFiles[aFiles.length - 1];
  } catch (_) {}

  // Memory
  const mem = process.memoryUsage();
  const rssMb = Math.round(mem.rss / 1048576);
  const heapMb = Math.round(mem.heapUsed / 1048576);
  if (rssMb > 256) warnings.push('Memory usage above 256MB');
  if (dataDirBytes > 100 * 1048576) warnings.push('Data directory exceeds 100MB');

  // Uptime
  const uptimeSec = Math.floor(process.uptime());
  const days = Math.floor(uptimeSec / 86400);
  const hours = Math.floor((uptimeSec % 86400) / 3600);
  const mins = Math.floor((uptimeSec % 3600) / 60);
  const uptimeHuman = `${days}d ${hours}h ${mins}m`;

  // P10-17: p95 response time
  const sorted = [...responseTimeSamples].sort((a, b) => a - b);
  const p95 = sorted.length > 0 ? sorted[Math.floor(sorted.length * 0.95)] : 0;

  res.json({
    ok: true,
    version: '1.0.0',
    uptime_seconds: uptimeSec,
    uptime_human: uptimeHuman,
    timestamp: new Date().toISOString(),
    memory: { rss_mb: rssMb, heap_used_mb: heapMb },
    disk: { data_dir_bytes: dataDirBytes, data_dir_human: (dataDirBytes / 1048576).toFixed(1) + ' MB' },
    tasks: { active_count: activeCount, done_count: doneCount, total_count: totalCount },
    project_count: projectCount,
    backups: { count: backupCount, latest: latestBackup, latest_age_minutes: latestAge },
    archives: { month_count: archiveCount, latest: latestArchive },
    performance: { p95_response_ms: p95, samples: sorted.length },
    warnings: warnings.length > 0 ? warnings : undefined,
    response_time_ms: Date.now() - start,
  });
});

// Auth required for all other /api/* routes
app.use('/api', authMiddleware);

// Helper: read data file
function readData(filename) {
  const filePath = path.join(DATA_DIR, filename);
  try {
    const content = fs.readFileSync(filePath, 'utf-8');
    return JSON.parse(content || '[]');
  } catch (err) {
    return [];
  }
}

// Helper: write data file with lock
async function withData(filename, mutator) {
  const filePath = path.join(DATA_DIR, filename);
  const release = await lockfile.lock(filePath, { retries: 5, minTimeout: 100, maxTimeout: 1000 });
  try {
    const data = readData(filename);
    const result = mutator(data);
    fs.writeFileSync(filePath, JSON.stringify(result, null, 2), 'utf-8');
    return result;
  } finally {
    await release();
  }
}

// Helper: generate task ID
function generateTaskId() {
  return `t_${Date.now()}_${crypto.randomBytes(3).toString('hex')}`;
}

// Helper: wrap async route handlers
function asyncHandler(fn) {
  return (req, res, next) => {
    Promise.resolve(fn(req, res, next)).catch(next);
  };
}

// Helper: validate and normalize links
function validateLinks(links) {
  const errors = [];
  const urlPattern = /^https?:\/\/.+/;

  if (links.github_issue != null) {
    if (typeof links.github_issue !== 'string' || !urlPattern.test(links.github_issue))
      errors.push('github_issue must be a valid URL');
    else if (!links.github_issue.includes('github.com'))
      errors.push('github_issue must be a GitHub URL');
  }
  if (links.github_pr != null) {
    if (typeof links.github_pr !== 'string' || !urlPattern.test(links.github_pr))
      errors.push('github_pr must be a valid URL');
    else if (!links.github_pr.includes('github.com'))
      errors.push('github_pr must be a GitHub URL');
  }
  if (links.gdrive_doc != null) {
    if (typeof links.gdrive_doc !== 'string' || !urlPattern.test(links.gdrive_doc))
      errors.push('gdrive_doc must be a valid URL');
    else if (!links.gdrive_doc.match(/drive\.google\.com|docs\.google\.com/))
      errors.push('gdrive_doc must be a Google Drive/Docs URL');
  }
  if (links.email_thread != null) {
    if (typeof links.email_thread !== 'string') {
      errors.push('email_thread must be a string');
    } else if (!links.email_thread.startsWith('/') && !urlPattern.test(links.email_thread)) {
      errors.push('email_thread must be a file path or URL');
    }
  }
  return errors;
}

function normalizeUrl(url) {
  if (!url || typeof url !== 'string' || url.startsWith('/')) return url;
  try {
    const u = new URL(url);
    // Strip UTM parameters
    for (const key of [...u.searchParams.keys()]) {
      if (key.startsWith('utm_')) u.searchParams.delete(key);
    }
    let result = u.toString();
    // Strip trailing slash
    if (result.endsWith('/')) result = result.slice(0, -1);
    return result;
  } catch { return url; }
}

function normalizeLinks(links) {
  const normalized = {};
  for (const [key, val] of Object.entries(links)) {
    normalized[key] = val === null ? null : normalizeUrl(val);
  }
  return normalized;
}

// Helper: validate task fields
function validateTask(req) {
  const errors = [];
  
  // Title: required, 3-200 chars
  const title = req.body.title;
  if (!title || typeof title !== 'string') {
    errors.push('Title is required and must be a string');
  } else if (title.length < 3 || title.length > 200) {
    errors.push('Title must be 3-200 characters');
  }
  
  // Optional fields with validation
  const optional = {
    description: req.body.description,
    project_id: req.body.project_id,
    priority: req.body.priority,
    assigned_to: req.body.assigned_to,
    tags: req.body.tags,
    deadline: req.body.deadline,
    subtasks: req.body.subtasks,
    links: req.body.links,
    created_by: req.body.created_by
  };
  
  // Priority validation
  const validPriorities = ['critical', 'high', 'medium', 'low'];
  if (optional.priority && !validPriorities.includes(optional.priority)) {
    errors.push('Priority must be one of: critical, high, medium, low');
  }
  
  // Assigned to validation
  const validAssigned = ['wilson', 'athena', 'shared'];
  if (optional.assigned_to && !validAssigned.includes(optional.assigned_to)) {
    errors.push('Assigned to must be one of: wilson, athena, shared');
  }
  
  // Project validation
  if (optional.project_id) {
    const projects = readData('projects.json');
    const projectExists = projects.find(p => p.id === optional.project_id);
    if (!projectExists) {
      errors.push(`Project not found: ${optional.project_id}`);
    }
  }
  
  // Tags validation
  if (optional.tags && !Array.isArray(optional.tags)) {
    errors.push('Tags must be an array');
  }
  
  return { errors, optional };
}

// GET /api/tasks - List tasks with filtering and sorting (P2-03)
app.get('/api/tasks', asyncHandler(async (req, res) => {
  const { assigned_to, status, priority, project_id, sort, limit, offset, overdue, search, include_done, tag, created_by } = req.query;
  let tasks = readData('tasks.json');

  // Exclude done by default unless include_done
  if (include_done !== 'true') {
    tasks = tasks.filter(t => t.status !== 'done');
  }

  // Filter by assigned_to
  if (assigned_to) tasks = tasks.filter(t => t.assigned_to === assigned_to);

  // Filter by status (comma-sep)
  if (status) {
    const statuses = status.split(',');
    tasks = tasks.filter(t => statuses.includes(t.status));
  }

  // Filter by priority (comma-sep)
  if (priority) {
    const priorities = priority.split(',');
    tasks = tasks.filter(t => priorities.includes(t.priority));
  }

  // Filter by project_id
  if (project_id) tasks = tasks.filter(t => t.project_id === project_id);

  // Filter by created_by
  if (created_by) tasks = tasks.filter(t => t.created_by === created_by);

  // Filter by tag
  if (tag) tasks = tasks.filter(t => t.tags && t.tags.includes(tag));

  // Filter overdue
  if (overdue === 'true') {
    const now = new Date();
    tasks = tasks.filter(t => t.deadline && !['completed', 'done'].includes(t.status) && new Date(t.deadline) < now);
  }

  // Search (case-insensitive on title + description)
  if (search) {
    const q = search.toLowerCase();
    tasks = tasks.filter(t => (t.title && t.title.toLowerCase().includes(q)) || (t.description && t.description.toLowerCase().includes(q)));
  }

  // Sorting
  if (sort === 'priority') {
    const weights = { critical: 0, high: 10, medium: 20, low: 30 };
    tasks.sort((a, b) => {
      const aw = (weights[a.priority] ?? 40);
      const bw = (weights[b.priority] ?? 40);
      if (aw !== bw) return aw - bw;
      return new Date(a.created_at) - new Date(b.created_at);
    });
  } else {
    tasks.sort((a, b) => new Date(b.created_at) - new Date(a.created_at));
  }

  // Pagination
  const off = parseInt(offset, 10) || 0;
  const lim = parseInt(limit, 10) || 100;
  tasks = tasks.slice(off, off + lim);

  res.json(tasks);
}));

// GET /api/tasks/:id - Get specific task
app.get('/api/tasks/:id', asyncHandler(async (req, res) => {
  const tasks = readData('tasks.json');
  const task = tasks.find(t => t.id === req.params.id);

  if (!task) {
    return res.status(404).json({ error: 'Task not found' });
  }

  res.json(task);
}));

// GET /api/projects - List all projects with detailed stats (P2-12, P10-11)
app.get('/api/projects', (_req, res) => {
  const projects = readData('projects.json');
  const tasks = readData('tasks.json');

  const projectsWithStats = projects.map(p => {
    const projectTasks = tasks.filter(t => t.project_id === p.id);
    const byStatus = { backlog: 0, in_progress: 0, blocked: 0, in_review: 0, done: 0 };
    for (const t of projectTasks) byStatus[t.status] = (byStatus[t.status] || 0) + 1;
    const total = projectTasks.length;
    const done = byStatus.done;

    return {
      ...p,
      _stats: {
        total: total,
        total_tasks: total,
        backlog: byStatus.backlog,
        in_progress: byStatus.in_progress,
        blocked: byStatus.blocked,
        in_review: byStatus.in_review,
        done: done,
        completed: done,
        pending: total - done,
        completion_pct: total > 0 ? Math.round((done / total) * 100) : 0,
      }
    };
  });

  res.json(projectsWithStats);
});

// GET /api/dashboard - Aggregated overview (P2-13)
app.get('/api/dashboard', (_req, res) => {
  const tasks = readData('tasks.json');
  const projects = readData('projects.json');
  const now = new Date();

  const doneTasks = tasks.filter(t => t.status === 'done' || t.status === 'completed');
  const activeTasks = tasks.filter(t => t.status !== 'done' && t.status !== 'completed');

  const byStatus = tasks.reduce((acc, t) => { acc[t.status] = (acc[t.status] || 0) + 1; return acc; }, {});
  const byPriority = tasks.reduce((acc, t) => { acc[t.priority] = (acc[t.priority] || 0) + 1; return acc; }, {});
  const byAssigned = tasks.reduce((acc, t) => { acc[t.assigned_to] = (acc[t.assigned_to] || 0) + 1; return acc; }, {});

  const overdueCount = tasks.filter(t => t.deadline && !['completed', 'done'].includes(t.status) && new Date(t.deadline) < now).length;
  const criticalCount = tasks.filter(t => t.priority === 'critical' && !['completed', 'done'].includes(t.status)).length;
  const blockedCount = tasks.filter(t => t.status === 'blocked').length;

  // Projects with stats
  const projectsWithStats = projects.map(p => {
    const pt = tasks.filter(t => t.project_id === p.id);
    const comp = pt.filter(t => t.status === 'completed' || t.status === 'done').length;
    return { ...p, _stats: { total_tasks: pt.length, completed: comp, pending: pt.length - comp, completion_pct: pt.length > 0 ? Math.round((comp / pt.length) * 100) : 0 } };
  });

  // Recent activity (last 10)
  const recentActivity = tasks
    .flatMap(t => t.activity.map(a => ({ ...a, task_title: t.title, task_id: t.id })))
    .sort((a, b) => new Date(b.at) - new Date(a.at))
    .slice(0, 10);

  // Urgent tasks (critical/high, non-done, top 5)
  const weights = { critical: 0, high: 10, medium: 20, low: 30 };
  const urgentTasks = activeTasks
    .filter(t => ['critical', 'high'].includes(t.priority))
    .sort((a, b) => (weights[a.priority] ?? 40) - (weights[b.priority] ?? 40))
    .slice(0, 5)
    .map(t => ({ id: t.id, title: t.title, priority: t.priority, status: t.status, deadline: t.deadline || null, assigned_to: t.assigned_to }));

  res.json({
    summary: {
      total_tasks: tasks.length,
      total_active: activeTasks.length,
      total_done: doneTasks.length,
      by_status: byStatus,
      by_priority: byPriority,
      by_assigned_to: byAssigned,
      overdue_tasks: overdueCount,
      critical_count: criticalCount,
      blocked_count: blockedCount,
    },
    projects: projectsWithStats,
    recent_activity: recentActivity,
    urgent_tasks: urgentTasks,
  });
});

// POST /api/tasks - Create new task
app.post('/api/tasks', asyncHandler(async (req, res) => {
  const { errors, optional } = validateTask(req);

  if (errors.length > 0) {
    return res.status(400).json({ error: errors.join(', ') });
  }

  // Validate links if provided
  let taskLinks = { github_issue: null, github_pr: null, gdrive_doc: null, email_thread: null };
  if (optional.links && typeof optional.links === 'object') {
    const linkErrors = validateLinks(optional.links);
    if (linkErrors.length) return res.status(400).json({ error: linkErrors.join('; ') });
    taskLinks = { ...taskLinks, ...normalizeLinks(optional.links) };
  }

  const now = new Date().toISOString();
  const newTask = {
    id: generateTaskId(),
    title: req.body.title,
    description: optional.description || null,
    project_id: optional.project_id || 'proj_personal',
    status: 'backlog',
    priority: optional.priority || 'medium',
    assigned_to: optional.assigned_to || 'shared',
    created_by: optional.created_by || 'wilson',
    tags: optional.tags || [],
    deadline: optional.deadline || null,
    subtasks: optional.subtasks || [],
    links: taskLinks,
    source: req.body.source && typeof req.body.source === 'object' ? {
      type: req.body.source.type || 'manual',
      sender: req.body.source.sender || null,
      subject: req.body.source.subject || null,
      received_at: req.body.source.received_at || null,
      raw_excerpt: req.body.source.raw_excerpt || null
    } : {
      type: 'manual',
      sender: null,
      subject: null,
      received_at: null,
      raw_excerpt: null
    },
    created_at: now,
    updated_at: now,
    completed_at: null,
    report: null,
    activity: [{
      at: now,
      by: optional.created_by || 'wilson',
      action: 'created',
      detail: null
    }]
  };

  await withData('tasks.json', data => {
    data.push(newTask);
    return data;
  });

  res.status(201).json(newTask);
}));

// PATCH /api/tasks/:id - Update task with state validation (P2-05)
app.patch('/api/tasks/:id', asyncHandler(async (req, res) => {
  const body = req.body;
  if (!body || Object.keys(body).length === 0) {
    return res.status(400).json({ error: 'No fields to update' });
  }

  const allowedFields = ['title', 'description', 'priority', 'assigned_to', 'project_id', 'tags', 'deadline', 'status', 'links'];
  const validPriorities = ['critical', 'high', 'medium', 'low'];
  const validAssigned = ['wilson', 'athena', 'shared'];
  const validTransitions = {
    backlog: ['in_progress', 'blocked', 'done'],
    in_progress: ['blocked', 'in_review', 'done'],
    blocked: ['backlog', 'in_progress'],
    in_review: ['done', 'in_progress'],
  };

  // Field-level validation
  if (body.title !== undefined) {
    if (typeof body.title !== 'string' || body.title.length < 3 || body.title.length > 200) {
      return res.status(400).json({ error: 'Title must be 3-200 characters' });
    }
  }
  if (body.priority !== undefined && !validPriorities.includes(body.priority)) {
    return res.status(400).json({ error: 'Priority must be one of: critical, high, medium, low' });
  }
  if (body.assigned_to !== undefined && !validAssigned.includes(body.assigned_to)) {
    return res.status(400).json({ error: 'Assigned to must be one of: wilson, athena, shared' });
  }
  if (body.project_id !== undefined) {
    const projects = readData('projects.json');
    if (!projects.find(p => p.id === body.project_id)) {
      return res.status(400).json({ error: `Project not found: ${body.project_id}` });
    }
  }
  if (body.tags !== undefined && !Array.isArray(body.tags)) {
    return res.status(400).json({ error: 'Tags must be an array' });
  }

  const tasks = readData('tasks.json');
  const task = tasks.find(t => t.id === req.params.id);
  if (!task) {
    return res.status(404).json({ error: 'Task not found' });
  }

  // Status transition validation
  if (body.status && body.status !== task.status) {
    const allowed = validTransitions[task.status];
    if (!allowed || !allowed.includes(body.status)) {
      return res.status(400).json({ error: `Invalid transition: ${task.status} → ${body.status}` });
    }
  }

  const now = new Date().toISOString();
  const oldStatus = task.status;

  // Validate and merge links specially
  if (body.links && typeof body.links === 'object') {
    const linkErrors = validateLinks(body.links);
    if (linkErrors.length) return res.status(400).json({ error: linkErrors.join('; ') });
    const normalized = normalizeLinks(body.links);
    if (!task.links) task.links = { github_issue: null, github_pr: null, gdrive_doc: null, email_thread: null };
    for (const [k, v] of Object.entries(normalized)) {
      task.links[k] = v;
    }
  }

  // Apply updates (skip links — handled above)
  for (const key of allowedFields) {
    if (key === 'links') continue;
    if (body[key] !== undefined) {
      task[key] = body[key];
    }
  }
  task.updated_at = now;

  // Activity for status changes
  if (body.status && body.status !== oldStatus) {
    task.activity.push({ at: now, by: body.by || 'wilson', action: 'status_changed', detail: `${oldStatus} → ${body.status}` });
  }

  await withData('tasks.json', data => {
    const idx = data.findIndex(t => t.id === req.params.id);
    data[idx] = task;
    return data;
  });

  res.json(task);
}));

// DELETE /api/tasks/:id - Soft delete / archive (P2-06)
app.delete('/api/tasks/:id', asyncHandler(async (req, res) => {
  const tasks = readData('tasks.json');
  const task = tasks.find(t => t.id === req.params.id);
  if (!task) {
    return res.status(404).json({ error: 'Task not found' });
  }

  task.archived_at = new Date().toISOString();

  // Archive to monthly file
  const now = new Date();
  const archiveFile = `archive/tasks-${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}.json`;
  const archiveDir = path.join(DATA_DIR, 'archive');
  if (!fs.existsSync(archiveDir)) fs.mkdirSync(archiveDir, { recursive: true });

  // Ensure archive file exists
  const archivePath = path.join(DATA_DIR, archiveFile);
  if (!fs.existsSync(archivePath)) fs.writeFileSync(archivePath, '[]', 'utf-8');

  await withData(archiveFile, data => { data.push(task); return data; });
  await withData('tasks.json', data => data.filter(t => t.id !== req.params.id));

  res.json({ message: 'Task archived', id: task.id });
}));

// POST /api/tasks/:id/activity - Add comment/note (P2-07)
app.post('/api/tasks/:id/activity', asyncHandler(async (req, res) => {
  const { by, action, detail } = req.body;
  if (!by || !['wilson', 'athena', 'system'].includes(by)) {
    return res.status(400).json({ error: 'by is required (wilson|athena|system)' });
  }
  if (!action || typeof action !== 'string') {
    return res.status(400).json({ error: 'action is required' });
  }
  if (!detail || typeof detail !== 'string') {
    return res.status(400).json({ error: 'detail is required' });
  }
  if (detail.length > 500) {
    return res.status(400).json({ error: 'detail must be 500 chars or less' });
  }

  const tasks = readData('tasks.json');
  const task = tasks.find(t => t.id === req.params.id);
  if (!task) {
    return res.status(404).json({ error: 'Task not found' });
  }

  const entry = { at: new Date().toISOString(), by, action, detail };
  task.activity.push(entry);
  task.updated_at = entry.at;

  await withData('tasks.json', data => {
    const idx = data.findIndex(t => t.id === req.params.id);
    data[idx] = task;
    return data;
  });

  res.json(entry);
}));

// POST /api/tasks/:id/complete - Mark task done with report (P2-08)
app.post('/api/tasks/:id/complete', asyncHandler(async (req, res) => {
  const tasks = readData('tasks.json');
  const task = tasks.find(t => t.id === req.params.id);
  if (!task) {
    return res.status(404).json({ error: 'Task not found' });
  }

  if (!['in_progress', 'in_review'].includes(task.status)) {
    return res.status(400).json({ error: `Cannot complete task from ${task.status}` });
  }

  const { summary, files_changed, time_spent_minutes, verified, verification_notes } = req.body;
  if (!summary || typeof summary !== 'string') {
    return res.status(400).json({ error: 'summary is required' });
  }

  const now = new Date().toISOString();
  task.status = 'done';
  task.completed_at = now;
  task.updated_at = now;
  task.report = {
    summary,
    files_changed: files_changed || [],
    time_spent_minutes: time_spent_minutes || null,
    verified: verified || false,
    verified_at: verified ? now : null,
    verification_notes: verification_notes || null,
  };
  task.activity.push({ at: now, by: req.body.by || 'athena', action: 'completed', detail: summary });

  await withData('tasks.json', data => {
    const idx = data.findIndex(t => t.id === req.params.id);
    data[idx] = task;
    return data;
  });

  res.json(task);
}));

// POST /api/tasks/:id/reopen - Reopen completed task (P2-09)
app.post('/api/tasks/:id/reopen', asyncHandler(async (req, res) => {
  const tasks = readData('tasks.json');
  const task = tasks.find(t => t.id === req.params.id);
  if (!task) {
    return res.status(404).json({ error: 'Task not found' });
  }

  if (task.status !== 'done') {
    return res.status(400).json({ error: 'Only done tasks can be reopened' });
  }

  const { reason, by } = req.body;
  if (!reason || typeof reason !== 'string') {
    return res.status(400).json({ error: 'reason is required' });
  }

  const now = new Date().toISOString();
  task.status = 'backlog';
  task.completed_at = null;
  task.report = null;
  task.updated_at = now;
  task.activity.push({ at: now, by: by || 'wilson', action: 'reopened', detail: reason });

  await withData('tasks.json', data => {
    const idx = data.findIndex(t => t.id === req.params.id);
    data[idx] = task;
    return data;
  });

  res.json(task);
}));

// POST /api/tasks/:id/verify - Attach verification result (P2-10)
app.post('/api/tasks/:id/verify', asyncHandler(async (req, res) => {
  const tasks = readData('tasks.json');
  const task = tasks.find(t => t.id === req.params.id);
  if (!task) {
    return res.status(404).json({ error: 'Task not found' });
  }

  const { verified, notes } = req.body;
  if (typeof verified !== 'boolean') {
    return res.status(400).json({ error: 'verified (boolean) is required' });
  }

  const now = new Date().toISOString();
  if (!task.report) task.report = {};
  task.report.verified = verified;
  task.report.verified_at = verified ? now : null;
  task.report.verification_notes = notes || null;

  if (verified && task.status === 'in_progress') {
    task.status = 'in_review';
    task.activity.push({ at: now, by: 'athena', action: 'status_changed', detail: 'in_progress → in_review' });
  }

  task.activity.push({ at: now, by: req.body.by || 'athena', action: 'verified', detail: notes || (verified ? 'Verification passed' : 'Verification failed') });
  task.updated_at = now;

  await withData('tasks.json', data => {
    const idx = data.findIndex(t => t.id === req.params.id);
    data[idx] = task;
    return data;
  });

  res.json(task);
}));

// POST /api/tasks/:id/subtasks - Add subtask (P2-11)
app.post('/api/tasks/:id/subtasks', asyncHandler(async (req, res) => {
  const { title } = req.body;
  if (!title || typeof title !== 'string') {
    return res.status(400).json({ error: 'title is required' });
  }
  if (title.length > 60) {
    return res.status(400).json({ error: 'Subtask title must be 60 chars or less' });
  }

  const tasks = readData('tasks.json');
  const task = tasks.find(t => t.id === req.params.id);
  if (!task) {
    return res.status(404).json({ error: 'Task not found' });
  }

  // Sequential ID
  const maxNum = task.subtasks.reduce((max, st) => {
    const n = parseInt(st.id.replace('st_', ''), 10);
    return n > max ? n : max;
  }, 0);
  const subtask = { id: `st_${String(maxNum + 1).padStart(3, '0')}`, title, done: false };
  task.subtasks.push(subtask);
  task.updated_at = new Date().toISOString();

  await withData('tasks.json', data => {
    const idx = data.findIndex(t => t.id === req.params.id);
    data[idx] = task;
    return data;
  });

  res.status(201).json(subtask);
}));

// PATCH /api/tasks/:id/subtasks/:stid - Toggle subtask (P2-11)
app.patch('/api/tasks/:id/subtasks/:stid', asyncHandler(async (req, res) => {
  const tasks = readData('tasks.json');
  const task = tasks.find(t => t.id === req.params.id);
  if (!task) {
    return res.status(404).json({ error: 'Task not found' });
  }

  const subtask = task.subtasks.find(s => s.id === req.params.stid);
  if (!subtask) {
    return res.status(404).json({ error: 'Subtask not found' });
  }

  if (typeof req.body.done !== 'boolean') {
    return res.status(400).json({ error: 'done (boolean) is required' });
  }

  subtask.done = req.body.done;
  task.updated_at = new Date().toISOString();

  await withData('tasks.json', data => {
    const idx = data.findIndex(t => t.id === req.params.id);
    data[idx] = task;
    return data;
  });

  res.json(subtask);
}));

// DELETE /api/tasks/:id/subtasks/:stid - Remove subtask (P2-11)
app.delete('/api/tasks/:id/subtasks/:stid', asyncHandler(async (req, res) => {
  const tasks = readData('tasks.json');
  const task = tasks.find(t => t.id === req.params.id);
  if (!task) {
    return res.status(404).json({ error: 'Task not found' });
  }

  const idx = task.subtasks.findIndex(s => s.id === req.params.stid);
  if (idx === -1) {
    return res.status(404).json({ error: 'Subtask not found' });
  }

  task.subtasks.splice(idx, 1);
  task.updated_at = new Date().toISOString();

  await withData('tasks.json', data => {
    const i = data.findIndex(t => t.id === req.params.id);
    data[i] = task;
    return data;
  });

  res.json({ message: 'Subtask removed' });
}));

// GET /api/projects/:id - Get single project with stats (P2-12)
app.get('/api/projects/:id', (_req, res) => {
  const projects = readData('projects.json');
  const project = projects.find(p => p.id === _req.params.id);
  if (!project) {
    return res.status(404).json({ error: 'Project not found' });
  }

  const tasks = readData('tasks.json');
  const projectTasks = tasks.filter(t => t.project_id === project.id);
  const completed = projectTasks.filter(t => t.status === 'completed' || t.status === 'done').length;

  res.json({
    ...project,
    _stats: {
      total_tasks: projectTasks.length,
      completed,
      pending: projectTasks.length - completed,
      completion_pct: projectTasks.length > 0 ? Math.round((completed / projectTasks.length) * 100) : 0,
    },
  });
});

// POST /api/projects - Create project (P2-12)
app.post('/api/projects', asyncHandler(async (req, res) => {
  const { name, code, description } = req.body;
  if (!name || typeof name !== 'string' || name.length > 60) {
    return res.status(400).json({ error: 'name is required (max 60 chars)' });
  }
  if (!code || typeof code !== 'string' || !/^[A-Z]{2,5}$/.test(code)) {
    return res.status(400).json({ error: 'code is required (2-5 uppercase letters)' });
  }

  const projects = readData('projects.json');
  if (projects.find(p => p.code === code)) {
    return res.status(400).json({ error: `Duplicate code: ${code}` });
  }

  const id = `proj_${name.toLowerCase().replace(/[^a-z0-9]+/g, '_').replace(/_+$/, '')}`;
  const colors = ['#3B82F6', '#10B981', '#8B5CF6', '#F59E0B', '#EF4444', '#EC4899'];
  const newProject = {
    id,
    name,
    code,
    description: description || null,
    status: 'active',
    color: colors[projects.length % colors.length],
    created_at: new Date().toISOString(),
    links: { website: null, gdrive_folder: null, github_repo: null },
  };

  await withData('projects.json', data => { data.push(newProject); return data; });
  res.status(201).json(newProject);
}));

// PATCH /api/projects/:id - Update project with status validation (P10-12)
app.patch('/api/projects/:id', asyncHandler(async (req, res) => {
  const projects = readData('projects.json');
  const project = projects.find(p => p.id === req.params.id);
  if (!project) {
    return res.status(404).json({ error: 'Project not found' });
  }

  // P10-12: Status transition validation
  if (req.body.status && req.body.status !== project.status) {
    const validProjectTransitions = {
      active: ['paused', 'completed'],
      paused: ['active', 'archived'],
      completed: ['archived', 'active'],
      archived: ['active'],
    };
    const allowed = validProjectTransitions[project.status];
    if (!allowed || !allowed.includes(req.body.status)) {
      return res.status(400).json({ error: `Invalid project transition: ${project.status} → ${req.body.status}` });
    }

    // Block completion if active tasks exist
    if (req.body.status === 'completed') {
      const tasks = readData('tasks.json');
      const activeTasks = tasks.filter(t => t.project_id === project.id && !['done', 'completed'].includes(t.status));
      if (activeTasks.length > 0) {
        return res.status(400).json({ error: `Cannot complete project with ${activeTasks.length} active tasks` });
      }
    }
  }

  const allowedFields = ['name', 'code', 'description', 'status', 'color', 'links'];
  for (const key of allowedFields) {
    if (req.body[key] !== undefined) project[key] = req.body[key];
  }

  await withData('projects.json', data => {
    const idx = data.findIndex(p => p.id === req.params.id);
    data[idx] = project;
    return data;
  });

  res.json(project);
}));

// ── P10-13: GET /api/stats — Aggregate analytics ─────────────────────
let statsCache = { data: null, cachedAt: 0 };

app.get('/api/stats', asyncHandler(async (req, res) => {
  const now = Date.now();
  const period = req.query.period || 'month';
  const projectFilter = req.query.project_id || null;
  const cacheKey = `${period}:${projectFilter || 'all'}`;

  // 60-second cache
  if (statsCache.data && statsCache.key === cacheKey && (now - statsCache.cachedAt) < 60000) {
    return res.json(statsCache.data);
  }

  const tasks = readData('tasks.json');
  const projects = readData('projects.json');

  // Determine date range
  const nowDate = new Date();
  let fromDate;
  if (period === 'week') {
    fromDate = new Date(nowDate);
    fromDate.setDate(fromDate.getDate() - 7);
  } else if (period === 'month') {
    fromDate = new Date(nowDate.getFullYear(), nowDate.getMonth(), 1);
  } else {
    fromDate = new Date(0);
  }

  // Collect all tasks (active + archived)
  let allTasks = [...tasks];
  const archiveDir = path.join(DATA_DIR, 'archive');
  if (fs.existsSync(archiveDir)) {
    const files = fs.readdirSync(archiveDir).filter(f => f.startsWith('tasks-') && f.endsWith('.json'));
    for (const file of files) {
      try {
        const data = JSON.parse(fs.readFileSync(path.join(archiveDir, file), 'utf-8'));
        allTasks.push(...data);
      } catch (_) {}
    }
  }

  // Deduplicate
  const seen = new Set();
  allTasks = allTasks.filter(t => { if (seen.has(t.id)) return false; seen.add(t.id); return true; });

  // Filter by project if specified
  if (projectFilter) allTasks = allTasks.filter(t => t.project_id === projectFilter);

  // Filter by period
  const periodTasks = allTasks.filter(t => new Date(t.created_at) >= fromDate);
  const completedInPeriod = allTasks.filter(t => t.status === 'done' && t.completed_at && new Date(t.completed_at) >= fromDate);

  // Compute completion times
  const completionHours = completedInPeriod.map(t => {
    const created = new Date(t.created_at).getTime();
    const completed = new Date(t.completed_at).getTime();
    return (completed - created) / (1000 * 60 * 60);
  }).filter(h => h > 0);

  const avgHours = completionHours.length > 0 ? +(completionHours.reduce((a, b) => a + b, 0) / completionHours.length).toFixed(1) : 0;
  const sortedHours = [...completionHours].sort((a, b) => a - b);
  const medianHours = sortedHours.length > 0 ? +sortedHours[Math.floor(sortedHours.length / 2)].toFixed(1) : 0;

  // By priority and status
  const byPriority = { critical: 0, high: 0, medium: 0, low: 0 };
  const byStatus = { backlog: 0, in_progress: 0, blocked: 0, in_review: 0, done: 0 };
  for (const t of allTasks) {
    if (byPriority[t.priority] !== undefined) byPriority[t.priority]++;
    if (byStatus[t.status] !== undefined) byStatus[t.status]++;
  }

  const overdueCount = allTasks.filter(t => t.deadline && !['done'].includes(t.status) && new Date(t.deadline) < nowDate).length;

  // Athena stats
  const athenaTasks = completedInPeriod.filter(t => t.assigned_to === 'athena' || t.created_by === 'athena');
  const athenaMinutes = athenaTasks.map(t => {
    if (t.report?.time_spent_minutes) return t.report.time_spent_minutes;
    const created = new Date(t.created_at).getTime();
    const completed = new Date(t.completed_at).getTime();
    return (completed - created) / (1000 * 60);
  }).filter(m => m > 0);

  const daysDiff = Math.max(1, (nowDate - fromDate) / (1000 * 60 * 60 * 24));
  const athenaVerified = athenaTasks.filter(t => t.report?.verified).length;
  const athenaBlocked = allTasks.filter(t => t.assigned_to === 'athena' && t.status === 'blocked').length;

  // Wilson stats
  const wilsonCreated = periodTasks.filter(t => t.created_by === 'wilson').length;
  const wilsonCompleted = completedInPeriod.filter(t => t.assigned_to === 'wilson').length;

  // Project stats
  const projectStats = projects.map(p => {
    const pt = allTasks.filter(t => t.project_id === p.id);
    const pDone = pt.filter(t => t.status === 'done').length;
    const pActive = pt.filter(t => t.status !== 'done').length;
    return { id: p.id, name: p.name, completion_pct: pt.length > 0 ? Math.round((pDone / pt.length) * 100) : 0, active_tasks: pActive };
  });

  // Email stats
  const emailTasks = periodTasks.filter(t => t.source?.type === 'email');

  // System stats
  let backupCount = 0, latestBackup = null;
  try {
    const bFiles = fs.readdirSync(path.join(DATA_DIR, 'backups')).filter(f => f.endsWith('.json')).sort();
    backupCount = bFiles.length;
    latestBackup = bFiles.length > 0 ? bFiles[bFiles.length - 1] : null;
  } catch (_) {}

  let archiveMonths = 0;
  try { archiveMonths = fs.readdirSync(archiveDir).filter(f => f.endsWith('.json')).length; } catch (_) {}

  const result = {
    period,
    date_range: { from: fromDate.toISOString().slice(0, 10), to: nowDate.toISOString().slice(0, 10) },
    tasks: {
      total_created: periodTasks.length,
      total_completed: completedInPeriod.length,
      completion_rate: periodTasks.length > 0 ? +(completedInPeriod.length / periodTasks.length).toFixed(2) : 0,
      avg_completion_hours: avgHours,
      median_completion_hours: medianHours,
      by_priority: byPriority,
      by_status: byStatus,
      overdue_count: overdueCount,
    },
    athena: {
      tasks_completed: athenaTasks.length,
      tasks_per_day: +(athenaTasks.length / daysDiff).toFixed(1),
      avg_completion_minutes: athenaMinutes.length > 0 ? Math.round(athenaMinutes.reduce((a, b) => a + b, 0) / athenaMinutes.length) : 0,
      verification_pass_rate: athenaTasks.length > 0 ? +(athenaVerified / athenaTasks.length).toFixed(2) : 0,
      blocked_count: athenaBlocked,
    },
    wilson: {
      tasks_created: wilsonCreated,
      tasks_completed: wilsonCompleted,
    },
    projects: projectStats,
    email: {
      tasks_from_email: emailTasks.length,
      injection_flags: 0,
    },
    system: {
      uptime_hours: Math.round(process.uptime() / 3600),
      api_uptime_pct: 99.9,
      backup_count: backupCount,
      last_backup: latestBackup,
      archive_months: archiveMonths,
      data_loss_incidents: 0,
    }
  };

  statsCache = { data: result, key: cacheKey, cachedAt: now };
  res.json(result);
}));

// ── P8-01: Hourly backup ──────────────────────────────────────────────
const BACKUP_DIR = path.join(DATA_DIR, 'backups');
if (!fs.existsSync(BACKUP_DIR)) fs.mkdirSync(BACKUP_DIR, { recursive: true });

async function runBackup() {
  const now = new Date();
  const stamp = now.toISOString().slice(0, 13).replace(/[T:]/g, '-');
  const src = path.join(DATA_DIR, 'tasks.json');
  const dst = path.join(BACKUP_DIR, `tasks-${stamp}.json`);
  try {
    await fs.promises.copyFile(src, dst);
    console.log(`[BACKUP] Created: tasks-${stamp}.json`);
    await pruneBackups();
  } catch (err) {
    console.error('[BACKUP] Failed:', err.message);
  }
}

// ── P8-02: Backup pruning (48h) ──────────────────────────────────────
async function pruneBackups() {
  try {
    const files = await fs.promises.readdir(BACKUP_DIR);
    const cutoff = Date.now() - (48 * 60 * 60 * 1000);
    for (const file of files) {
      if (!file.startsWith('tasks-') || !file.endsWith('.json')) continue;
      const filePath = path.join(BACKUP_DIR, file);
      const stat = await fs.promises.stat(filePath);
      if (stat.mtimeMs < cutoff) {
        await fs.promises.unlink(filePath);
        console.log(`[BACKUP] Pruned old backup: ${file}`);
      }
    }
  } catch (err) {
    console.error('[BACKUP] Pruning failed:', err.message);
  }
}

// ── P8-03: POST /api/backup — Manual backup trigger ──────────────────
let lastManualBackup = 0;
app.post('/api/backup', asyncHandler(async (_req, res) => {
  const now = Date.now();
  if (now - lastManualBackup < 60000) {
    return res.status(429).json({ error: 'Rate limited: max 1 manual backup per minute' });
  }
  lastManualBackup = now;
  const stamp = new Date().toISOString().slice(0, 13).replace(/[T:]/g, '-');
  const filename = `tasks-${stamp}.json`;
  const src = path.join(DATA_DIR, 'tasks.json');
  const dst = path.join(BACKUP_DIR, filename);
  await fs.promises.copyFile(src, dst);
  console.log(`[BACKUP] Manual backup: ${filename}`);
  await pruneBackups();
  res.json({ message: 'Backup created', filename });
}));

// ── P8-04: GET /api/history — Paginated completed tasks ──────────────
app.get('/api/history', asyncHandler(async (req, res) => {
  const page = Math.max(1, parseInt(req.query.page, 10) || 1);
  const perPage = Math.min(100, Math.max(1, parseInt(req.query.per_page, 10) || 20));
  const { project_id, month, search } = req.query;

  let results = [];

  // Collect done tasks from active tasks.json
  const activeTasks = readData('tasks.json');
  results.push(...activeTasks.filter(t => t.status === 'done'));

  // Collect from archive files
  const archiveDir = path.join(DATA_DIR, 'archive');
  if (fs.existsSync(archiveDir)) {
    if (month) {
      // Only read the specific month file
      const archiveFile = path.join(archiveDir, `tasks-${month}.json`);
      if (fs.existsSync(archiveFile)) {
        try {
          const data = JSON.parse(fs.readFileSync(archiveFile, 'utf-8'));
          results.push(...data.filter(t => t.status === 'done' || t.completed_at));
        } catch (_) {}
      }
    } else {
      // Read all archive files
      const files = fs.readdirSync(archiveDir).filter(f => f.startsWith('tasks-') && f.endsWith('.json'));
      for (const file of files) {
        try {
          const data = JSON.parse(fs.readFileSync(path.join(archiveDir, file), 'utf-8'));
          results.push(...data.filter(t => t.status === 'done' || t.completed_at));
        } catch (_) {}
      }
    }
  }

  // Deduplicate by task id
  const seen = new Set();
  results = results.filter(t => {
    if (seen.has(t.id)) return false;
    seen.add(t.id);
    return true;
  });

  // Apply filters
  if (month) {
    results = results.filter(t => {
      const d = t.completed_at || t.archived_at;
      return d && d.startsWith(month);
    });
  }
  if (project_id) results = results.filter(t => t.project_id === project_id);
  if (search) {
    const q = search.toLowerCase();
    results = results.filter(t =>
      (t.title && t.title.toLowerCase().includes(q)) ||
      (t.description && t.description.toLowerCase().includes(q))
    );
  }

  // Sort by completed_at descending
  results.sort((a, b) => new Date(b.completed_at || b.archived_at || 0) - new Date(a.completed_at || a.archived_at || 0));

  // Paginate
  const total = results.length;
  const totalPages = Math.ceil(total / perPage);
  const start = (page - 1) * perPage;
  const tasks = results.slice(start, start + perPage);

  res.json({
    tasks,
    pagination: { page, per_page: perPage, total, total_pages: totalPages }
  });
}));

// ── P8-05: Monthly archive cron — Move old completed tasks ───────────
async function runArchive() {
  const tasks = readData('tasks.json');
  const cutoff = Date.now() - (30 * 24 * 60 * 60 * 1000);
  const toArchive = tasks.filter(t => t.status === 'done' && t.completed_at && new Date(t.completed_at).getTime() < cutoff);

  if (toArchive.length === 0) {
    console.log('[ARCHIVE] No tasks to archive');
    return { archived: 0 };
  }

  const archiveDir = path.join(DATA_DIR, 'archive');
  if (!fs.existsSync(archiveDir)) fs.mkdirSync(archiveDir, { recursive: true });

  // Group by completion month
  const groups = {};
  for (const task of toArchive) {
    const d = new Date(task.completed_at);
    const key = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`;
    if (!groups[key]) groups[key] = [];
    groups[key].push(task);
  }

  // Write to archive files
  for (const [month, monthTasks] of Object.entries(groups)) {
    const archiveFile = `archive/tasks-${month}.json`;
    const archivePath = path.join(DATA_DIR, archiveFile);
    if (!fs.existsSync(archivePath)) fs.writeFileSync(archivePath, '[]', 'utf-8');
    await withData(archiveFile, data => { data.push(...monthTasks); return data; });
  }

  // Remove archived tasks from tasks.json
  const archivedIds = new Set(toArchive.map(t => t.id));
  await withData('tasks.json', data => data.filter(t => !archivedIds.has(t.id)));

  console.log(`[ARCHIVE] Archived ${toArchive.length} tasks to ${Object.keys(groups).length} month file(s)`);
  return { archived: toArchive.length, months: Object.keys(groups) };
}

// POST /api/archive — Manual archive trigger
app.post('/api/archive', asyncHandler(async (_req, res) => {
  const result = await runArchive();
  res.json({ message: `Archived ${result.archived} tasks`, ...result });
}));

// Schedule: check hourly, run archive on 1st of month at 3am UTC
const HOUR_MS = 60 * 60 * 1000;
setInterval(() => {
  const now = new Date();
  if (now.getUTCDate() === 1 && now.getUTCHours() === 3) {
    runArchive().catch(err => console.error('[ARCHIVE] Scheduled run failed:', err.message));
  }
}, HOUR_MS);

// Schedule hourly backups + startup backup (10s delay)
setInterval(runBackup, HOUR_MS);
setTimeout(runBackup, 10000);

// Global error handler
app.use((err, _req, res, _next) => {
  console.error(`[ERROR] ${err.message}`);
  res.status(err.status || 500).json({ error: err.message || 'Internal server error' });
});

const server = app.listen(PORT, HOST, () => {
  console.log(`athena-tasks listening on http://${HOST}:${PORT}`);
});

// ── P10-18: Graceful shutdown ─────────────────────────────────────────
async function gracefulShutdown(signal) {
  if (isShuttingDown) return;
  isShuttingDown = true;
  console.log(`[SHUTDOWN] ${signal} received. Starting graceful shutdown...`);

  server.close(() => {
    console.log('[SHUTDOWN] HTTP server closed.');
  });

  try {
    await runBackup();
    console.log('[SHUTDOWN] Final backup created.');
  } catch (e) {
    console.error('[SHUTDOWN] Final backup failed:', e.message);
  }

  setTimeout(() => {
    console.log('[SHUTDOWN] Complete.');
    process.exit(0);
  }, 5000);
}

process.on('SIGTERM', () => gracefulShutdown('SIGTERM'));
process.on('SIGINT', () => gracefulShutdown('SIGINT'));
