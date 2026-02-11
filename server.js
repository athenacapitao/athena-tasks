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

app.use(express.json());

// Serve UI
app.get('/', (_req, res) => {
  res.sendFile(path.join(__dirname, 'ui.html'));
});

// Health check
app.get('/api/health', (_req, res) => {
  res.json({
    ok: true,
    uptime_seconds: Math.floor(process.uptime()),
    timestamp: new Date().toISOString()
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

// POST /api/tasks - Create new task
app.post('/api/tasks', asyncHandler(async (req, res) => {
  const { errors, optional } = validateTask(req);

  if (errors.length > 0) {
    return res.status(400).json({ error: errors.join(', ') });
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
    subtasks: optional.subtasks || [],
    links: optional.links || {
      github_issue: null,
      github_pr: null,
      gdrive_doc: null,
      email_thread: null
    },
    source: {
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

// Global error handler
app.use((err, _req, res, _next) => {
  console.error(`[ERROR] ${err.message}`);
  res.status(err.status || 500).json({ error: err.message || 'Internal server error' });
});

app.listen(PORT, HOST, () => {
  console.log(`athena-tasks listening on http://${HOST}:${PORT}`);
});
