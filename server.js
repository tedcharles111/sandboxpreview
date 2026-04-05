const express = require('express');
const crypto = require('crypto');
const cors = require('cors');
const { Sandbox } = require('@e2b/sdk');

const app = express();
const PORT = process.env.PORT || 3000;

// In‑memory store for sandbox URLs
const sandboxes = new Map();
const PREVIEW_TTL_MS = 60 * 60 * 1000;

app.use(cors());
app.use(express.json({ limit: '10mb' }));

function generateId() {
  return crypto.randomBytes(8).toString('hex');
}

// Cleanup expired sandboxes
setInterval(() => {
  const now = Date.now();
  for (const [id, entry] of sandboxes.entries()) {
    if (now - entry.createdAt > PREVIEW_TTL_MS) {
      // Optionally terminate the sandbox
      entry.sandbox?.close();
      sandboxes.delete(id);
    }
  }
}, 30 * 60 * 1000);

// API endpoint: create a sandbox and return preview URL
app.post('/api/preview', async (req, res) => {
  try {
    let { html, files } = req.body;
    if (typeof html === 'string') {
      files = { 'index.html': html };
    }
    if (!files || typeof files !== 'object') {
      return res.status(400).json({ error: 'Missing "html" or "files"' });
    }

    // Create a new E2B sandbox
    const sandbox = await Sandbox.create();
    
    // Write all files to the sandbox
    for (const [filePath, content] of Object.entries(files)) {
      await sandbox.files.write(filePath, content);
    }

    // Run npm install
    const installProc = await sandbox.process.exec('npm install');
    await installProc.wait();

    // Start dev server (assumes 'dev' script or fallback)
    const devProc = await sandbox.process.exec('npm run dev', {
      background: true,
      onStdout: (data) => console.log(data),
    });

    // Wait for server to be ready (E2B gives us a hostname)
    const url = sandbox.getHostname(5173); // default Vite port
    const id = generateId();
    sandboxes.set(id, { sandbox, url, createdAt: Date.now() });
    
    const previewUrl = `${req.protocol}://${req.get('host')}/preview/${id}`;
    res.json({ previewUrl, id });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: err.message });
  }
});

// Redirect to the actual sandbox URL
app.get('/preview/:id', (req, res) => {
  const { id } = req.params;
  const entry = sandboxes.get(id);
  if (!entry) {
    return res.status(404).send('Preview expired or not found');
  }
  res.redirect(entry.url);
});

app.get('/health', (req, res) => {
  res.json({ status: 'ok', activePreviews: sandboxes.size });
});

app.listen(PORT, () => {
  console.log(`🚀 E2B Sandbox Preview Engine running on port ${PORT}`);
  console.log(`   Real npm install, dev servers, full Node.js environment`);
});