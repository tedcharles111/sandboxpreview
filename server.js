const express = require('express');
const crypto = require('crypto');
const fs = require('fs').promises;
const path = require('path');
const cors = require('cors');
const mime = require('mime-types');

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

// Serve static files from the sandbox directory
app.get('/preview/:id/*', async (req, res) => {
  const { id } = req.params;
  const entry = sandboxes.get(id);
  if (!entry) {
    return res.status(404).send('Preview not found');
  }
  const filePath = path.join(entry.dir, req.params[0]);
  try {
    await fs.access(filePath);
    const contentType = mime.lookup(filePath) || 'application/octet-stream';
    res.setHeader('Content-Type', contentType);
    res.sendFile(filePath);
  } catch {
    res.status(404).send('File not found');
  }
});

// Serve the index.html for the preview (with proper base)
app.get('/preview/:id', async (req, res) => {
  const { id } = req.params;
  const entry = sandboxes.get(id);
  if (!entry) {
    return res.status(404).send('Preview not found');
  }
  // Try to serve index.html directly
  const indexPath = path.join(entry.dir, 'index.html');
  try {
    await fs.access(indexPath);
    res.sendFile(indexPath);
  } catch {
    // If no index.html, generate a simple one
    res.send('<h1>Preview</h1><p>No index.html found</p>');
  }
});

app.get('/health', (req, res) => {
  res.json({ status: 'ok', activePreviews: sandboxes.size });
});

app.listen(PORT, () => {
  console.log(`🚀 Static Sandbox Preview Engine running on port ${PORT}`);
});
