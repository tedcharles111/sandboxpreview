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

  // Read all files
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

  // Build HTML using Playground Elements
  const html = `<!DOCTYPE html>
<html>
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>Preview</title>
  <style>
    body, html { margin: 0; padding: 0; width: 100%; height: 100%; overflow: hidden; }
    playground-ide { width: 100%; height: 100%; }
  </style>
  <script type="module" src="https://unpkg.com/playground-elements@0.10.0/playground-ide.js?module"></script>
</head>
<body>
  <playground-ide editable-file-system line-numbers resizable>
    <script type="sample/html" filename="index.html">${escapeHtml(files['index.html'] || '<h1>Preview</h1>')}</script>
    ${files['style.css'] ? `<script type="sample/css" filename="style.css">${escapeHtml(files['style.css'])}</script>` : ''}
    ${files['app.js'] ? `<script type="sample/js" filename="app.js">${escapeHtml(files['app.js'])}</script>` : ''}
    ${Object.entries(files).map(([file, content]) => {
      if (file === 'index.html' || file === 'style.css' || file === 'app.js') return '';
      const ext = path.extname(file).slice(1);
      return `<script type="sample/${ext}" filename="${file}">${escapeHtml(content)}</script>`;
    }).join('\n')}
  </playground-ide>
  <script>
    function escapeHtml(str) {
      return str.replace(/[&<>]/g, function(m) {
        if (m === '&') return '&amp;';
        if (m === '<') return '&lt;';
        if (m === '>') return '&gt;';
        return m;
      });
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
  console.log(`🚀 Sandbox with Playground Elements running on port ${PORT}`);
});
