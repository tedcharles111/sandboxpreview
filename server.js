const express = require('express');
const crypto = require('crypto');
const path = require('path');

const app = express();
const PORT = process.env.PORT || 3000;

// In-memory store
const previews = new Map();
const PREVIEW_TTL_MS = 60 * 60 * 1000; // 1 hour
const MAX_HTML_SIZE = 5 * 1024 * 1024;
const MAX_FILES_SIZE = 10 * 1024 * 1024;

app.use(express.json({ limit: '10mb' }));
app.use(express.static(path.join(__dirname, 'public')));

function generateId() {
  return crypto.randomBytes(8).toString('hex');
}

// Cleanup expired previews
setInterval(() => {
  const now = Date.now();
  for (const [id, entry] of previews.entries()) {
    if (now - entry.createdAt > PREVIEW_TTL_MS) previews.delete(id);
  }
}, 30 * 60 * 1000);

// ----------------------------------------------------------------------
// Multi-file bundler
function bundleMultiFile(files) {
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

  let cssInjection = '';
  let jsInjection = '';
  for (const [filePath, content] of Object.entries(files)) {
    if (filePath.endsWith('.css')) {
      cssInjection += `<style>/* ${filePath} */\n${content}\n</style>\n`;
    } else if (filePath.endsWith('.js')) {
      jsInjection += `<script>/* ${filePath} */\n${content}\n</script>\n`;
    }
  }

  if (cssInjection || jsInjection) {
    if (htmlContent.includes('</head>')) {
      htmlContent = htmlContent.replace('</head>', `${cssInjection}\n${jsInjection}\n</head>`);
    } else if (htmlContent.includes('<body')) {
      htmlContent = htmlContent.replace('<body', `<head>${cssInjection}\n${jsInjection}</head><body`);
    } else {
      htmlContent = `<!DOCTYPE html><html><head>${cssInjection}\n${jsInjection}</head><body>${htmlContent}</body></html>`;
    }
  }
  return htmlContent;
}

// ----------------------------------------------------------------------
// Framework wrappers
function wrapReact(userCode) {
  return `<!DOCTYPE html>
<html>
<head>
  <meta charset="UTF-8">
  <title>React Preview</title>
  <script src="https://cdn.jsdelivr.net/npm/react@18.2.0/umd/react.development.js"></script>
  <script src="https://cdn.jsdelivr.net/npm/react-dom@18.2.0/umd/react-dom.development.js"></script>
  <script src="https://cdn.jsdelivr.net/npm/@babel/standalone/babel.min.js"></script>
</head>
<body>
  <div id="root"></div>
  <script type="text/babel">
    ${userCode}
    if (typeof App !== 'undefined') {
      const root = ReactDOM.createRoot(document.getElementById('root'));
      root.render(React.createElement(App));
    } else if (typeof MyComponent !== 'undefined') {
      const root = ReactDOM.createRoot(document.getElementById('root'));
      root.render(React.createElement(MyComponent));
    } else {
      document.getElementById('root').innerHTML = '<p style="color:red;">⚠️ No React component found. Define a component named "App" or "MyComponent".</p>';
    }
  </script>
</body>
</html>`;
}

function wrapVue(userCode) {
  return `<!DOCTYPE html>
<html>
<head>
  <meta charset="UTF-8">
  <title>Vue Preview</title>
  <script src="https://unpkg.com/vue@3/dist/vue.global.js"></script>
</head>
<body>
  <div id="app"></div>
  <script>
    ${userCode}
    if (typeof app === 'undefined' && typeof Vue !== 'undefined') {
      const defaultApp = {
        template: \`<div>No Vue component defined. Please define a Vue app or component.</div>\`
      };
      Vue.createApp(defaultApp).mount('#app');
    }
  </script>
</body>
</html>`;
}

function wrapSvelte(userCode) {
  return `<!DOCTYPE html>
<html>
<head>
  <meta charset="UTF-8">
  <title>Svelte Preview</title>
  <script src="https://unpkg.com/svelte@3.59.2/compiler.js"></script>
  <script src="https://unpkg.com/svelte@3.59.2/internal.js"></script>
</head>
<body>
  <div id="target"></div>
  <script>
    const source = \`${userCode.replace(/`/g, '\\`')}\`;
    try {
      const compiled = svelte.compile(source, { generate: 'dom', format: 'iife' });
      const Component = new Function('target', compiled.js.code);
      Component({ target: document.getElementById('target') });
    } catch (err) {
      document.getElementById('target').innerHTML = '<pre style="color:red;">Svelte compile error: ' + err.message + '</pre>';
    }
  </script>
</body>
</html>`;
}

