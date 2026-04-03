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
      return res.status(400).json({ error: 'Missing "html" or "files"' });
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
// Serve preview page with Sandpack embed (fixed)
app.get('/preview/:id', (req, res) => {
  const { id } = req.params;
  const entry = previews.get(id);
  if (!entry) {
    return res.status(404).send(`<!DOCTYPE html><html><body><h2>Preview not found</h2></body></html>`);
  }

  const files = entry.files;
  // Convert files to Sandpack format: { "/index.js": { code: "..." } }
  const sandpackFiles = {};
  for (const [filePath, content] of Object.entries(files)) {
    const normalizedPath = filePath.startsWith('/') ? filePath : '/' + filePath;
    sandpackFiles[normalizedPath] = { code: content };
  }
  const filesJson = JSON.stringify(sandpackFiles).replace(/</g, '\\u003c');

  // Determine entry point
  let entryPoint = '/index.html';
  if (files['package.json']) {
    // Sandpack will auto-detect entry from package.json, but we can hint
    entryPoint = '/index.js';
  }
  if (files['src/index.js']) entryPoint = '/src/index.js';
  if (files['src/index.tsx']) entryPoint = '/src/index.tsx';

  // Use the official Sandpack React UMD bundle and React/ReactDOM for the embed
  const html = `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>Sandpack Preview</title>
  <style>
    body, html { margin: 0; padding: 0; width: 100%; height: 100%; overflow: hidden; }
    #root { width: 100%; height: 100%; }
  </style>
  <!-- Load React, ReactDOM, and Sandpack -->
  <script src="https://cdn.jsdelivr.net/npm/react@18.2.0/umd/react.development.js"></script>
  <script src="https://cdn.jsdelivr.net/npm/react-dom@18.2.0/umd/react-dom.development.js"></script>
  <script src="https://cdn.jsdelivr.net/npm/@codesandbox/sandpack-react@2.19.10/dist/index.umd.js"></script>
  <link rel="stylesheet" href="https://cdn.jsdelivr.net/npm/@codesandbox/sandpack-react@2.19.10/dist/index.css">
</head>
<body>
  <div id="root"></div>
  <script>
    // Wait for Sandpack to be available
    function initSandpack() {
      if (!window.Sandpack) {
        console.error('Sandpack not loaded yet, retrying...');
        setTimeout(initSandpack, 500);
        return;
      }
      const { Sandpack } = window.Sandpack;
      const root = ReactDOM.createRoot(document.getElementById('root'));
      root.render(
        React.createElement(Sandpack, {
          files: ${filesJson},
          template: 'react',
          customSetup: {
            entry: '${entryPoint}',
          },
          options: {
            showNavigator: true,
            showConsole: true,
            showConsoleButton: true,
            showLineNumbers: true,
            showInlineErrors: true,
            showErrorOverlay: true,
          },
        })
      );
    }
    initSandpack();
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
  console.log(`🚀 Sandpack Preview Engine running on port ${PORT}`);
  console.log(`   Supports npm packages, package.json, Vite/Next.js via Sandpack`);
  console.log(`   Shows runtime errors with overlay`);
});