# Integration Guide

## Quick Start

1. Deploy the worker: `npm run setup && npm run deploy`
2. Add your domain to allowed origins (see below)
3. Add the form and script to your website
4. (Optional) Configure Cloudflare Turnstile for captcha protection

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
<!-- Turnstile script (load once, before form) -->
<script src="https://challenges.cloudflare.com/turnstile/v0/api.js" async defer></script>

<form id="ContactForm">
  <input type="text" id="contact_name" placeholder="Name" required>
  <input type="email" id="contact_email" placeholder="Email">
  <input type="text" id="contact_telegram" placeholder="Telegram @username">
  <textarea id="contact_message" placeholder="Message" required></textarea>

  <!-- Honeypot field (hidden, leave empty) -->
  <input type="text" name="website" style="display:none" tabindex="-1" autocomplete="off">

  <!-- Turnstile captcha widget (optional) -->
  <div id="turnstile-container"></div>

  <!-- Error message display -->
  <div id="form-error" style="color: #dc3545; display: none;"></div>

  <button type="submit" id="submitBtn">Send</button>
</form>
```

## JavaScript Integration

```html
<script>
document.addEventListener("DOMContentLoaded", () => {
  // ============ CONFIGURATION ============
  const CONFIG = {
    // Worker URL (required)
    workerUrl: "https://YOUR_WORKER.workers.dev",

    // Turnstile settings (optional - leave siteKey empty to disable)
    turnstile: {
      siteKey: "",                // Your Turnstile site key (leave empty to disable captcha)
      theme: "auto",              // "light" | "dark" | "auto"
      mode: "managed",            // "managed" | "invisible" | "non-interactive"
      size: "normal",             // "normal" | "compact"
    },

    // UI text
    messages: {
      sending: "Sending...",
      success: "✔ Sent",
      error: "Error",
      failed: "Failed",
      defaultBtn: "Send",
      resetDelay: 3000,           // ms before button resets
    },

    // Error messages
    errors: {
      origin_not_allowed: "This domain is not authorized",
      rate_limited: "Too many requests. Please wait a moment",
      too_fast: "Please wait before submitting",
      empty_payload: "Please fill in the required fields",
      captcha_failed: "Captcha verification failed. Please try again",
      telegram_send_failed: "Failed to send message. Please try again",
      routing_not_configured: "Service configuration error",
      network_error: "Connection error. Check your internet",
      bot_detected: "Submission blocked",
    }
  };
  // ========================================

  const form = document.getElementById("ContactForm");
  const submitBtn = document.getElementById("submitBtn");
  const errorDiv = document.getElementById("form-error");
  const turnstileContainer = document.getElementById("turnstile-container");
  const formLoadTime = Date.now();

  let turnstileWidgetId = null;

  // Initialize Turnstile if configured
  function initTurnstile() {
    if (!CONFIG.turnstile.siteKey || !window.turnstile) return;

    const renderOptions = {
      sitekey: CONFIG.turnstile.siteKey,
      theme: CONFIG.turnstile.theme,
      size: CONFIG.turnstile.size,
      callback: () => hideError(),
      "error-callback": () => showError(CONFIG.errors.captcha_failed),
    };

    // For invisible mode, add execution option
    if (CONFIG.turnstile.mode === "invisible") {
      renderOptions.execution = "execute";
    }

    turnstileWidgetId = turnstile.render(turnstileContainer, renderOptions);
  }

  // Show error message
  function showError(message) {
    errorDiv.textContent = message;
    errorDiv.style.display = "block";
  }

  // Hide error message
  function hideError() {
    errorDiv.style.display = "none";
  }

  // Get error message from response
  function getErrorMessage(errorCode) {
    return CONFIG.errors[errorCode] || `Error: ${errorCode}`;
  }

  // Reset button after delay
  function resetButton() {
    setTimeout(() => {
      submitBtn.textContent = CONFIG.messages.defaultBtn;
    }, CONFIG.messages.resetDelay);
  }

  // Simple antibot check
  function isHuman() {
    return (
      !navigator.webdriver &&
      typeof window.PointerEvent !== "undefined" &&
      typeof navigator.language === "string" &&
      typeof navigator.userAgent === "string"
    );
  }

  // Get Turnstile token
  async function getTurnstileToken() {
    if (!CONFIG.turnstile.siteKey || !window.turnstile) return "";

    // For invisible mode, trigger execution
    if (CONFIG.turnstile.mode === "invisible" && turnstileWidgetId !== null) {
      turnstile.execute(turnstileContainer);
      // Wait for token
      await new Promise(resolve => setTimeout(resolve, 500));
    }

    return turnstile.getResponse(turnstileWidgetId) || "";
  }

  // Reset Turnstile widget
  function resetTurnstile() {
    if (turnstileWidgetId !== null && window.turnstile) {
      turnstile.reset(turnstileWidgetId);
    }
  }

  // Form submit handler
  form.addEventListener("submit", async (e) => {
    e.preventDefault();
    hideError();

    // Antibot check
    if (!isHuman()) {
      showError(CONFIG.errors.bot_detected);
      return;
    }

    // Collect form data
    const name = document.getElementById("contact_name")?.value?.trim() || "";
    const email = document.getElementById("contact_email")?.value?.trim() || "";
    const telegram = document.getElementById("contact_telegram")?.value?.trim() || "";
    const message = document.getElementById("contact_message")?.value?.trim() || "";
    const website = form.querySelector('[name="website"]')?.value || "";

    // Get captcha token
    const turnstileToken = await getTurnstileToken();

    // Check if captcha is required but not completed
    if (CONFIG.turnstile.siteKey && !turnstileToken && CONFIG.turnstile.mode !== "invisible") {
      showError("Please complete the captcha");
      return;
    }

    const payload = {
      name,
      email,
      telegram,
      message,
      website,
      ts: formLoadTime,
      cf_turnstile_response: turnstileToken,
    };

    try {
      submitBtn.disabled = true;
      submitBtn.textContent = CONFIG.messages.sending;

      const response = await fetch(`${CONFIG.workerUrl}/send`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload)
      });

      const result = await response.json();

      if (response.ok && result.status === "ok") {
        form.reset();
        resetTurnstile();
        submitBtn.textContent = CONFIG.messages.success;
        resetButton();
      } else {
        showError(getErrorMessage(result.error));
        resetTurnstile();
        submitBtn.textContent = CONFIG.messages.error;
        resetButton();
      }
    } catch (err) {
      console.error("Send error:", err);
      showError(CONFIG.errors.network_error);
      submitBtn.textContent = CONFIG.messages.failed;
      resetButton();
    } finally {
      submitBtn.disabled = false;
    }
  });

  // Initialize Turnstile when script loads
  if (CONFIG.turnstile.siteKey) {
    if (window.turnstile) {
      initTurnstile();
    } else {
      // Wait for Turnstile script to load
      const checkTurnstile = setInterval(() => {
        if (window.turnstile) {
          clearInterval(checkTurnstile);
          initTurnstile();
        }
      }, 100);
    }
  }
});
</script>
```

## Configuration Options

### Turnstile Modes

| Mode | Description |
|------|-------------|
| `managed` | User clicks checkbox (default, most reliable) |
| `invisible` | Auto-triggers on form submit, no visible widget |
| `non-interactive` | Shows loading spinner, auto-solves without user action |

### Turnstile Themes

| Theme | Description |
|-------|-------------|
| `light` | Light background |
| `dark` | Dark background |
| `auto` | Matches user's system preference |

## Spam Protection Features

The form includes several anti-spam measures:

| Feature | How it works |
|---------|--------------|
| **Honeypot** | Hidden `website` field — bots fill it, humans don't |
| **Time-to-submit** | `ts` timestamp — rejects forms submitted in < 800ms |
| **Client check** | `isHuman()` — detects headless browsers |
| **Rate limiting** | Server-side — 30 requests/min per IP |
| **Idempotency** | Prevents duplicate submissions within 5 minutes |

## Enabling Cloudflare Turnstile

1. Get Turnstile keys from [Cloudflare Dashboard](https://dash.cloudflare.com/?to=/:account/turnstile)
2. During worker setup, set `ENABLE_TURNSTILE=true` and provide `TURNSTILE_SECRET`
3. In the JavaScript CONFIG, set your `siteKey`:

```javascript
turnstile: {
  siteKey: "0x4AAAAAAA...",  // Your site key from Cloudflare
  theme: "auto",
  mode: "managed",
  size: "normal",
}
```

### Important: Turnstile Limits

| Plan | Limit |
|------|-------|
| Free | 1 million challenges/month |
| Enterprise | Unlimited |

**Multi-domain considerations:**
- Each domain requires its own Turnstile widget (site key)
- All domains share the same monthly limit per Cloudflare account
- One secret key can verify tokens from multiple site keys
- For high-traffic multi-tenant setups, consider:
  - Disabling captcha (`siteKey: ""`) and relying on other spam protection
  - Using Turnstile only for high-risk domains
  - Upgrading to Enterprise plan

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
