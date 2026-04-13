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
      if (data.dir) await fs.rm(data.dir, { recursive: true, force: true });
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

    // Extract HTML, CSS, JS
    let htmlContent = files['index.html'] || '';
    let cssContent = files['style.css'] || '';
    let jsContent = files['app.js'] || '';

    for (const [filePath, content] of Object.entries(files)) {
      if (filePath.endsWith('.html') && !htmlContent) htmlContent = content;
      if (filePath.endsWith('.css') && !cssContent) cssContent = content;
      if (filePath.endsWith('.js') && !jsContent) jsContent = content;
    }

    if (!htmlContent) htmlContent = '<h1>Preview</h1>';

    const id = generateId();
    sandboxes.set(id, { html: htmlContent, css: cssContent, js: jsContent, createdAt: Date.now() });

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

  // Build a CodePen embedded preview using the iframe API
  // CodePen's embed endpoint expects a JSON object in the src parameter.
  // Actually, the easiest way is to create a data URL for CodePen's "prefill" POST, but that opens a new window.
  // Instead, we'll embed using an iframe with srcdoc that contains a simple sandbox? No, better to use a static HTML that loads the code in a sandboxed iframe.

  // We'll create a simple inline preview (like the static server) because CodePen embed requires a paid plan for private pens.
  // Let's fall back to a static preview with an iframe that contains the HTML, CSS, JS.

  const htmlContent = entry.html;
  const cssContent = entry.css;
  const jsContent = entry.js;

  // Build a complete HTML document with inline CSS and JS
  const fullHtml = `<!DOCTYPE html>
<html>
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>Preview</title>
  <style>${cssContent}</style>
</head>
<body>
  ${htmlContent}
  <script>${jsContent}<\/script>
</body>
</html>`;

  // Serve as srcdoc in an iframe for isolation
  const previewHtml = `<!DOCTYPE html>
<html>
<head>
  <style>
    body, html { margin: 0; padding: 0; width: 100%; height: 100%; overflow: hidden; }
    iframe { width: 100%; height: 100%; border: none; }
  </style>
</head>
<body>
  <iframe sandbox="allow-same-origin allow-scripts allow-popups allow-forms" srcdoc="${escapeHtml(fullHtml)}"></iframe>
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
  res.send(previewHtml);
});

function escapeHtml(str) {
  return str.replace(/[&<>]/g, function(m) {
    if (m === '&') return '&amp;';
    if (m === '<') return '&lt;';
    if (m === '>') return '&gt;';
    return m;
  });
}

app.get('/health', (req, res) => {
  res.json({ status: 'ok', activePreviews: sandboxes.size });
});

app.listen(PORT, () => {
  console.log(`🚀 Static Preview Engine (inline iframe) running on port ${PORT}`);
});
