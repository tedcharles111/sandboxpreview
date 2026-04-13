const express = require('express');
const crypto = require('crypto');
const fs = require('fs').promises;
const path = require('path');
const cors = require('cors');

const app = express();
const PORT = process.env.PORT || 3000;

app.use(cors());
app.use(express.json({ limit: '10mb' }));

const sandboxes = new Map();

function generateId() {
  return crypto.randomBytes(8).toString('hex');
}

setInterval(async () => {
  const now = Date.now();
  for (const [id, data] of sandboxes.entries()) {
    if (now - data.createdAt > 60 * 60 * 1000) {
      await fs.rm(data.dir, { recursive: true, force: true });
      sandboxes.delete(id);
    }
  }
}, 30 * 60 * 1000);

app.post('/api/preview', async (req, res) => {
  try {
    let { html, files } = req.body;
    if (typeof html === 'string') {
      files = { 'index.html': html };
    }
    if (!files || typeof files !== 'object') {
      return res.status(400).json({ error: 'Missing "html" or "files"' });
    }

    const id = generateId();
    const dir = path.join('/tmp', id);
    await fs.mkdir(dir, { recursive: true });

    for (const [filePath, content] of Object.entries(files)) {
      if (filePath === 'package.json') continue;
      const fullPath = path.join(dir, filePath);
      await fs.mkdir(path.dirname(fullPath), { recursive: true });
      await fs.writeFile(fullPath, content);
    }

    sandboxes.set(id, { dir, createdAt: Date.now() });
    const previewUrl = `${req.protocol}://${req.get('host')}/preview/${id}`;
    res.json({ previewUrl, id });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: err.message });
  }
});

// Serve static files for the sandbox (must come before the main preview route)
app.get('/preview/:id/*', async (req, res) => {
  const { id } = req.params;
  const entry = sandboxes.get(id);
  if (!entry) {
    return res.status(404).send('Preview not found');
  }
  // The requested file path is the rest of the URL after /preview/:id/
  const filePath = req.params[0];
  const fullPath = path.join(entry.dir, filePath);
  try {
    await fs.access(fullPath);
    // Set correct content type based on extension
    const ext = path.extname(fullPath).toLowerCase();
    const mime = {
      '.html': 'text/html',
      '.css': 'text/css',
      '.js': 'application/javascript',
      '.json': 'application/json',
      '.png': 'image/png',
      '.jpg': 'image/jpeg',
      '.svg': 'image/svg+xml',
    }[ext] || 'text/plain';
    res.setHeader('Content-Type', mime);
    res.sendFile(fullPath);
  } catch {
    res.status(404).send('File not found');
  }
});

// Main preview page (if no specific file, serve the index.html)
app.get('/preview/:id', async (req, res) => {
  const { id } = req.params;
  const entry = sandboxes.get(id);
  if (!entry) {
    return res.status(404).send('Preview not found');
  }
  const indexPath = path.join(entry.dir, 'index.html');
  try {
    await fs.access(indexPath);
    res.sendFile(indexPath);
  } catch {
    // Fallback: generate a simple listing
    let fileList = '';
    async function listFiles(dir) {
      const items = await fs.readdir(dir, { withFileTypes: true });
      for (const item of items) {
        if (item.isDirectory()) {
          await listFiles(path.join(dir, item.name));
        } else {
          fileList += `<li><a href="/preview/${id}/${item.name}">${item.name}</a></li>`;
        }
      }
    }
    await listFiles(entry.dir);
    res.send(`<!DOCTYPE html><html><head><title>Preview</title></head><body><h1>Files</h1><ul>${fileList}</ul></body></html>`);
  }
});

app.get('/health', (req, res) => {
  res.json({ status: 'ok', activePreviews: sandboxes.size });
});

app.listen(PORT, () => {
  console.log(`🚀 Sandbox with static file serving running on port ${PORT}`);
});
