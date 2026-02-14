const fs = require('fs');
const path = require('path');
const lockfile = require('proper-lockfile');

const DATA_DIR = path.join(__dirname, 'data');

function readData(filename) {
  const filePath = path.join(DATA_DIR, filename);
  try {
    const raw = fs.readFileSync(filePath, 'utf-8');
    if (!raw.trim()) return [];
    return JSON.parse(raw);
  } catch (err) {
    if (err.code === 'ENOENT') return [];
    throw new Error(`Failed to parse ${filename}: ${err.message}`);
  }
}

async function withData(filename, mutator) {
  const filePath = path.join(DATA_DIR, filename);

  // Ensure file exists so proper-lockfile can lock it
  if (!fs.existsSync(filePath)) {
    fs.writeFileSync(filePath, '[]', 'utf-8');
  }

  const release = await lockfile.lock(filePath, {
    retries: { retries: 5, minTimeout: 100, maxTimeout: 1000 }
  });

  try {
    const raw = fs.readFileSync(filePath, 'utf-8');
    const data = raw.trim() ? JSON.parse(raw) : [];
    const result = mutator(data);
    fs.writeFileSync(filePath, JSON.stringify(result, null, 2), 'utf-8');
    return result;
  } finally {
    await release();
  }
}

module.exports = { readData, withData };
