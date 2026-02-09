import type { Context } from "hono";
import type { Env, ContactFormData, ApiResponse, RoutingMap } from "../types";
import { normalizeHost, matchOrigin, getAllowedOrigins } from "../utils/origin";
import { sanitizeTelegram, trimLimit, buildMessageText } from "../utils/sanitize";
import { isRateLimited } from "../services/rate-limit";
import { isDuplicate, payloadHash } from "../services/idempotency";
import { sendTelegramMessage } from "../services/telegram";

export async function sendHandler(
  c: Context<{ Bindings: Env }>
): Promise<Response> {
  const env = c.env;

  // 1. Origin validation
  const origin = c.req.header("Origin") || "";
  const host = normalizeHost(origin);
  const allowedOrigins = await getAllowedOrigins(env.CONFIG, env.ALLOWED_ORIGINS);

  if (!matchOrigin(host, allowedOrigins)) {
    return c.json<ApiResponse>(
      {
        status: "error",
        error: "origin_not_allowed",
        detail: `host "${host}" does not match allowed patterns`,
      },
      403
    );
  }

  // 2. Rate limiting
  const ip = c.req.header("CF-Connecting-IP") || c.req.header("X-Forwarded-For") || "unknown";
  const limitPerMin = parseInt(env.RATE_LIMIT_PER_MIN, 10) || 30;

  if (await isRateLimited(env.RATE_LIMIT, ip, limitPerMin)) {
    return jsonError(c, "rate_limited", 429);
  }

  // 3. Parse body
  let data: ContactFormData = {};
  const contentType = c.req.header("Content-Type") || "";

  if (contentType.includes("application/json")) {
    data = await c.req.json<ContactFormData>();
  } else if (contentType.includes("form")) {
    const formData = await c.req.formData();
    data = Object.fromEntries(formData.entries()) as ContactFormData;
  }

  // 4. Honeypot check
  if ((data.website || "").trim()) {
    // Silent success for bots
    return c.json<ApiResponse>({ status: "ok" }, 200);
  }

  // 5. Time-to-submit check
  try {
    const tsClient = parseInt(data.ts || "0", 10);
    if (tsClient > 0 && Date.now() - tsClient < 800) {
      return jsonError(c, "too_fast", 400);
    }
  } catch {
    // Ignore parse errors
  }

  // 6. Input validation & sanitization
  const name = trimLimit(data.name, 256);
  const email = trimLimit(data.email, 256);
  const telegram = sanitizeTelegram(data.telegram || "").slice(0, 64);
  const message = trimLimit(data.message, 5000);

  if (!message && !telegram && !email) {
    return jsonError(c, "empty_payload", 400);
  }

  // 7. Turnstile verification (if enabled)
  if (env.ENABLE_TURNSTILE === "true") {
    const captchaToken = data.cf_turnstile_response || data.hcaptcha_response || "";
    if (!await verifyTurnstile(captchaToken, env.TURNSTILE_SECRET || "")) {
      return jsonError(c, "captcha_failed", 400);
    }
  }

  // 8. Idempotency check
  const idempotencyKey =
    c.req.header("Idempotency-Key") ||
    (await payloadHash({ host, name, email, telegram, message }));

  if (await isDuplicate(env.IDEMPOTENCY, idempotencyKey)) {
    return c.json<ApiResponse>(
      { status: "ok", request_id: idempotencyKey, duplicate: true },
      200
    );
  }

  // 9. Route to correct bot/chat
  const { token, chatId } = await getRouting(host, env);

  if (!token || !chatId) {
    return jsonError(c, "routing_not_configured", 500);
  }

  // 10. Build message and send to Telegram
  const text = buildMessageText(name, email, telegram, message, host);
  const result = await sendTelegramMessage(token, chatId, text);

  if (!result.success) {
    return c.json<ApiResponse>(
      { status: "error", error: "telegram_send_failed", detail: result.error },
      502
    );
  }

  // Cache migrated supergroup chat ID for future requests
  if (result.migrated_chat_id) {
    c.executionCtx.waitUntil(
      env.CONFIG.put(
        `migrated_chat:${chatId}`,
        result.migrated_chat_id,
        { expirationTtl: 60 * 60 * 24 * 365 }
      )
    );
  }

  return c.json<ApiResponse>({ status: "ok", request_id: idempotencyKey }, 200);
}

function jsonError(
  c: Context<{ Bindings: Env }>,
  error: string,
  status: number
): Response {
  return c.json<ApiResponse>({ status: "error", error }, status);
}

async function getRouting(
  host: string,
  env: Env
): Promise<{ token: string; chatId: string }> {
  let routing: RoutingMap = {};

  if (env.ROUTING_JSON) {
    try {
      routing = JSON.parse(env.ROUTING_JSON);
    } catch {
      // Ignore parse errors
    }
  }

  const route = routing[host] || {};
  let chatId = route.chat_id || env.TG_DEFAULT_CHAT_ID;

  // Check if this chat was migrated to a supergroup
  try {
    const migrated = await env.CONFIG.get(`migrated_chat:${chatId}`);
    if (migrated) chatId = migrated;
  } catch {
    // Ignore KV errors
  }

  return {
    token: route.bot_token || env.BOT_TOKEN,
    chatId,
  };
}

async function verifyTurnstile(token: string, secret: string): Promise<boolean> {
  if (!token || !secret) return false;

  try {
    const response = await fetch(
      "https://challenges.cloudflare.com/turnstile/v0/siteverify",
      {
        method: "POST",
        headers: { "Content-Type": "application/x-www-form-urlencoded" },
        body: new URLSearchParams({ secret, response: token }),
      }
    );

    const result = await response.json<{ success: boolean }>();
    return result.success;
  } catch {
    return false;
  }
}
