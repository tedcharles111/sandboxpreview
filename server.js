const express = require('express');
const crypto = require('crypto');
const path = require('path');
const cors = require('cors');

const app = express();
const PORT = process.env.PORT || 3000;

const previews = new Map();
const PREVIEW_TTL_MS = 60 * 60 * 1000;
const MAX_HTML_SIZE = 5 * 1024 * 1024;
const MAX_FILES_SIZE = 10 * 1024 * 1024;

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

// --------------------------------------------------------------
// Clean JS (remove CommonJS and ES6 module lines)
function cleanJS(content) {
  const lines = content.split('\n');
  const filtered = lines.filter(line => {
    const l = line.trim();
    if (l.includes('require(')) return false;
    if (l.includes('exports.')) return false;
    if (l.includes('module.exports')) return false;
    if (l.includes('Object.defineProperty(exports,')) return false;
    if (l.match(/^\s*import\s+/)) return false;
    if (l.match(/^\s*export\s+default\s+/)) return false;
    if (l.match(/^\s*export\s+{\s*/)) return false;
    if (l.match(/^\s*export\s+(const|let|var|function|class)/)) return false;
    return true;
  });
  let cleaned = filtered.join('\n');
  cleaned = cleaned.replace(/\bexports\b/g, '');
  return cleaned;
}

// --------------------------------------------------------------
// Reliable bundler (server-side)
function bundleProject(files) {
  let htmlContent = files['index.html'] || files['index.htm'];
  if (!htmlContent) {
    let fileList = Object.keys(files).map(f => `<li>${f}</li>`).join('');
    htmlContent = `<!DOCTYPE html>
<html>
<head><title>Multi-File Preview</title></head>
<body>
  <h2>⚠️ No index.html found</h2>
  <p>Available files:</p>
  <ul>${fileList}</ul>
</body>
</html>`;
  }

  // Inject CSS
  let cssInjection = '';
  for (const [filePath, content] of Object.entries(files)) {
    if (filePath.endsWith('.css')) {
      cssInjection += `<style>/* ${filePath} */\n${content}\n</style>\n`;
    }
  }
  if (cssInjection && htmlContent.includes('</head>')) {
    htmlContent = htmlContent.replace('</head>', `${cssInjection}\n</head>`);
  }

  // Collect JS
  let jsInjection = '';
  let hasReact = false;
  for (const [filePath, content] of Object.entries(files)) {
    if (filePath.endsWith('.js') || filePath.endsWith('.jsx')) {
      const cleaned = cleanJS(content);
      if (cleaned.includes('React') || cleaned.includes('JSX') || filePath.endsWith('.jsx')) {
        hasReact = true;
      }
      jsInjection += `<script>/* ${filePath} */\n${cleaned}\n</script>\n`;
    }
  }

  // Add CDNs for React
  if (hasReact) {
    const reactScripts = `
      <script src="https://cdn.jsdelivr.net/npm/react@18.2.0/umd/react.development.js"></script>
      <script src="https://cdn.jsdelivr.net/npm/react-dom@18.2.0/umd/react-dom.development.js"></script>
      <script src="https://cdn.jsdelivr.net/npm/@babel/standalone/babel.min.js"></script>
      <script src="https://cdn.jsdelivr.net/npm/react-router-dom@6.14.2/umd/react-router-dom.development.js"></script>
    `;
    if (htmlContent.includes('</head>')) {
      htmlContent = htmlContent.replace('</head>', reactScripts + '\n</head>');
    } else {
      htmlContent = htmlContent.replace('<body', `<head>${reactScripts}</head><body`);
    }
    jsInjection = jsInjection.replace(/<script>/g, '<script type="text/babel">');
  }

  // Append JS
  if (jsInjection) {
    if (htmlContent.includes('</body>')) {
      htmlContent = htmlContent.replace('</body>', `${jsInjection}\n</body>`);
    } else {
      htmlContent += jsInjection;
    }
  }

  // Error handler overlay
  const errorHandler = `
  <div id="error-overlay" style="position:fixed; bottom:20px; left:20px; right:20px; background:#ff4444cc; backdrop-filter:blur(8px); color:white; padding:12px; border-radius:8px; font-family:monospace; font-size:13px; z-index:1000; display:none; max-height:200px; overflow:auto; border-left:4px solid #ff0000;"></div>
  <script>
    window.onerror = function(msg, url, line, col, error) {
      const overlay = document.getElementById('error-overlay');
      overlay.innerHTML = '❌ Runtime Error:<br>' + msg;
      overlay.style.display = 'block';
      console.error(msg);
      return true;
    };
    window.addEventListener('error', function(e) {
      const overlay = document.getElementById('error-overlay');
      overlay.innerHTML = '❌ Error: ' + e.message;
      overlay.style.display = 'block';
      e.preventDefault();
    }, true);
    window.addEventListener('unhandledrejection', function(e) {
      const overlay = document.getElementById('error-overlay');
      overlay.innerHTML = '❌ Unhandled Promise: ' + e.reason;
      overlay.style.display = 'block';
    });
    setTimeout(() => {
      const overlay = document.getElementById('error-overlay');
      if (overlay.style.display === 'block') overlay.style.display = 'none';
    }, 8000);
  <\/script>
  `;
  if (htmlContent.includes('</body>')) {
    htmlContent = htmlContent.replace('</body>', errorHandler + '\n</body>');
  } else {
    htmlContent += errorHandler;
  }

  if (!htmlContent.trim().toLowerCase().startsWith('<!doctype')) {
    htmlContent = '<!DOCTYPE html>\n' + htmlContent;
  }
  return htmlContent;
}

// --------------------------------------------------------------
// API endpoint
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
    const bundledHtml = bundleProject(files);
    previews.set(id, { html: bundledHtml, createdAt: Date.now() });
    const previewUrl = `${req.protocol}://${req.get('host')}/preview/${id}`;
    res.json({ previewUrl, id });
  } catch (err) {
    console.error(err);
    const id = generateId();
    const fallbackHtml = `<!DOCTYPE html><html><body><h1>Error</h1><p>${err.message}</p></body></html>`;
    previews.set(id, { html: fallbackHtml, createdAt: Date.now() });
    const previewUrl = `${req.protocol}://${req.get('host')}/preview/${id}`;
    res.json({ previewUrl, id, error: err.message });
  }
});

// Serve previews
app.get('/preview/:id', (req, res) => {
  const { id } = req.params;
  const entry = previews.get(id);
  if (!entry) {
    return res.status(404).send(`<!DOCTYPE html><html><body><h2>Preview not found</h2></body></html>`);
  }
  res.setHeader('Content-Type', 'text/html; charset=utf-8');
  res.send(entry.html);
});

app.get('/health', (req, res) => {
  res.json({ status: 'ok', activePreviews: previews.size, uptime: process.uptime() });
});

app.listen(PORT, () => {
  console.log(`🚀 Robust Preview Engine running on port ${PORT}`);
  console.log(`   Bundles multi-file projects server-side`);
  console.log(`   Error overlay shows runtime errors`);
});