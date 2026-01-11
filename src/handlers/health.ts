import type { Context } from "hono";
import type { Env } from "../types";

export function healthHandler(c: Context<{ Bindings: Env }>) {
  return c.json({
    ok: true,
    time: new Date().toISOString(),
  });
}
