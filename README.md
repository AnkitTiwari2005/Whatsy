# Whatsy

> A self-hosted WhatsApp notification API â€” one WhatsApp connection, clean REST API, multi-project API key auth.

## Table of Contents

1. [Quick Start](#quick-start)
2. [Initial WhatsApp Setup](#initial-whatsapp-setup)
3. [Adding a Project](#adding-a-project)
4. [Sending a Message (API Reference)](#sending-a-message-api-reference)
5. [Admin API Reference](#admin-api-reference)
6. [Failure Modes & Recovery](#failure-modes--recovery)
7. [Deployment on Hostinger](#deployment-on-hostinger)
8. [Environment Variables](#environment-variables)

---

## Quick Start

### Prerequisites

- Node.js >= 20
- A **dedicated** WhatsApp number (NOT your personal number â€” see [Failure Modes](#failure-modes--recovery))

### Local setup

```bash
cp .env.example .env
# Edit .env â€” set ADMIN_KEY at minimum
npm install
npm run build
npm start
```

The server starts on port 3000 (configurable via `PORT`).
Open `http://localhost:3000/admin/ui` to access the admin panel.

---

## Initial WhatsApp Setup

Whatsy uses **phone-number pairing** (not QR codes). One-time setup:

### Via Admin UI

1. Open `http://your-server/admin/ui`
2. Enter your `ADMIN_KEY`
3. In the **WhatsApp Connection** section, enter your dedicated phone number (digits only, with country code â€” e.g. `919876543210` for +91 98765 43210)
4. Click **Request Pairing Code**
5. A code like `ABCD-1234` appears
6. On your WhatsApp phone: **Settings -> Linked Devices -> Link a Device -> "Link with phone number instead"**
7. Enter the 8-character code
8. The status badge at the top turns **green** within ~10 seconds

### Via API

```bash
curl -X POST http://your-server/admin/pair \
  -H "X-Admin-Key: your-admin-key" \
  -H "Content-Type: application/json" \
  -d '{"phone_number": "919876543210"}'
```

Response:
```json
{
  "pairing_code": "ABCD-1234",
  "instructions": ["1. Open WhatsApp on your phone", ...]
}
```

---

## Adding a Project

Each project (website, app) gets its own API key and optional default recipient.

### Via Admin UI

Projects -> fill in Name, Default Recipient, optional Description -> **Add Project**

The raw API key is shown once â€” copy it immediately.

### Via API

```bash
curl -X POST http://your-server/admin/projects \
  -H "X-Admin-Key: your-admin-key" \
  -H "Content-Type: application/json" \
  -d '{
    "name": "my-shop",
    "description": "E-commerce alerts",
    "default_recipient": "+919876543210"
  }'
```

Response:
```json
{
  "id": 1,
  "name": "my-shop",
  "api_key": "AbCdEfGh...",
  "note": "Save this API key â€” it will not be shown again."
}
```

**The raw key is shown exactly once.** Store it in your calling project's environment variables.

---

## Sending a Message (API Reference)

### `POST /api/v1/messages`

**Headers:**
```
X-Api-Key: your-project-api-key
Content-Type: application/json
```

**Body:**
```json
{
  "message": "Order #1234 has shipped!",
  "recipient": "+919876543210"
}
```

`recipient` is optional if the project has a `default_recipient` configured.

**Responses:**

| Status | Meaning |
|--------|---------|
| `202 Accepted` | Message queued â€” will send as soon as WhatsApp is connected |
| `400 Bad Request` | Missing/invalid `message` or `recipient` |
| `401 Unauthorized` | Invalid or inactive API key |
| `429 Too Many Requests` | Rate limit exceeded |
| `503 Service Unavailable` | Message queue is full (WhatsApp likely disconnected) |

**Example (Node.js):**
```js
await fetch('https://your-server/api/v1/messages', {
  method: 'POST',
  headers: {
    'Content-Type': 'application/json',
    'X-Api-Key': process.env.WHATSY_API_KEY,
  },
  body: JSON.stringify({
    message: `New order #${order.id} from ${order.customer}`,
  }),
});
```

**Example (PHP):**
```php
$ch = curl_init('https://your-server/api/v1/messages');
curl_setopt_array($ch, [
  CURLOPT_POST => true,
  CURLOPT_HTTPHEADER => [
    'Content-Type: application/json',
    'X-Api-Key: ' . getenv('WHATSY_API_KEY'),
  ],
  CURLOPT_POSTFIELDS => json_encode(['message' => 'Alert: disk usage at 90%']),
  CURLOPT_RETURNTRANSFER => true,
]);
$response = curl_exec($ch);
```

---

## Admin API Reference

All admin endpoints require the `X-Admin-Key` header.

| Method | Path | Description |
|--------|------|-------------|
| `GET` | `/api/v1/status` | WhatsApp connection status (no auth) |
| `POST` | `/admin/pair` | Request WhatsApp pairing code |
| `GET` | `/admin/projects` | List all projects with key prefixes |
| `POST` | `/admin/projects` | Create project, get API key |
| `PATCH` | `/admin/projects/:id` | Update project (recipient, active state) |
| `POST` | `/admin/projects/:id/keys` | Add a new API key to a project |
| `DELETE` | `/admin/projects/:id/keys/:keyId` | Revoke an API key (immediate effect) |
| `GET` | `/admin/messages` | Message log (`?project=name&status=sent&limit=50`) |

---

## Failure Modes & Recovery

### WhatsApp disconnects mid-operation

**What happens:** Messages received during disconnection are held in an in-memory queue (up to `MAX_QUEUE_SIZE`, default 100). The server reconnects automatically with exponential backoff (1s -> 2s -> ... -> 5 minutes).

**You'll know it happened:** The admin UI status badge goes red/orange. The `/api/v1/status` endpoint returns `"whatsapp": "disconnected"`.

**Recovery:** Usually automatic within seconds. If it persists beyond a few minutes, check:
1. `pm2 logs whatsy` for connection error details
2. Is the phone with the linked account online and on a working network?
3. Did WhatsApp push an update that logged out linked devices?

### WhatsApp logged out (code 401)

**What happens:** WhatsApp explicitly revoked the session. This happens if:
- You manually removed the linked device from your phone
- The account was flagged (rare at this volume)
- Session files were corrupted

**Recovery:**
1. The server will log `"WhatsApp logged out (code 401). Session cleared."`
2. Call `POST /admin/pair` with your phone number to re-pair
3. No restart needed â€” the server handles this automatically

### Queue full (503)

**What happens:** More than `MAX_QUEUE_SIZE` messages arrived while disconnected.

**Recovery:** Once WhatsApp reconnects, new messages will start flowing again. The overflowed messages are marked `failed` in the log. Check `/admin/messages?status=failed` and resend manually if critical.

### Account flagged or banned

**Prevention (by design):**
- Messages are spaced 2-5 seconds apart with random jitter
- `markOnlineOnConnect: false` â€” the bot appears passive
- Low volume (a few hundred messages/month) is far below ban thresholds

**If it happens anyway:** Use a new dedicated phone number and re-pair. Your projects only need to update `WA_PHONE_NUMBER` in `.env` â€” the API layer is unaffected.

> **Never use your primary personal number.** If the bot number gets banned, you lose that number â€” not your main one.

### The Baileys library breaks (WhatsApp protocol change)

This happens occasionally when WhatsApp changes its Web API. The WhiskeySockets community typically patches it within a few days.

**Recovery:**
1. `npm update @whiskeysockets/baileys`
2. `npm run build`
3. `pm2 restart whatsy`

---

## Deployment on Hostinger

### Architecture: Whatsy as its own separate site

Whatsy is deployed as its **own standalone Node.js site in hPanel**, completely independent of shudhham.in.

**Why this matters:** shudhham.in uses Hostinger's versioned build system. Every shudhham.in redeploy wipes its versioned folder and swaps a symlink. Whatsy code placed inside shudhham.in's deploy tree would be silently destroyed on the next routine shudhham.in redeploy. They must be isolated.

**The layout:**

```
/home/u392157842/
+-- domains/
|   +-- shudhham.in/           <- your existing site (independent pipeline)
|   +-- whatsy.shudhham.in/    <- Whatsy's own site (independent pipeline)
|       +-- hbuilds/
|           +-- current -> versions/{latest-id}/
|           +-- versions/{id}/nodejs/   <- Whatsy code lives here
+-- whatsy_data/               <- PERSISTENT DATA (outside both pipelines)
    +-- auth_state/
    +-- whatsy.db
    +-- connection.log
```

### Steps

1. **Create Whatsy's site in hPanel:**
   - hPanel -> Websites -> Add New Website
   - Subdomain: `whatsy.shudhham.in` (or any name)
   - Type: Node.js
   - This creates an isolated deploy pipeline that shudhham.in never touches

2. **Create the persistent data directory** (one-time, via SSH):
   ```bash
   ssh u392157842@82.112.229.41 -p 65002
   mkdir -p ~/whatsy_data
   ```

3. **Set environment variables** in hPanel -> whatsy.shudhham.in -> Node.js -> Environment Variables:
   ```
   NODE_ENV=production
   PORT=3000
   ADMIN_KEY=your-long-random-key
   DATA_DIR=/home/u392157842/whatsy_data
   MESSAGE_DELAY_MIN_MS=2000
   MESSAGE_DELAY_MAX_MS=5000
   ```

4. **Build locally and deploy** to Whatsy's own versioned folder:
   ```bash
   npm run build
   # Upload dist/, node_modules/, package.json, pm2.config.js via SFTP to:
   # ~/domains/whatsy.shudhham.in/hbuilds/versions/{current-id}/nodejs/
   ```

5. **Start with PM2** (via SSH):
   ```bash
   cd ~/domains/whatsy.shudhham.in/hbuilds/versions/$(ls -t ~/domains/whatsy.shudhham.in/hbuilds/versions | head -1)/nodejs
   pm2 start pm2.config.js
   pm2 save
   pm2 startup   # follow the printed instructions
   ```

6. **First run:** Call `POST /admin/pair` to link your WhatsApp number.

### Redeploy workflow

`~/whatsy_data/` is never touched by redeployment of either site.

```bash
npm run build
# Upload only dist/ via SFTP (it's the only thing that changes)
pm2 restart whatsy
```
## Environment Variables

| Variable | Default | Description |
|----------|---------|-------------|
| `PORT` | `3000` | HTTP port |
| `ADMIN_KEY` | **required** | Secret key for all `/admin/*` endpoints |
| `DATA_DIR` | `./data` | Persistent data directory. On Hostinger: `/home/u392157842/whatsy_data` |
| `WA_PHONE_NUMBER` | `""` | Your WhatsApp number for pairing (optional â€” can also be passed to `/admin/pair`) |
| `MESSAGE_DELAY_MIN_MS` | `2000` | Minimum jitter delay between messages |
| `MESSAGE_DELAY_MAX_MS` | `5000` | Maximum jitter delay between messages |
| `MAX_QUEUE_SIZE` | `100` | Max messages held in memory while disconnected |
| `REDACT_BODIES` | `false` | Set `true` to omit message text from the log table |
| `LOG_LEVEL` | `info` | `debug` / `info` / `warn` / `error` |
