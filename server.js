const express = require('express');
const crypto = require('crypto');
const fs = require('fs').promises;
const path = require('path');
const cors = require('cors');
const http = require('http');

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
      if (data.server) data.server.close();
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

    // Write all files – ignore package.json
    for (const [filePath, content] of Object.entries(files)) {
      if (filePath === 'package.json') continue; // skip package.json
      const fullPath = path.join(dir, filePath);
      await fs.mkdir(path.dirname(fullPath), { recursive: true });
      await fs.writeFile(fullPath, content);
    }

    // If no index.html, create a fallback
    const indexPath = path.join(dir, 'index.html');
    try {
      await fs.access(indexPath);
    } catch {
      await fs.writeFile(indexPath, '<h1>Preview</h1><p>No index.html found</p>');
    }

    // Start a static HTTP server for this sandbox
    const staticServer = http.createServer(async (req, res) => {
      let filePath = path.join(dir, req.url === '/' ? 'index.html' : req.url);
      try {
        const data = await fs.readFile(filePath);
        res.writeHead(200, { 'Content-Type': getContentType(filePath) });
        res.end(data);
      } catch {
        res.writeHead(404);
        res.end('File not found');
      }
    });

    const port = 3000 + Math.floor(Math.random() * 1000);
    staticServer.listen(port, '0.0.0.0', () => {
      sandboxes.set(id, { dir, server: staticServer, port, createdAt: Date.now() });
      const previewUrl = `${req.protocol}://${req.get('host')}/preview/${id}`;
      res.json({ previewUrl, id });
    });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: err.message });
  }
});

function getContentType(filePath) {
  const ext = path.extname(filePath).toLowerCase();
  const types = {
    '.html': 'text/html',
    '.css': 'text/css',
    '.js': 'application/javascript',
    '.json': 'application/json',
    '.png': 'image/png',
    '.jpg': 'image/jpeg',
    '.svg': 'image/svg+xml',
  };
  return types[ext] || 'text/plain';
}

app.get('/preview/:id', (req, res) => {
  const { id } = req.params;
  const entry = sandboxes.get(id);
  if (!entry) {
    return res.status(404).send('<!DOCTYPE html><html><body><h2>Preview not found or expired</h2></body></html>');
  }
  // Proxy requests to the internal static server
  const proxy = http.request({
    hostname: 'localhost',
    port: entry.port,
    path: req.url,
    method: req.method,
  }, (proxyRes) => {
    res.writeHead(proxyRes.statusCode, proxyRes.headers);
    proxyRes.pipe(res);
  });
  req.pipe(proxy);
  proxy.on('error', (err) => {
    res.status(502).send('Proxy error');
  });
});

app.get('/health', (req, res) => {
  res.json({ status: 'ok', activePreviews: sandboxes.size });
});

app.listen(PORT, () => {
  console.log(`🚀 Static Sandbox Preview Engine running on port ${PORT}`);
});
