const express = require('express');
const crypto = require('crypto');
const fs = require('fs').promises;
const path = require('path');
const cors = require('cors');
const esbuild = require('esbuild');

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

async function bundleProject(dir, entryPoint) {
  // Find entry point (src/main.jsx, index.js, etc.)
  let entry = entryPoint;
  if (!entry) {
    const candidates = ['src/main.jsx', 'src/index.jsx', 'src/main.js', 'src/index.js', 'index.js', 'main.jsx'];
    for (const cand of candidates) {
      try {
        await fs.access(path.join(dir, cand));
        entry = cand;
        break;
      } catch {}
    }
  }
  if (!entry) throw new Error('No entry point found (src/main.jsx, index.js, etc.)');

  // Bundle using esbuild
  const result = await esbuild.build({
    entryPoints: [path.join(dir, entry)],
    bundle: true,
    write: false,
    format: 'iife',
    globalName: 'App',
    platform: 'browser',
    loader: { '.js': 'jsx', '.jsx': 'jsx', '.ts': 'tsx', '.tsx': 'tsx' },
    define: { 'process.env.NODE_ENV': '"production"' },
  });

  const bundledCode = result.outputFiles[0].text;

  // Read index.html (or create fallback)
  let html = '<!DOCTYPE html><html><head><meta charset="UTF-8"><title>Preview</title></head><body><div id="root"></div><script>' + bundledCode + '</script></body></html>';
  try {
    const htmlPath = path.join(dir, 'index.html');
    await fs.access(htmlPath);
    html = await fs.readFile(htmlPath, 'utf8');
    // Inject bundled script before closing </body>
    html = html.replace('</body>', `<script>${bundledCode}</script></body>`);
    // If no root div, add one
    if (!html.includes('<div id="root"></div>')) {
      html = html.replace('<body>', '<body><div id="root"></div>');
    }
  } catch {}

  // Extract and inject CSS (if any CSS files exist)
  const cssFiles = [];
  async function collectCSS(currentDir) {
    const items = await fs.readdir(currentDir, { withFileTypes: true });
    for (const item of items) {
      const fullPath = path.join(currentDir, item.name);
      if (item.isDirectory()) await collectCSS(fullPath);
      else if (item.name.endsWith('.css')) {
        const content = await fs.readFile(fullPath, 'utf8');
        cssFiles.push(content);
      }
    }
  }
  await collectCSS(dir);
  if (cssFiles.length) {
    const styleTag = `<style>${cssFiles.join('\n')}</style>`;
    html = html.replace('</head>', `${styleTag}</head>`);
  }

  return html;
}

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

    // Write all files
    for (const [filePath, content] of Object.entries(files)) {
      if (filePath === 'package.json') continue; // ignore package.json
      const fullPath = path.join(dir, filePath);
      await fs.mkdir(path.dirname(fullPath), { recursive: true });
      await fs.writeFile(fullPath, content);
    }

    // Ensure index.html exists
    const indexPath = path.join(dir, 'index.html');
    try {
      await fs.access(indexPath);
    } catch {
      await fs.writeFile(indexPath, '<!DOCTYPE html><html><head><title>Preview</title></head><body><div id="root"></div></body></html>');
    }

    // Bundle the project
    let finalHtml;
    try {
      finalHtml = await bundleProject(dir);
    } catch (err) {
      console.error('Bundling error:', err);
      // Fallback: serve raw index.html
      finalHtml = await fs.readFile(indexPath, 'utf8');
    }

    sandboxes.set(id, { html: finalHtml, createdAt: Date.now() });
    const previewUrl = `${req.protocol}://${req.get('host')}/preview/${id}`;
    res.json({ previewUrl, id });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: err.message });
  }
});

app.get('/preview/:id', (req, res) => {
  const { id } = req.params;
  const entry = sandboxes.get(id);
  if (!entry) {
    return res.status(404).send('Preview not found');
  }
  res.setHeader('Content-Type', 'text/html');
  res.send(entry.html);
});

app.get('/health', (req, res) => {
  res.json({ status: 'ok', activePreviews: sandboxes.size });
});

app.listen(PORT, () => {
  console.log(`🚀 Bundling Sandbox Preview Engine running on port ${PORT}`);
});
