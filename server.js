const express = require('express');
const crypto = require('crypto');
const path = require('path');
const cors = require('cors');

const app = express();
const PORT = process.env.PORT || 3000;

const previews = new Map();
const PREVIEW_TTL_MS = 60 * 60 * 1000; // 1 hour
const MAX_FILES_SIZE = 10 * 1024 * 1024; // 10 MB

app.use(cors({ origin: true, credentials: true, optionsSuccessStatus: 200 }));
app.options('*', cors());
app.use(express.json({ limit: '10mb' }));
app.use(express.static(path.join(__dirname, 'public')));

function generateId() {
  return crypto.randomBytes(8).toString('hex');
}

setInterval(() => {
  const now = Date.now();
  for (const [id, entry] of previews.entries()) {
    if (now - entry.createdAt > PREVIEW_TTL_MS) previews.delete(id);
  }
}, 30 * 60 * 1000);

// ----------------------------------------------------------------------
// API endpoint: store files and return preview URL
app.post('/api/preview', (req, res) => {
  try {
    let { html, files } = req.body;

    if (typeof html === 'string') {
      files = { 'index.html': html };
    }

    if (!files || typeof files !== 'object') {
      return res.status(400).json({ error: 'Missing "html" string or "files" object.' });
    }

    let totalSize = 0;
    for (const content of Object.values(files)) {
      totalSize += Buffer.byteLength(content, 'utf8');
      if (totalSize > MAX_FILES_SIZE) {
        return res.status(413).json({ error: 'Total files size exceeds 10MB limit' });
      }
    }

    const id = generateId();
    previews.set(id, { files, createdAt: Date.now() });
    const previewUrl = `${req.protocol}://${req.get('host')}/preview/${id}`;
    res.json({ previewUrl, id });
  } catch (err) {
    console.error(err);
    const id = generateId();
    const fallbackFiles = { 'index.html': `<!DOCTYPE html><html><body><h1>Error</h1><p>${err.message}</p></body></html>` };
    previews.set(id, { files: fallbackFiles, createdAt: Date.now() });
    const previewUrl = `${req.protocol}://${req.get('host')}/preview/${id}`;
    res.json({ previewUrl, id, error: err.message });
  }
});

// ----------------------------------------------------------------------
// Serve preview page with LiveCodes embed (with fallback)
app.get('/preview/:id', (req, res) => {
  const { id } = req.params;
  const entry = previews.get(id);
  if (!entry) {
    return res.status(404).send(`<!DOCTYPE html><html><body><h2>Preview not found or expired</h2></body></html>`);
  }

  const files = entry.files;
  const filesJson = JSON.stringify(files);

  const html = `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>Preview</title>
  <style>
    body, html { margin: 0; padding: 0; width: 100%; height: 100%; overflow: hidden; }
    #container { width: 100%; height: 100%; }
    .error-fallback { padding: 20px; font-family: monospace; white-space: pre-wrap; background: #f5f5f5; height: 100%; overflow: auto; }
  </style>
  <!-- Load LiveCodes from official CDN -->
  <link rel="stylesheet" href="https://cdn.jsdelivr.net/npm/livecodes@latest/dist/livecodes.min.css">
  <script src="https://cdn.jsdelivr.net/npm/livecodes@latest/dist/livecodes.min.js"></script>
</head>
<body>
  <div id="container"></div>
  <script>
    (function() {
      const files = ${filesJson};

      // Wait for LiveCodes to be ready
      if (typeof livecodes === 'undefined') {
        console.error('LiveCodes not loaded');
        document.getElementById('container').innerHTML = '<div class="error-fallback"><h2>⚠️ LiveCodes failed to load</h2><p>Showing raw file contents:</p><pre>' + JSON.stringify(files, null, 2) + '</pre></div>';
        return;
      }

      // Determine main file
      let mainFile = 'index.html';
      if (!files['index.html'] && files['index.htm']) mainFile = 'index.htm';
      if (!files[mainFile]) {
        files[mainFile] = '<!DOCTYPE html><html><body><h1>Preview</h1><p>No index.html found</p></body></html>';
      }

      // Configure LiveCodes: show only the result pane (no editor) for a clean preview
      const config = {
        params: {
          files: files,
          activeFile: mainFile,
          autoRun: true,
          console: 'open',
        },
        layout: 'result',  // only the preview, no editor
      };

      // Create the playground
      livecodes.create('#container', config).catch(err => {
        console.error(err);
        document.getElementById('container').innerHTML = '<div class="error-fallback"><h2>⚠️ LiveCodes initialization failed</h2><p>' + err.message + '</p><pre>' + JSON.stringify(files, null, 2) + '</pre></div>';
      });
    })();
  </script>
</body>
</html>`;

  res.setHeader('Content-Type', 'text/html; charset=utf-8');
  res.send(html);
});

app.get('/health', (req, res) => {
  res.json({ status: 'ok', activePreviews: previews.size, uptime: process.uptime() });
});

app.listen(PORT, () => {
  console.log(`🚀 LiveCodes Preview Engine running on port ${PORT}`);
  console.log(`   Accepts: { "html": "..." } or { "files": { ... } }`);
  console.log(`   Preview uses LiveCodes (client-side) with fallback`);
  console.log(`   CORS enabled for all origins`);
});