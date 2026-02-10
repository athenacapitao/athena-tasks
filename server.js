const fs = require('fs');
const path = require('path');
const express = require('express');

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

// Global error handler
app.use((err, _req, res, _next) => {
  console.error(`[ERROR] ${err.message}`);
  res.status(err.status || 500).json({ error: err.message || 'Internal server error' });
});

app.listen(PORT, HOST, () => {
  console.log(`athena-tasks listening on http://${HOST}:${PORT}`);
});
