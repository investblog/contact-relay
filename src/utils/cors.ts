import type { Context, Next } from "hono";
import type { Env } from "../types";
import { normalizeHost, matchOrigin, getAllowedOrigins } from "./origin";

/**
 * CORS middleware that validates Origin against allowed patterns.
 */
export async function corsMiddleware(
  c: Context<{ Bindings: Env }>,
  next: Next
) {
  const origin = c.req.header("Origin") || "";
  const host = normalizeHost(origin);
  const allowedOrigins = await getAllowedOrigins(c.env.CONFIG, c.env.ALLOWED_ORIGINS);

  c.header("Vary", "Origin");

  if (origin && matchOrigin(host, allowedOrigins)) {
    c.header("Access-Control-Allow-Origin", origin);
    c.header("Access-Control-Allow-Headers", "Content-Type,Idempotency-Key,X-Admin-Key");
    c.header("Access-Control-Allow-Methods", "GET,POST,PUT,DELETE,OPTIONS");
  }

  if (c.req.method === "OPTIONS") {
    return c.body(null, 204);
  }

  await next();
}
