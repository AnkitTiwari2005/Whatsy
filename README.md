# Whatsy

A self-hosted WhatsApp notification gateway. Send WhatsApp messages from any app via a simple REST API.

**Live at:** `https://honeydew-butterfly-241889.hostingersite.com`

---

## What it does

Whatsy runs on your server, holds a single WhatsApp connection, and exposes a REST API so your apps can send WhatsApp messages with a one-liner HTTP call.

```
Your app  -->  POST /api/v1/messages  -->  WhatsApp
              (API key auth)
```

---

## Stack

- **Runtime:** Node.js 20 (TypeScript, compiled to `dist/`)
- **WhatsApp:** Baileys v7 — phone-number pairing, no QR code
- **Database:** SQLite (`better-sqlite3`) — WAL mode, persistent at `~/whatsy_data/`
- **Auth:** bcrypt-hashed API keys (project-scoped) + separate admin key
- **Admin UI:** Single-page HTML at `/admin/ui` — login screen, sidebar nav, custom modals

---

## API

### Send a message
```bash
curl -X POST https://your-server/api/v1/messages \
  -H "X-Api-Key: YOUR_PROJECT_API_KEY" \
  -H "Content-Type: application/json" \
  -d '{"message": "Order #1234 received!", "recipient": "+91XXXXXXXXXX"}'
```

Response: `{"id":1,"status":"queued","project":"my-shop","recipient":"+91XXXXXXXXXX"}`

### Check status
```bash
curl https://your-server/api/v1/status
# {"whatsapp":"connected","uptime_seconds":3600,"queue_length":0}
```

### From Node.js
```js
await fetch(`${process.env.WHATSY_URL}/api/v1/messages`, {
  method: 'POST',
  headers: { 'Content-Type': 'application/json', 'X-Api-Key': process.env.WHATSY_API_KEY },
  body: JSON.stringify({ message: `Order #${order.id} shipped` }),
});
```

### From PHP
```php
$ch = curl_init(getenv('WHATSY_URL') . '/api/v1/messages');
curl_setopt_array($ch, [
  CURLOPT_POST           => true,
  CURLOPT_HTTPHEADER     => ['Content-Type: application/json', 'X-Api-Key: ' . getenv('WHATSY_API_KEY')],
  CURLOPT_POSTFIELDS     => json_encode(['message' => "New order #{$order->id}"]),
  CURLOPT_RETURNTRANSFER => true,
]);
curl_exec($ch);
```

---

## Self-hosting

### Requirements
- Node.js 20+
- A dedicated WhatsApp phone number (do not use your personal number)

### Environment variables
```env
NODE_ENV=production
PORT=3000
ADMIN_KEY=<random 32-byte base64url string>
DATA_DIR=/absolute/path/to/whatsy_data
MESSAGE_DELAY_MIN_MS=2000
MESSAGE_DELAY_MAX_MS=5000
LOG_LEVEL=info
```

Generate a key: `node -e "console.log(require('crypto').randomBytes(32).toString('base64url'))"`

### Local development
```bash
npm install
cp .env.example .env   # fill in values
npm run build:local    # tsc + copy static assets
node dist/index.js
```

### Deploy (Hostinger / any Node.js host)
1. Connect this repo to your host's Git integration
2. Set the environment variables above
3. Entry point: `dist/index.js` | Build command: `echo skip` (dist is pre-committed)
4. SSH in and create the data directory: `mkdir -p /path/to/whatsy_data`
5. Deploy — server starts and logs `Whatsy listening on port 3000`

### Pair WhatsApp (after first deploy)
```bash
curl -X POST https://your-server/admin/pair \
  -H "X-Admin-Key: YOUR_ADMIN_KEY" \
  -H "Content-Type: application/json" \
  -d '{"phone_number": "91XXXXXXXXXX"}'
```
Enter the returned 8-char code in WhatsApp: **Settings → Linked Devices → Link a Device → Link with phone number instead**

---

## Admin UI

Visit `/admin/ui` — login with your `ADMIN_KEY`.

- **Overview** — WhatsApp status, queue, uptime, recent message timeline, quick send test
- **Pair WhatsApp** — step-by-step pairing with code display
- **Projects** — create/manage projects, generate/revoke API keys
- **Message Logs** — filterable history of all messages sent

---

## Architecture notes

- One WhatsApp connection per server (shared across all projects)
- Messages are queued in SQLite and drained with 2–5 s jitter to avoid rate limiting
- Persistent data (`auth_state/`, `whatsy.db`, `connection.log`) lives outside the deploy tree — survives all redeployments
- `dist/` is committed so the server never needs TypeScript installed
- No PM2 needed — Hostinger's Node.js runner manages the process

---

## License

MIT