function wrapAngular(userCode) {
  return `<!DOCTYPE html>
<html>
<head>
  <meta charset="UTF-8">
  <title>Angular Preview</title>
  <script src="https://unpkg.com/@angular/core@16.2.0/bundles/core.umd.js"></script>
  <script src="https://unpkg.com/@angular/common@16.2.0/bundles/common.umd.js"></script>
  <script src="https://unpkg.com/@angular/platform-browser@16.2.0/bundles/platform-browser.umd.js"></script>
  <script src="https://unpkg.com/@angular/elements@16.2.0/bundles/elements.umd.js"></script>
  <script src="https://unpkg.com/@angular/compiler@16.2.0/bundles/compiler.umd.js"></script>
</head>
<body>
  <my-app></my-app>
  <script>
    ${userCode}
    if (typeof AppComponent !== 'undefined') {
      const { platformBrowserDynamic } = require('@angular/platform-browser-dynamic');
      platformBrowserDynamic().bootstrapModule(AppModule);
    } else {
      document.body.innerHTML = '<p style="color:red;">Angular component not found. Define an AppComponent.</p>';
    }
  </script>
</body>
</html>`;
}

// ----------------------------------------------------------------------
// API endpoint
app.post('/api/preview', (req, res) => {
  try {
    let { html, files, framework = 'vanilla' } = req.body;

    if (files && typeof files === 'object') {
      let totalSize = 0;
      for (const content of Object.values(files)) {
        totalSize += Buffer.byteLength(content, 'utf8');
        if (totalSize > MAX_FILES_SIZE) {
          return res.status(413).json({ error: 'Total files size exceeds 10MB limit' });
        }
      }
      html = bundleMultiFile(files);
    }

    if (typeof html !== 'string') {
      return res.status(400).json({ error: 'Missing "html" string or "files" object.' });
    }

    if (Buffer.byteLength(html, 'utf8') > MAX_HTML_SIZE) {
      html = html.slice(0, MAX_HTML_SIZE);
      console.warn(`⚠️ Preview truncated to ${MAX_HTML_SIZE} bytes`);
    }

    let finalHtml = html;
    if (framework === 'react') {
      finalHtml = wrapReact(html);
    } else if (framework === 'vue') {
      finalHtml = wrapVue(html);
    } else if (framework === 'svelte') {
      finalHtml = wrapSvelte(html);
    } else if (framework === 'angular') {
      finalHtml = wrapAngular(html);
    }

    const id = generateId();
    previews.set(id, { html: finalHtml, createdAt: Date.now() });
    const previewUrl = `${req.protocol}://${req.get('host')}/preview/${id}`;
    res.json({ previewUrl, id });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// Serve previews
app.get('/preview/:id', (req, res) => {
  const { id } = req.params;
  const entry = previews.get(id);
  if (!entry) {
    return res.status(404).send(`
      <!DOCTYPE html>
      <html>
      <head><title>Preview Not Found</title></head>
      <body style="font-family: sans-serif; text-align: center; padding: 3rem;">
        <h2>🔍 Preview expired or does not exist</h2>
        <p>Previews are automatically removed after 60 minutes.</p>
        <p><a href="/">← Back to demo</a></p>
      </body>
      </html>
    `);
  }
  res.setHeader('Content-Type', 'text/html; charset=utf-8');
  res.setHeader('X-Content-Type-Options', 'nosniff');
  res.setHeader('Content-Security-Policy', "sandbox allow-same-origin allow-scripts allow-popups allow-forms");
  res.send(entry.html);
});

app.get('/health', (req, res) => {
  res.json({
    status: 'ok',
    activePreviews: previews.size,
    uptime: process.uptime(),
  });
});

app.listen(PORT, () => {
  console.log(`🚀 Enhanced Preview Engine running on port ${PORT}`);
  console.log(`   Supports: vanilla, react, vue, svelte, angular`);
  console.log(`   Multi‑file: send { "files": { ... } }`);
  console.log(`   Framework: send { "html": "...", "framework": "react" }`);
});