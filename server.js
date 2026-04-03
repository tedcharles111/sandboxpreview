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
// Serve preview page with Sandpack embed
app.get('/preview/:id', (req, res) => {
  const { id } = req.params;
  const entry = previews.get(id);
  if (!entry) {
    return res.status(404).send(`<!DOCTYPE html><html><body><h2>Preview not found</h2></body></html>`);
  }

  const files = entry.files;
  // Convert files object to a JSON string that Sandpack understands
  // Sandpack expects a shape like { "/index.html": { code: "..." }, ... }
  const sandpackFiles = {};
  for (const [filePath, content] of Object.entries(files)) {
    // Ensure path starts with '/'
    const normalizedPath = filePath.startsWith('/') ? filePath : '/' + filePath;
    sandpackFiles[normalizedPath] = { code: content };
  }

  const filesJson = JSON.stringify(sandpackFiles).replace(/</g, '\\u003c');

  // Determine the main file (entry point)
  let mainFile = '/index.html';
  if (files['package.json']) {
    // For npm projects, Sandpack will use the entry defined in package.json
    // We can let Sandpack auto-detect
    mainFile = '/index.js'; // or '/src/index.js'
  }
  if (files['src/index.js']) mainFile = '/src/index.js';
  if (files['src/index.tsx']) mainFile = '/src/index.tsx';

  const html = `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>Sandpack Preview</title>
  <!-- Sandpack styles and scripts -->
  <link rel="stylesheet" href="https://sandpack.codesandbox.io/sandpack.css" />
  <script src="https://sandpack.codesandbox.io/sandpack.js"></script>
  <style>
    body, html { margin: 0; padding: 0; width: 100%; height: 100%; overflow: hidden; }
    #sandpack-container { width: 100%; height: 100%; }
  </style>
</head>
<body>
  <div id="sandpack-container"></div>
  <script>
    const sandpackFiles = ${filesJson};
    const sandpack = new Sandpack('#sandpack-container', {
      files: sandpackFiles,
      entry: '${mainFile}',
      showNavigator: true,
      showConsole: true,
      showConsoleButton: true,
      showLineNumbers: true,
      showInlineErrors: true,
      showErrorOverlay: true,
      // Automatically resolve dependencies from package.json
      autoResolve: true,
      // Use the official CodeSandbox bundler (self-hosted alternative available)
      bundlerUrl: 'https://sandpack.codesandbox.io',
    });
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