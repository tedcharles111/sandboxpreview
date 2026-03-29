const express = require('express');
const crypto = require('crypto');
const path = require('path');

const app = express();
const PORT = process.env.PORT || 3000;

// In-memory store
const previews = new Map();
const PREVIEW_TTL_MS = 60 * 60 * 1000; // 1 hour
const MAX_HTML_SIZE = 5 * 1024 * 1024;

app.use(express.json({ limit: '5mb' }));
app.use(express.static(path.join(__dirname, 'public')));

// Helper: generate ID
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
// ENHANCED PREVIEW API – supports frameworks
app.post('/api/preview', (req, res) => {
  try {
    let { html, framework = 'vanilla' } = req.body;
    if (typeof html !== 'string') {
      return res.status(400).json({ error: 'Missing "html" field' });
    }
    if (Buffer.byteLength(html, 'utf8') > MAX_HTML_SIZE) {
      html = html.slice(0, MAX_HTML_SIZE);
    }

    let finalHtml = html;
    // Framework-specific wrappers (client-side compilation)
    if (framework === 'react') {
      finalHtml = wrapReact(html);
    } else if (framework === 'vue') {
      finalHtml = wrapVue(html);
    } else if (framework === 'svelte') {
      finalHtml = wrapSvelte(html);
    } else if (framework === 'angular') {
      finalHtml = wrapAngular(html);
    } else {
      // vanilla: just use as is
      finalHtml = html;
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

// React wrapper: injects React, ReactDOM, Babel, and compiles JSX on the fly
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
    // User's React code:
    ${userCode}
    // If the user exports a default component or defines App, render it
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

// Vue wrapper: uses Vue 3 CDN with template compiler
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
    // User's Vue code (should define a Vue component or app)
    ${userCode}
    // Auto-mount if not already mounted
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

// Svelte wrapper: uses the Svelte compiler CDN (svelte/compiler) – experimental
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
    // Svelte component code from user:
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

// Angular wrapper: minimal starter with AngularJS or Angular? I'll use Angular (v16) with standalone component
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
    // User's Angular code (define a component)
    ${userCode}
    // Bootstrap if not already
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

// Serve previews
app.get('/preview/:id', (req, res) => {
  const { id } = req.params;
  const entry = previews.get(id);
  if (!entry) {
    return res.status(404).send(`<!DOCTYPE html><html><body><h2>Preview not found or expired</h2></body></html>`);
  }
  res.setHeader('Content-Type', 'text/html');
  res.send(entry.html);
});

app.get('/health', (req, res) => res.json({ status: 'ok' }));

app.listen(PORT, () => {
  console.log(`🚀 Enhanced Preview Engine running on port ${PORT}`);
  console.log(`   Supports: vanilla, react, vue, svelte, angular`);
});
