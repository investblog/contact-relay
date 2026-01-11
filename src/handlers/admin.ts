import type { Context } from "hono";
import type { Env, OriginsConfig } from "../types";

const ORIGINS_KEY = "allowed_origins";

/**
 * Middleware to check admin authorization.
 */
export function requireAdmin(c: Context<{ Bindings: Env }>): Response | null {
  const adminKey = c.env.ADMIN_KEY;
  if (!adminKey) {
    return c.json({ status: "error", error: "admin_not_configured" }, 503);
  }

  const providedKey = c.req.header("X-Admin-Key");
  if (!providedKey || providedKey !== adminKey) {
    return c.json({ status: "error", error: "unauthorized" }, 401);
  }

  return null;
}

/**
 * GET /admin/origins - List all allowed origins.
 */
export async function listOrigins(
  c: Context<{ Bindings: Env }>
): Promise<Response> {
  const authError = requireAdmin(c);
  if (authError) return authError;

  const config = await getOriginsConfig(c.env.CONFIG);
  const envOrigins = parseEnvOrigins(c.env.ALLOWED_ORIGINS);

  return c.json({
    status: "ok",
    origins: {
      dynamic: config?.patterns || [],
      env: envOrigins,
      updatedAt: config?.updatedAt || null,
    },
  });
}

/**
 * PUT /admin/origins - Replace all dynamic origins.
 */
export async function replaceOrigins(
  c: Context<{ Bindings: Env }>
): Promise<Response> {
  const authError = requireAdmin(c);
  if (authError) return authError;

  const body = await c.req.json<{ patterns: string[] }>();

  if (!Array.isArray(body.patterns)) {
    return c.json({ status: "error", error: "invalid_payload" }, 400);
  }

  const patterns = body.patterns
    .map((p) => String(p).trim().toLowerCase())
    .filter((p) => p.length > 0);

  const config: OriginsConfig = {
    patterns,
    updatedAt: new Date().toISOString(),
  };

  await c.env.CONFIG.put(ORIGINS_KEY, JSON.stringify(config));

  return c.json({ status: "ok", origins: patterns });
}

/**
 * POST /admin/origins - Add a new origin pattern.
 */
export async function addOrigin(
  c: Context<{ Bindings: Env }>
): Promise<Response> {
  const authError = requireAdmin(c);
  if (authError) return authError;

  const body = await c.req.json<{ pattern: string }>();
  const pattern = String(body.pattern || "").trim().toLowerCase();

  if (!pattern) {
    return c.json({ status: "error", error: "invalid_pattern" }, 400);
  }

  const config = await getOriginsConfig(c.env.CONFIG) || { patterns: [], updatedAt: "" };

  if (config.patterns.includes(pattern)) {
    return c.json({ status: "ok", message: "already_exists", origins: config.patterns });
  }

  config.patterns.push(pattern);
  config.updatedAt = new Date().toISOString();

  await c.env.CONFIG.put(ORIGINS_KEY, JSON.stringify(config));

  return c.json({ status: "ok", origins: config.patterns });
}

/**
 * DELETE /admin/origins/:pattern - Remove an origin pattern.
 */
export async function removeOrigin(
  c: Context<{ Bindings: Env }>
): Promise<Response> {
  const authError = requireAdmin(c);
  if (authError) return authError;

  const pattern = decodeURIComponent(c.req.param("pattern") || "").toLowerCase();

  if (!pattern) {
    return c.json({ status: "error", error: "invalid_pattern" }, 400);
  }

  const config = await getOriginsConfig(c.env.CONFIG);

  if (!config) {
    return c.json({ status: "error", error: "not_found" }, 404);
  }

  const index = config.patterns.indexOf(pattern);
  if (index === -1) {
    return c.json({ status: "error", error: "not_found" }, 404);
  }

  config.patterns.splice(index, 1);
  config.updatedAt = new Date().toISOString();

  await c.env.CONFIG.put(ORIGINS_KEY, JSON.stringify(config));

  return c.json({ status: "ok", origins: config.patterns });
}

/**
 * Get origins config from KV.
 */
export async function getOriginsConfig(
  kv: KVNamespace
): Promise<OriginsConfig | null> {
  const raw = await kv.get(ORIGINS_KEY);
  if (!raw) return null;

  try {
    return JSON.parse(raw);
  } catch {
    return null;
  }
}

/**
 * Parse ALLOWED_ORIGINS env var.
 */
function parseEnvOrigins(envValue?: string): string[] {
  if (!envValue) return [];
  return envValue
    .split(",")
    .map((s) => s.trim().toLowerCase())
    .filter((s) => s.length > 0);
}
