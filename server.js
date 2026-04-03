const express = require('express');
const crypto = require('crypto');
const path = require('path');
const cors = require('cors');

const app = express();
const PORT = process.env.PORT || 3000;

const previews = new Map();
const PREVIEW_TTL_MS = 60 * 60 * 1000;
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

// ----------------------------------------------------------------------
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
app.get('/preview/:id', (req, res) => {
  const { id } = req.params;
  const entry = previews.get(id);
  if (!entry) {
    return res.status(404).send(`<!DOCTYPE html><html><body><h2>Preview not found</h2></body></html>`);
  }

  const files = entry.files;
  const filesJson = JSON.stringify(files).replace(/</g, '\\u003c').replace(/>/g, '\\u003e'); // safe for embedding

  // Build the HTML response using an array to avoid nested template literals
  const htmlParts = [
    '<!DOCTYPE html>',
    '<html lang="en">',
    '<head>',
    '<meta charset="UTF-8">',
    '<meta name="viewport" content="width=device-width, initial-scale=1.0">',
    '<title>Sandbox Preview</title>',
    '<style>',
    '* { margin: 0; padding: 0; box-sizing: border-box; }',
    'body, html { width: 100%; height: 100%; overflow: hidden; font-family: system-ui, sans-serif; }',
    '#container { width: 100%; height: 100%; display: flex; flex-direction: column; }',
    '#toolbar { background: #1e1e2f; color: white; padding: 8px 16px; font-size: 12px; display: flex; justify-content: space-between; align-items: center; border-bottom: 1px solid #333; }',
    '#run-btn { background: #0a5; border: none; color: white; padding: 4px 12px; border-radius: 4px; cursor: pointer; }',
    '#run-btn:hover { background: #0a7; }',
    '#error-overlay { position: fixed; bottom: 20px; left: 20px; right: 20px; background: #ff4444cc; backdrop-filter: blur(8px); color: white; padding: 12px; border-radius: 8px; font-family: monospace; font-size: 13px; z-index: 1000; display: none; max-height: 200px; overflow: auto; border-left: 4px solid #ff0000; }',
    'iframe { flex: 1; width: 100%; border: none; background: white; }',
    '.loading { display: flex; align-items: center; justify-content: center; height: 100%; font-size: 14px; color: #666; }',
    '</style>',
    '<script src="https://cdn.jsdelivr.net/npm/esbuild-wasm@0.20.2/esbuild.wasm.js"><\/script>',
    '</head>',
    '<body>',
    '<div id="container">',
    '<div id="toolbar">',
    '<span>⚡ Sandbox Preview (esbuild + iframe)</span>',
    '<button id="run-btn">▶ Run</button>',
    '</div>',
    '<iframe id="preview-frame" title="preview" sandbox="allow-same-origin allow-scripts allow-popups allow-forms allow-modals"></iframe>',
    '<div id="error-overlay"></div>',
    '</div>',
    '<script>',
    'const files = ' + filesJson + ';',
    'const fileMap = new Map();',
    'for (const [path, content] of Object.entries(files)) { fileMap.set(path, content); }',
    'async function bundleAndRun() {',
    '  const iframe = document.getElementById("preview-frame");',
    '  const errorDiv = document.getElementById("error-overlay");',
    '  errorDiv.style.display = "none";',
    '  iframe.srcdoc = "<div class=\"loading\">⏳ Bundling...</div>";',
    '  if (!window.esbuild) {',
    '    errorDiv.innerHTML = "❌ esbuild failed to load. Please check your internet connection.";',
    '    errorDiv.style.display = "block";',
    '    iframe.srcdoc = "<div class=\"loading\">⚠️ Failed to load bundler</div>";',
    '    return;',
    '  }',
    '  try { await window.esbuild.initialize({ wasmURL: "https://cdn.jsdelivr.net/npm/esbuild-wasm@0.20.2/esbuild.wasm" }); } catch (err) {',
    '    errorDiv.innerHTML = "❌ Failed to initialize esbuild: " + err.message;',
    '    errorDiv.style.display = "block";',
    '    iframe.srcdoc = "<div class=\"loading\">⚠️ Bundler initialization failed</div>";',
    '    return;',
    '  }',
    '  const plugins = [{ name: "fs", setup(build) {',
    '    build.onResolve({ filter: /.*/ }, args => {',
    '      if (args.path.startsWith(".") || args.path.startsWith("/") || args.path === "index.html") { return { path: args.path, namespace: "file" }; }',
    '      return { external: true };',
    '    });',
    '    build.onLoad({ filter: /.*/, namespace: "file" }, async (args) => {',
    '      const content = fileMap.get(args.path);',
    '      if (content) return { contents: content, loader: "jsx" };',
    '      return null;',
    '    });',
    '  }}];',
    '  function findEntryPoint() {',
    '    if (fileMap.has("index.html")) return "index.html";',
    '    if (fileMap.has("index.htm")) return "index.htm";',
    '    return null;',
    '  }',
    '  const entryHtml = findEntryPoint();',
    '  if (entryHtml) {',
    '    let htmlContent = fileMap.get(entryHtml);',
    '    const catcher = "<script>window.onerror = function(msg,url,line,col,error){parent.postMessage({type:\"error\",error:msg},\"*\");return true;};<\/script>";',
    '    const finalHtml = htmlContent.replace("</head>", catcher + "</head>");',
    '    iframe.srcdoc = finalHtml;',
    '  } else {',
    '    let entryFile = "src/index.js";',
    '    if (!fileMap.has(entryFile)) entryFile = "src/index.tsx";',
    '    if (!fileMap.has(entryFile)) entryFile = "src/main.js";',
    '    if (!fileMap.has(entryFile)) entryFile = "index.js";',
    '    if (!fileMap.has(entryFile)) throw new Error("No entry file found (src/index.js, src/index.tsx, etc.)");',
    '    const result = await window.esbuild.build({',
    '      entryPoints: [entryFile],',
    '      bundle: true,',
    '      write: false,',
    '      format: "iife",',
    '      globalName: "Sandbox",',
    '      platform: "browser",',
    '      plugins: plugins,',
    '      loader: { ".js": "jsx", ".ts": "tsx", ".tsx": "tsx" }',
    '    });',
    '    const bundledCode = result.outputFiles[0].text;',
    '    const iframeHtml = "<!DOCTYPE html><html><head><meta charset=\"UTF-8\"><title>Preview</title></head><body><div id=\"root\"></div><script>window.onerror = function(msg,url,line,col,error){parent.postMessage({type:\"error\",error:msg},\"*\");return true;}; try { ' + bundledCode + ' if (typeof Sandbox !== \"undefined\" && Sandbox.default) { const root = ReactDOM.createRoot(document.getElementById(\"root\")); root.render(React.createElement(Sandbox.default)); } } catch(err) { parent.postMessage({type:\"error\",error:err.message},\"*\"); } <\\/script></body></html>";',
    '    iframe.srcdoc = iframeHtml;',
    '  }',
    '}',
    'window.addEventListener("message", (event) => {',
    '  if (event.data && event.data.type === "error") {',
    '    const errorDiv = document.getElementById("error-overlay");',
    '    errorDiv.innerHTML = "❌ Runtime Error:<br>" + event.data.error;',
    '    errorDiv.style.display = "block";',
    '    setTimeout(() => { if (errorDiv.style.display === "block") errorDiv.style.display = "none"; }, 8000);',
    '  }',
    '});',
    'document.getElementById("run-btn").addEventListener("click", bundleAndRun);',
    'bundleAndRun();',
    '<\/script>',
    '</body>',
    '</html>'
  ];

  const html = htmlParts.join('\n');

  res.setHeader('Content-Type', 'text/html; charset=utf-8');
  res.send(html);
});

app.get('/health', (req, res) => {
  res.json({ status: 'ok', activePreviews: previews.size, uptime: process.uptime() });
});

app.listen(PORT, () => {
  console.log(`🚀 Ultimate Sandbox Preview Engine running on port ${PORT}`);
  console.log(`   Bundler: esbuild-wasm (client-side)`);
  console.log(`   Runner: iframe with error capture`);
});