# Sandbox Preview Engine

A lightweight, standalone API that instantly renders user‑generated HTML/CSS/JS in a sandboxed environment.  
Perfect for AI web app builders, code generators, or any tool that needs to preview dynamic content.

## ✨ Features

- **Instant previews** – Returns a unique URL that serves the user’s code.
- **Forgiving** – Even broken syntax renders whatever the browser can salvage.
- **No external services** – Self‑contained Node.js + Express.
- **Memory‑safe** – Auto‑cleanup of old previews (TTL 60 min).
- **Free‑tier friendly** – Works on Render, Railway, Fly.io, and any Node.js host.

## 🚀 Quick Start

### Local Development

```bash
git clone https://github.com/yourname/preview-engine.git
cd preview-engine
npm install
npm start
Open http://localhost:3000 to see the interactive demo.

Deploy to Render (Free)
Push this repository to GitHub.

Log in to Render and click New + → Web Service.

Connect your repo, set:

Environment: Node

Build Command: npm install

Start Command: node server.js

Click Create Web Service – done!

The service will be available at https://your-app.onrender.com.

📡 API Reference
POST /api/preview
Creates a new preview from raw HTML.

Request body (JSON):

json
{
  "html": "<!DOCTYPE html><html>...</html>"
}
Response:

json
{
  "previewUrl": "https://your-app.onrender.com/preview/abc123",
  "id": "abc123"
}
GET /preview/:id
Returns the raw HTML (with sandbox CSP headers).
If the preview expired (after 60 min) or never existed, a friendly 404 page is shown.

GET /health
Health check endpoint – returns number of active previews and uptime.

🧪 Example Usage
bash
curl -X POST https://your-app.onrender.com/api/preview \
  -H "Content-Type: application/json" \
  -d '{"html":"<h1>Hello, world!</h1>"}'
The response will contain a previewUrl you can embed in an iframe or share.

⚙️ Configuration
Environment Variable	Description	Default
PORT	Listening port	3000
🛡️ Security & Sandboxing
The server applies a Content-Security-Policy: sandbox header, restricting the preview to a sandboxed environment while still allowing scripts and forms.

Previews are isolated by origin (each preview URL is unique).

Maximum HTML size is 5 MB; larger content is truncated.

📝 License
MIT – Free for any use.

text

---

## ✅ How to Deploy on Free Platforms

### Render (easiest)
1. Push this repo to GitHub.
2. On Render, create a **Web Service**, connect your repo.
3. Use the following settings:
   - **Environment**: Node
   - **Build Command**: `npm install`
   - **Start Command**: `node server.js`
   - **Free plan** – no costs.
4. Click **Create Web Service**. Your app is live in minutes.

### Railway
1. Push to GitHub, then on Railway click **New Project** → **Deploy from GitHub repo**.
2. It will auto‑detect Node.js and start.
3. Add a `PORT` variable if needed (Railway sets it automatically).

### pxxl.app (or any other)
- Copy the entire folder to the service, run `npm install && node server.js`.

---

## 🔧 Notes on Reliability & Free Tier Limits

- **Memory**: Previews are stored in memory and expire after 60 minutes. This keeps RAM usage low.
- **CPU**: The server is single‑threaded but extremely lightweight. It can handle many concurrent requests on free tiers.
- **Errors**: If the user’s HTML is malformed, the browser still attempts to render it – the engine never fails.
- **Uptime**: Free services may idle after inactivity, but the engine will restart on next request. The health endpoint helps monitoring.

---

## 📦 Complete Files (Copy & Paste)

Now you have every file needed. Simply create a folder, copy the contents above into their respective files, and deploy.

**Important**: The `public/index.html` should be the exact HTML you initially provided. Save it as `public/index.html` and it will work seamlessly with the server.

If you prefer, you can also embed the demo UI directly in the root route (instead of static), but the static approach is cleaner.

---

## 🎉 You're Done!

Your AI web app builder can now call `POST /api/preview` with any HTML snippet and instantly receive a preview URL that never crashes, even when the code is broken. This engine is open source, free to host, and designed for maximum reliability.

Enjoy building!
