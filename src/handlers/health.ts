import type { Context } from "hono";
import type { Env } from "../types";
import { getAllowedOrigins } from "../utils/origin";

export async function healthHandler(c: Context<{ Bindings: Env }>) {
  const env = c.env;
  const origins = await getAllowedOrigins(env.CONFIG, env.ALLOWED_ORIGINS);

  return c.json({
    ok: true,
    time: new Date().toISOString(),
    config: {
      turnstile: env.ENABLE_TURNSTILE === "true",
      bot_configured: !!env.BOT_TOKEN,
      origins_count: origins.length,
      rate_limit_per_min: parseInt(env.RATE_LIMIT_PER_MIN, 10) || 30,
      routing_configured: !!env.ROUTING_JSON,
    },
  });
}
