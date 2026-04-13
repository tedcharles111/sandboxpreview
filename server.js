const express = require('express');
const crypto = require('crypto');
const fs = require('fs').promises;
const path = require('path');
const cors = require('cors');
const esbuild = require('esbuild');

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
      await fs.rm(data.dir, { recursive: true, force: true });
      sandboxes.delete(id);
    }
  }
}, 30 * 60 * 1000);

// Map of common packages to CDN URLs
const cdnMap = {
  'react': 'https://esm.sh/react',
  'react-dom': 'https://esm.sh/react-dom',
  'framer-motion': 'https://esm.sh/framer-motion',
  'lucide-react': 'https://esm.sh/lucide-react',
  'zustand': 'https://esm.sh/zustand',
  'clsx': 'https://esm.sh/clsx',
  'tailwind-merge': 'https://esm.sh/tailwind-merge',
};

// Plugin to resolve bare imports to CDN (external)
const cdnPlugin = {
  name: 'cdn',
  setup(build) {
    build.onResolve({ filter: /^[^./]/ }, args => {
      if (cdnMap[args.path]) {
        return { path: cdnMap[args.path], external: true };
      }
      return { path: `https://esm.sh/${args.path}`, external: true };
    });
  },
};

async function bundleProject(dir) {
  // Find entry point
  let entry = null;
  const candidates = ['src/main.jsx', 'src/index.jsx', 'src/main.js', 'src/index.js', 'index.js', 'main.jsx', 'src/App.jsx'];
  for (const cand of candidates) {
    try {
      await fs.access(path.join(dir, cand));
      entry = cand;
      break;
    } catch {}
  }
  if (!entry) throw new Error('No entry point found');

  // Read index.html
  let html = '';
  const indexPath = path.join(dir, 'index.html');
  try {
    html = await fs.readFile(indexPath, 'utf8');
  } catch {
    html = '<!DOCTYPE html><html><head><meta charset="UTF-8"><title>Preview</title></head><body><div id="root"></div></body></html>';
  }

  // Bundle with esbuild (external CDNs)
  const bundleResult = await esbuild.build({
    entryPoints: [path.join(dir, entry)],
    bundle: true,
    write: false,
    format: 'iife',
    globalName: 'App',
    platform: 'browser',
    plugins: [cdnPlugin],
    loader: { '.js': 'jsx', '.jsx': 'jsx', '.ts': 'tsx', '.tsx': 'tsx', '.css': 'css' },
    define: { 'process.env.NODE_ENV': '"production"' },
  });

  let bundledCode = '';
  let cssCode = '';
  const externals = new Set(); // collect external packages for script injection
  for (const file of bundleResult.outputFiles) {
    if (file.path.endsWith('.js')) bundledCode = file.text;
    if (file.path.endsWith('.css')) cssCode = file.text;
    // Extract external URLs from the bundle (they appear as comments or need parsing)
    // Simpler: we'll just inject all known CDNs if the code references them.
  }

  // Collect all CSS files from the project (including those not imported)
  const cssFiles = [];
  async function collectCSS(currentDir) {
    const items = await fs.readdir(currentDir, { withFileTypes: true });
    for (const item of items) {
      const fullPath = path.join(currentDir, item.name);
      if (item.isDirectory()) await collectCSS(fullPath);
      else if (item.name.endsWith('.css') && !fullPath.includes('node_modules')) {
        const content = await fs.readFile(fullPath, 'utf8');
        cssFiles.push(content);
      }
    }
  }
  await collectCSS(dir);
  const allCSS = cssCode + cssFiles.join('\n');

  // Inject CSS
  if (allCSS) {
    const styleTag = `<style>${allCSS}</style>`;
    if (html.includes('</head>')) {
      html = html.replace('</head>', `${styleTag}</head>`);
    } else {
      html = html.replace('<body', `<head>${styleTag}</head><body`);
    }
  }

  // Inject external script tags for common packages (detected from code)
  const usedPackages = [];
  if (bundledCode.includes('framer-motion')) usedPackages.push('framer-motion');
  if (bundledCode.includes('lucide-react')) usedPackages.push('lucide-react');
  if (bundledCode.includes('zustand')) usedPackages.push('zustand');
  if (bundledCode.includes('clsx')) usedPackages.push('clsx');
  if (bundledCode.includes('tailwind-merge')) usedPackages.push('tailwind-merge');
  if (bundledCode.includes('react-dom')) usedPackages.push('react-dom');
  if (bundledCode.includes('react')) usedPackages.push('react');

  let scriptTags = '';
  for (const pkg of usedPackages) {
    if (cdnMap[pkg]) {
      scriptTags += `<script type="module">import "${cdnMap[pkg]}";</script>`;
    }
  }

  if (scriptTags) {
    if (html.includes('</head>')) {
      html = html.replace('</head>', `${scriptTags}</head>`);
    } else {
      html = html.replace('<body', `<head>${scriptTags}</head><body`);
    }
  }

  // Inject bundled code
  if (bundledCode) {
    const scriptTag = `<script>${bundledCode}</script>`;
    if (html.includes('</body>')) {
      html = html.replace('</body>', `${scriptTag}</body>`);
    } else {
      html += scriptTag;
    }
  }

  // Ensure root div exists
  if (!html.includes('<div id="root"></div>') && !html.includes('<div id="root"')) {
    html = html.replace('<body>', '<body><div id="root"></div>');
  }

  return html;
}

app.post('/api/preview', async (req, res) => {
  try {
    let { html, files } = req.body;
    if (typeof html === 'string') {
      files = { 'index.html': html };
    }
    if (!files || typeof files !== 'object') {
      return res.status(400).json({ error: 'Missing "html" or "files"' });
    }

    const id = generateId();
    const dir = path.join('/tmp', id);
    await fs.mkdir(dir, { recursive: true });

    for (const [filePath, content] of Object.entries(files)) {
      if (filePath === 'package.json') continue;
      const fullPath = path.join(dir, filePath);
      await fs.mkdir(path.dirname(fullPath), { recursive: true });
      await fs.writeFile(fullPath, content);
    }

    let finalHtml;
    try {
      finalHtml = await bundleProject(dir);
    } catch (err) {
      console.error('Bundling error:', err);
      const indexPath = path.join(dir, 'index.html');
      finalHtml = await fs.readFile(indexPath, 'utf8');
    }

    sandboxes.set(id, { dir, html: finalHtml, createdAt: Date.now() });
    const previewUrl = `${req.protocol}://${req.get('host')}/preview/${id}`;
    res.json({ previewUrl, id });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: err.message });
  }
});

app.get('/preview/:id/*', async (req, res) => {
  const { id } = req.params;
  const entry = sandboxes.get(id);
  if (!entry) {
    return res.status(404).send('Preview not found');
  }
  const filePath = path.join(entry.dir, req.params[0]);
  try {
    await fs.access(filePath);
    res.sendFile(filePath);
  } catch {
    res.status(404).send('File not found');
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
  console.log(`🚀 Bundling Sandbox Preview Engine running on port ${PORT}`);
});
