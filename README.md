# showLandPaging

A Proof-of-Concept that measures the full end-to-end latency of the [RB2B](https://rb2b.com) identity resolution tool and dynamically updates the UI with personalised HTML content based on the identified visitor.

---

## What it does

1. A visitor lands on the page — a high-resolution timer starts instantly (`performance.now()`).
2. The RB2B script runs in the background and identifies the visitor by their **LinkedIn profile URL**.
3. RB2B fires a webhook to the Node.js backend with the LinkedIn URL.
4. The backend calls a **Cloudflare Worker** which:
   - Looks up the LinkedIn URL in a **KV namespace** to get a filename.
   - Fetches the corresponding HTML file from an **R2 bucket**.
   - Returns the raw HTML to the backend.
5. The backend pushes the HTML to the exact browser tab via **WebSocket (Socket.io)**.
6. The frontend renders the personalised HTML and displays two latency metrics:
   - **Total Time since Page Load** — navigation start → HTML received.
   - **Data Retrieval (Worker + KV + R2)** — Node.js fetch start → Cloudflare Worker response.

---

## Architecture

```
Browser
  │
  │  performance.now() timer starts
  │
  ├─── Socket.io (WebSocket) ──────────────────────────────────────┐
  │     register_session(SESSION_ID)                               │
  │                                                                │
  │  RB2B script identifies visitor                                │
  │     └─► POST /webhook/rb2b                                     │
  │           { linkedinUrl, sessionId }                           │
  │                                                                │
  │         Node.js / Express                                      │
  │           └─► POST Cloudflare Worker URL                       │
  │                 { linkedinUrl }                                 │
  │                                                                │
  │                 Cloudflare Worker                              │
  │                   ├─► KV.get(linkedinUrl) → filename.html      │
  │                   └─► R2.get(filename)    → raw HTML           │
  │                                                                │
  │         resolutionLatency measured here                        │
  │           └─► pushToSession(sessionId, { html,                 │
  │                 linkedinUrl, resolutionLatency })               │
  │                                                                │
  └──────────────── html_resolved event ──────────────────────────┘
        { html, linkedinUrl, resolutionLatency }
        → inject HTML, stop both timers, display latency
```

---

## Project structure

```
showLandPaging/
├── app.js                     # Express entry point
├── config/
│   └── config.js              # Port, log level, Cloudflare Worker URL
├── services/
│   ├── logger.js              # Winston JSON structured logger
│   └── socket.js              # Socket.io: session map + pushToSession()
├── routes/
│   ├── webhook.js             # POST /webhook/rb2b + POST /webhook/mock/simulate
│   └── localWorker.js         # Local mock of the Cloudflare Worker (dev only)
├── public/
│   └── index.html             # Frontend: timer, dual stopwatches, simulate UI
├── cloudflare/
│   ├── worker.js              # Cloudflare Worker source (deploy with wrangler)
│   └── wrangler.toml          # Wrangler config: KV + R2 bindings
├── dummy-html/                # Personalised HTML snippets (one per LinkedIn profile)
│   ├── alice.html
│   ├── bob.html
│   ├── charlie.html
│   ├── diana.html
│   └── eve.html
└── scripts/
    └── seed-data.js           # Prints wrangler commands to seed KV + R2
```

---

## Local development (no Cloudflare account needed)

### 1. Install dependencies

```bash
npm install
```

### 2. Start the server

```bash
npm run start-dev     # nodemon — auto-restarts on file changes
# or
npm start
```

### 3. Open the app

```
http://localhost:3000
```

### 4. Simulate an RB2B webhook

Click **Copy** next to any LinkedIn URL in the reference table, paste it into the input field, and click **Simulate**.

The server adds a **2500ms artificial delay** (matching the average real-world RB2B identification time), then executes the full local Worker flow (KV map lookup → dummy-html file read → WebSocket push).

You will see:
- Status banner turns amber → "Waiting for RB2B identification…"
- After ~2.5s: personalised HTML appears with both latency metrics.

#### Available test LinkedIn URLs

| LinkedIn URL | HTML file |
|---|---|
| `https://linkedin.com/in/alice` | alice.html |
| `https://linkedin.com/in/bob` | bob.html |
| `https://linkedin.com/in/charlie` | charlie.html |
| `https://linkedin.com/in/diana` | diana.html |
| `https://linkedin.com/in/eve` | eve.html |

---

## RB2B integration (current state)

Right now the RB2B webhook is **simulated** — clicking Simulate in the UI fires an internal endpoint that replicates what RB2B would send.

For production integration:

1. **Install the RB2B pixel** on your site (copy-paste the script snippet they provide).
2. **Configure the webhook URL** in the RB2B dashboard to point to your deployed server:
   ```
   POST https://your-domain.com/webhook/rb2b
   ```
3. **Include the sessionId** — the RB2B script must pass the browser's session ID so the backend can route the result to the correct tab. Two options:
   - **Client-side callback**: RB2B fires a JS callback when it identifies the visitor. In that callback, call your backend directly:
     ```js
     // Inside the RB2B callback (replace with real RB2B API):
     fetch('/webhook/rb2b', {
       method: 'POST',
       headers: { 'Content-Type': 'application/json' },
       body: JSON.stringify({ linkedinUrl: identifiedUrl, sessionId: SESSION_ID }),
     });
     ```
     `SESSION_ID` is already defined in `public/index.html` — just expose it to the RB2B callback scope.
   - **Server-to-server webhook**: Configure RB2B to append `?sessionId=SESSION_ID` as a custom URL parameter (some plans support custom webhook fields).

---

## Cloudflare setup (production)

### Prerequisites

- A Cloudflare account with Workers, KV, and R2 enabled.
- [Wrangler CLI](https://developers.cloudflare.com/workers/wrangler/) installed: `npm install -g wrangler`

### Step 1 — Create KV namespace

```bash
cd cloudflare/
wrangler kv namespace create LINKEDIN_MAPPING_KV
```

Copy the returned `id` into `cloudflare/wrangler.toml`:
```toml
[[kv_namespaces]]
binding = "LINKEDIN_MAPPING_KV"
id      = "PASTE_YOUR_ID_HERE"
```

### Step 2 — Create R2 bucket

```bash
wrangler r2 bucket create html-assets
```

### Step 3 — Seed KV + R2 with your data

```bash
# From the project root — prints all wrangler commands:
node scripts/seed-data.js

# Then run each command to upload HTML files to R2 and write mappings to KV.
# Example for one entry:
wrangler r2 object put html-assets/alice.html --file ./dummy-html/alice.html
wrangler kv key put --binding=LINKEDIN_MAPPING_KV "https://linkedin.com/in/alice" "alice.html"
```

Add your own entries following the same pattern:
- Upload the personalised HTML file to R2.
- Write the LinkedIn URL → filename mapping to KV.

### Step 4 — Deploy the Worker

```bash
cd cloudflare/
wrangler deploy
```

Wrangler will print the Worker URL, e.g.:
```
https://show-land-paging-worker.your-subdomain.workers.dev
```

### Step 5 — Point the backend at the real Worker

Set the environment variable on your Node.js server:

```bash
CLOUDFLARE_WORKER_URL=https://show-land-paging-worker.your-subdomain.workers.dev node app.js
```

Or add it to a `.env` file (never commit this):
```
CLOUDFLARE_WORKER_URL=https://show-land-paging-worker.your-subdomain.workers.dev
```

The local mock route (`/internal/worker`) is never called once `CLOUDFLARE_WORKER_URL` is set.

---

## Environment variables

| Variable | Default | Description |
|---|---|---|
| `PORT` | `3000` | Port the Express server listens on |
| `LOG_LEVEL` | `debug` | Winston log level (`debug`, `info`, `warn`, `error`) |
| `CLOUDFLARE_WORKER_URL` | `http://localhost:3000/internal/worker` | Cloudflare Worker URL — set to the real URL in production |

---

## API reference

### `POST /webhook/rb2b`
Real RB2B webhook endpoint. Called by RB2B once a visitor is identified.

**Body:** `{ linkedinUrl: string, sessionId: string }`
**Response:** `200 { ok: true }` or `400 / 404 / 502` with `{ error: string }`

---

### `POST /webhook/mock/simulate`
Local testing endpoint. Adds a 2500ms artificial delay, then runs the full Worker flow.

**Body:** `{ linkedinUrl: string, sessionId: string }`
**Response:** `200 { ok: true, message: string }` immediately — result arrives via WebSocket.

---

### `POST /internal/worker`
Local mock of the Cloudflare Worker. Used automatically in development when `CLOUDFLARE_WORKER_URL` is not set.

**Body:** `{ linkedinUrl: string }`
**Response:** raw HTML `200` or `{ error: string }` with `400 / 404`

---

### WebSocket event: `html_resolved`
Emitted to the client's socket when identity resolution completes.

**Payload:**
```json
{
  "html": "<div>…personalised HTML…</div>",
  "linkedinUrl": "https://linkedin.com/in/alice",
  "resolutionLatency": 42.5
}
```

| Field | Type | Description |
|---|---|---|
| `html` | string | Raw HTML fetched from R2 |
| `linkedinUrl` | string | The identified visitor's LinkedIn URL |
| `resolutionLatency` | number | Milliseconds from Node.js fetch start to Cloudflare Worker response |

---

## Tech stack

| Layer | Technology |
|---|---|
| Backend | Node.js, Express |
| Real-time push | Socket.io (WebSocket) |
| Logging | Winston (JSON structured) |
| Edge compute | Cloudflare Workers |
| Key-value store | Cloudflare KV |
| Object storage | Cloudflare R2 |
| Frontend | HTML, Vanilla JS (`performance.now()`) |
| Identity resolution | RB2B |
