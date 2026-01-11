# Integration Guide

## Quick Start

1. Deploy the worker: `npm run setup && npm run deploy`
2. Add your domain to allowed origins (see below)
3. Add the form and script to your website

## Configure Allowed Origins

Before your form will work, add your domain to the allowed origins list:

```bash
# Via Admin API
curl -X POST https://YOUR_WORKER.workers.dev/admin/origins \
  -H "X-Admin-Key: YOUR_ADMIN_KEY" \
  -H "Content-Type: application/json" \
  -d '{"pattern": "*.yourdomain.com"}'

# Or for exact domain
curl -X POST https://YOUR_WORKER.workers.dev/admin/origins \
  -H "X-Admin-Key: YOUR_ADMIN_KEY" \
  -H "Content-Type: application/json" \
  -d '{"pattern": "yourdomain.com"}'
```

Wildcard patterns:
- `*.example.com` — matches `sub.example.com`, `www.example.com`
- `example.com` — matches only `example.com`
- `*` — matches any origin (not recommended for production)

## HTML Form Example

```html
<form id="ContactForm">
  <input type="text" id="contact_name" placeholder="Name" required>
  <input type="email" id="contact_email" placeholder="Email">
  <input type="text" id="contact_telegram" placeholder="Telegram @username">
  <textarea id="contact_message" placeholder="Message" required></textarea>

  <!-- Honeypot field (hidden, leave empty) -->
  <input type="text" name="website" style="display:none" tabindex="-1" autocomplete="off">

  <button type="submit" id="submitBtn">Send</button>
</form>
```

## JavaScript Integration

```html
<script>
document.addEventListener("DOMContentLoaded", () => {
  const WORKER_URL = "https://YOUR_WORKER.workers.dev"; // <-- Replace with your worker URL

  const form = document.getElementById("ContactForm");
  const submitBtn = document.getElementById("submitBtn");
  const formLoadTime = Date.now();

  form.addEventListener("submit", async (e) => {
    e.preventDefault();

    // Simple antibot check
    const isHuman = () => {
      return (
        !navigator.webdriver &&
        typeof window.PointerEvent !== "undefined" &&
        typeof navigator.language === "string" &&
        typeof navigator.userAgent === "string"
      );
    };

    if (!isHuman()) {
      console.warn("Bot detected");
      return;
    }

    const name = document.getElementById("contact_name")?.value?.trim() || "";
    const email = document.getElementById("contact_email")?.value?.trim() || "";
    const telegram = document.getElementById("contact_telegram")?.value?.trim() || "";
    const message = document.getElementById("contact_message")?.value?.trim() || "";

    // Honeypot field
    const website = form.querySelector('[name="website"]')?.value || "";

    const payload = {
      name,
      email,
      telegram,
      message,
      website,
      ts: formLoadTime // Timestamp for time-to-submit check
    };

    try {
      submitBtn.disabled = true;
      submitBtn.textContent = "Sending...";

      const response = await fetch(`${WORKER_URL}/send`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload)
      });

      const result = await response.json();

      if (response.ok && result.status === "ok") {
        form.reset();
        submitBtn.textContent = "✔ Sent";
        setTimeout(() => { submitBtn.textContent = "Send"; }, 3000);
      } else {
        console.error("Error:", result.error);
        submitBtn.textContent = "Error";
        setTimeout(() => { submitBtn.textContent = "Send"; }, 3000);
      }
    } catch (err) {
      console.error("Send error:", err);
      submitBtn.textContent = "Failed";
      setTimeout(() => { submitBtn.textContent = "Send"; }, 3000);
    } finally {
      submitBtn.disabled = false;
    }
  });
});
</script>
```

## Spam Protection Features

The form includes several anti-spam measures:

| Feature | How it works |
|---------|--------------|
| **Honeypot** | Hidden `website` field — bots fill it, humans don't |
| **Time-to-submit** | `ts` timestamp — rejects forms submitted in < 800ms |
| **Client check** | `isHuman()` — detects headless browsers |
| **Rate limiting** | Server-side — 30 requests/min per IP |
| **Idempotency** | Prevents duplicate submissions within 5 minutes |

## Optional: Cloudflare Turnstile

For stronger protection, enable Turnstile captcha:

1. Get Turnstile keys from [Cloudflare Dashboard](https://dash.cloudflare.com/?to=/:account/turnstile)
2. Set `ENABLE_TURNSTILE=true` and `TURNSTILE_SECRET` during setup
3. Add Turnstile widget to your form:

```html
<script src="https://challenges.cloudflare.com/turnstile/v0/api.js" async defer></script>

<form id="ContactForm">
  <!-- ... form fields ... -->

  <div class="cf-turnstile" data-sitekey="YOUR_SITE_KEY"></div>

  <button type="submit" id="submitBtn">Send</button>
</form>
```

4. Include the token in your payload:

```javascript
const turnstileToken = document.querySelector('[name="cf-turnstile-response"]')?.value || "";

const payload = {
  // ... other fields
  cf_turnstile_response: turnstileToken
};
```

## Error Codes

| Error | Meaning |
|-------|---------|
| `origin_not_allowed` | Domain not in allowed origins list |
| `rate_limited` | Too many requests from this IP |
| `too_fast` | Form submitted too quickly (< 800ms) |
| `empty_payload` | No message and no contact info provided |
| `captcha_failed` | Turnstile verification failed |
| `telegram_send_failed` | Could not deliver to Telegram |
| `routing_not_configured` | No bot token/chat ID for this domain |
