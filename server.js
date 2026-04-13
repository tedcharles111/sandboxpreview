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

app.get('/preview/:id', async (req, res) => {
  const { id } = req.params;
  const entry = sandboxes.get(id);
  if (!entry) {
    return res.status(404).send('Preview not found');
  }

  // Read all files from the sandbox directory
  const files = {};
  async function readDir(dir, base = '') {
    const items = await fs.readdir(dir, { withFileTypes: true });
    for (const item of items) {
      const fullPath = path.join(dir, item.name);
      const relativePath = path.join(base, item.name);
      if (item.isDirectory()) {
        await readDir(fullPath, relativePath);
      } else {
        const content = await fs.readFile(fullPath, 'utf8');
        files[relativePath] = content;
      }
    }
  }
  await readDir(entry.dir);
  const filesJson = JSON.stringify(files);

  const html = `<!DOCTYPE html>
<html>
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>Preview</title>
  <style>
    body, html { margin: 0; padding: 0; width: 100%; height: 100%; overflow: hidden; }
    #root { width: 100%; height: 100%; }
  </style>
  <!-- Load React, ReactDOM, and the playground -->
  <script src="https://cdn.jsdelivr.net/npm/react@18.2.0/umd/react.development.js"></script>
  <script src="https://cdn.jsdelivr.net/npm/react-dom@18.2.0/umd/react-dom.development.js"></script>
  <script src="https://unpkg.com/agneym-playground@0.1.0/dist/index.umd.js"></script>
</head>
<body>
  <div id="root"></div>
  <script>
    const files = ${filesJson};
    // Determine the main files
    let htmlCode = files['index.html'] || '';
    let cssCode = files['style.css'] || '';
    let jsCode = files['app.js'] || '';
    // Look for React entry points
    if (files['src/main.jsx']) jsCode = files['src/main.jsx'];
    else if (files['src/App.jsx']) jsCode = files['src/App.jsx'];
    else if (files['src/index.js']) jsCode = files['src/index.js'];
    // If no HTML, create a minimal one
    if (!htmlCode) {
      htmlCode = '<!DOCTYPE html><html><head><meta charset="UTF-8"><title>Preview</title></head><body><div id="root"></div></body></html>';
    }
    // Initialize playground
    const container = document.getElementById('root');
    const Playground = window.Playground;
    if (Playground) {
      Playground.create(container, {
        files: {
          'index.html': htmlCode,
          'style.css': cssCode,
          'script.js': jsCode,
        },
        layout: 'result',
        showConsole: true,
      });
    } else {
      container.innerHTML = '<div style="padding:20px;color:red">Playground failed to load. Check your internet connection.</div>';
    }
  </script>
</body>
</html>`;
  res.send(html);
});

app.get('/health', (req, res) => {
  res.json({ status: 'ok', activePreviews: sandboxes.size });
});

app.listen(PORT, () => {
  console.log(`🚀 Sandbox with agneym/playground running on port ${PORT}`);
});
