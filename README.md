# Contact Relay

Serverless contact form to Telegram relay running on Cloudflare Workers.

Forward contact form submissions from your website directly to Telegram chats — no servers required.

## Features

- **Zero infrastructure** — runs entirely on Cloudflare Workers (free tier available)
- **Multi-tenant** — route different domains to different Telegram chats/bots
- **Spam protection** — honeypot, time-to-submit check, rate limiting, idempotency
- **Admin API** — manage allowed origins dynamically via REST API
- **Turnstile support** — optional Cloudflare captcha integration
- **TypeScript + Hono** — modern, type-safe codebase

## Quick Start

### 1. Clone and install

```bash
git clone https://github.com/investblog/contact-relay.git
cd contact-relay
npm install
```

### 2. Run setup

```bash
npm run setup
```

The interactive setup will:
- Create KV namespaces (rate limiting, idempotency, config)
- Configure your Telegram bot token and chat ID
- Set up allowed origins and admin API key

### 3. Deploy

```bash
npm run deploy
```

### 4. Add your domain

```bash
curl -X POST https://contact-relay.YOUR_SUBDOMAIN.workers.dev/admin/origins \
  -H "X-Admin-Key: YOUR_ADMIN_KEY" \
  -H "Content-Type: application/json" \
  -d '{"pattern": "*.yourdomain.com"}'
```

### 5. Add the form to your website

See [examples/integration.md](examples/integration.md) for complete HTML/JS examples.

**Minimal example:**

```html
<form id="ContactForm">
  <input type="text" id="contact_name" placeholder="Name" required>
  <input type="email" id="contact_email" placeholder="Email">
  <textarea id="contact_message" placeholder="Message" required></textarea>
  <button type="submit">Send</button>
</form>

<script>
document.getElementById("ContactForm").addEventListener("submit", async (e) => {
  e.preventDefault();

  await fetch("https://contact-relay.YOUR_SUBDOMAIN.workers.dev/send", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      name: document.getElementById("contact_name").value,
      email: document.getElementById("contact_email").value,
      message: document.getElementById("contact_message").value
    })
  });
});
</script>
```

## API Endpoints

| Endpoint | Method | Description |
|----------|--------|-------------|
| `/send` | POST | Submit contact form |
| `/health` | GET | Health check |
| `/admin/origins` | GET | List allowed origins |
| `/admin/origins` | POST | Add origin pattern |
| `/admin/origins` | PUT | Replace all origins |
| `/admin/origins/:pattern` | DELETE | Remove origin |

Admin endpoints require `X-Admin-Key` header.

## Environment Variables

| Variable | Description |
|----------|-------------|
| `BOT_TOKEN` | Telegram bot token from @BotFather |
| `TG_DEFAULT_CHAT_ID` | Default Telegram chat/group ID |
| `ALLOWED_ORIGINS` | Comma-separated origin patterns |
| `ROUTING_JSON` | Per-domain bot/chat routing |
| `ADMIN_KEY` | Secret key for admin API |
| `RATE_LIMIT_PER_MIN` | Requests per IP per minute (default: 30) |
| `ENABLE_TURNSTILE` | Enable Cloudflare Turnstile |
| `TURNSTILE_SECRET` | Turnstile secret key |

## Multi-tenant Routing

Route different domains to different Telegram chats:

```json
{
  "site1.com": { "chat_id": "-1001234567890", "bot_token": "123:ABC" },
  "site2.com": { "chat_id": "-1009876543210" }
}
```

Set via `ROUTING_JSON` secret or during setup.

## Non-interactive Setup

For CI/CD or automated deployments, pass CLI flags to skip interactive prompts:

```bash
npm run setup -- \
  --bot-token=123456:ABC-DEF \
  --chat-id=-1001234567890 \
  --origins="example.com,*.example.com" \
  --admin-key=your-secret-admin-key
```

Optional flags: `--turnstile-secret=...`, `--routing-json='{"site.com":{"chat_id":"..."}}'`

If any required flag is missing, setup falls back to interactive mode.

## Development

```bash
npm run dev    # Start local dev server
npm run deploy # Deploy to Cloudflare
```

## Troubleshooting

### `origin_not_allowed`

`ALLOWED_ORIGINS` expects **hostnames**, not full URLs. The worker auto-strips protocols, but double-check your config:

```
301.st              ← correct
*.example.com       ← correct
https://301.st      ← also works (auto-converted)
```

The error response includes a `detail` field showing the received host and allowed patterns.

### `telegram_send_failed: group chat was upgraded to a supergroup`

When a Telegram group is upgraded to a supergroup, the chat ID changes. Get the new ID:

```bash
curl https://api.telegram.org/bot<TOKEN>/getUpdates | grep -o '"id":-[0-9]*'
```

Look for the `migrate_to_chat_id` field or the new supergroup chat ID (starts with `-100`). Update `TG_DEFAULT_CHAT_ID`:

```bash
echo "-100NEW_CHAT_ID" | wrangler secret put TG_DEFAULT_CHAT_ID
```

### Verifying config after deploy

```bash
curl https://your-worker.workers.dev/health
```

Returns config diagnostics (no secrets exposed):

```json
{
  "ok": true,
  "config": {
    "turnstile": true,
    "bot_configured": true,
    "origins_count": 3,
    "rate_limit_per_min": 30,
    "routing_configured": false
  }
}
```

## License

MIT
