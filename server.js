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

    // --- Extract HTML, CSS, and JS from the uploaded files ---
    let htmlContent = files['index.html'] || '';
    let cssContent = files['style.css'] || '';
    let jsContent = files['app.js'] || '';

    // Fallbacks for alternative file names
    for (const [filePath, content] of Object.entries(files)) {
      if (filePath.endsWith('.html') && !htmlContent) htmlContent = content;
      if (filePath.endsWith('.css') && !cssContent) cssContent = content;
      if (filePath.endsWith('.js') && !jsContent) jsContent = content;
    }

    if (!htmlContent) htmlContent = '<h1>Preview</h1>';

    // --- Inject CSS and JS into the HTML ---
    let finalHtml = htmlContent;
    if (cssContent) {
      const styleTag = `<style>${cssContent}</style>`;
      if (finalHtml.includes('</head>')) {
        finalHtml = finalHtml.replace('</head>', `${styleTag}</head>`);
      } else {
        finalHtml = finalHtml.replace('<body', `${styleTag}<body`);
      }
    }
    if (jsContent) {
      const scriptTag = `<script>${jsContent}</script>`;
      if (finalHtml.includes('</body>')) {
        finalHtml = finalHtml.replace('</body>', `${scriptTag}</body>`);
      } else {
        finalHtml += scriptTag;
      }
    }

    // --- Ensure a root div exists (helpful for React apps) ---
    if (!finalHtml.includes('<div id="root"></div>')) {
      finalHtml = finalHtml.replace('<body>', '<body><div id="root"></div>');
    }

    const id = generateId();
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
  console.log(`🚀 Sandbox Preview Engine running on port ${PORT}`);
});
