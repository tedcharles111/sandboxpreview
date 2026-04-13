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

    // Extract HTML, CSS, JS from the files object
    let htmlContent = files['index.html'] || '';
    let cssContent = files['style.css'] || '';
    let jsContent = files['app.js'] || '';

    // If there are more files, we need to combine? CodePen only accepts single HTML/CSS/JS.
    // For simplicity, we take the first HTML, CSS, JS file found.
    for (const [filePath, content] of Object.entries(files)) {
      if (filePath.endsWith('.html') && !htmlContent) htmlContent = content;
      if (filePath.endsWith('.css') && !cssContent) cssContent = content;
      if (filePath.endsWith('.js') && !jsContent) jsContent = content;
    }

    if (!htmlContent) htmlContent = '<h1>Preview</h1>';

    // Create a unique ID for this preview (optional, for logging)
    const id = generateId();
    sandboxes.set(id, { createdAt: Date.now() });

    // Build the CodePen prefilled URL
    // CodePen expects a POST to https://codepen.io/pen/define with JSON data
    const codepenData = {
      title: 'Sandbox Preview',
      html: htmlContent,
      css: cssContent,
      js: jsContent,
      css_external: '',
      js_external: '',
      html_classes: '',
      css_starter: 'normalize',
    };

    // We'll return an HTML page that auto-submits a form to CodePen
    const formHtml = `<!DOCTYPE html>
<html>
<head>
  <meta charset="UTF-8">
  <title>Redirecting to CodePen...</title>
</head>
<body>
  <form id="codepenForm" action="https://codepen.io/pen/define" method="POST" target="_blank">
    <input type="hidden" name="data" value='${JSON.stringify(codepenData).replace(/'/g, "\\'")}'>
  </form>
  <script>
    document.getElementById('codepenForm').submit();
  </script>
</body>
</html>`;
    // Return the preview URL that will redirect to CodePen
    const previewUrl = `${req.protocol}://${req.get('host')}/preview/${id}`;
    sandboxes.set(id, { html: formHtml, createdAt: Date.now() });
    res.json({ previewUrl, id });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: err.message });
  }
});

app.get('/preview/:id', (req, res) => {
  const { id } = req.params;
  const entry = sandboxes.get(id);
  if (!entry || !entry.html) {
    return res.status(404).send('Preview not found');
  }
  res.send(entry.html);
});

app.get('/health', (req, res) => {
  res.json({ status: 'ok', activePreviews: sandboxes.size });
});

app.listen(PORT, () => {
  console.log(`🚀 CodePen Sandbox Preview Engine running on port ${PORT}`);
});
