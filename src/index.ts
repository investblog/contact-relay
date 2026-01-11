import { Hono } from "hono";
import type { Env } from "./types";
import { corsMiddleware } from "./utils/cors";
import { sendHandler } from "./handlers/send";
import { healthHandler } from "./handlers/health";
import {
  listOrigins,
  replaceOrigins,
  addOrigin,
  removeOrigin,
} from "./handlers/admin";

const app = new Hono<{ Bindings: Env }>();

// Apply CORS middleware to all routes
app.use("*", corsMiddleware);

// Public routes
app.post("/send", sendHandler);
app.get("/health", healthHandler);

// Admin routes
app.get("/admin/origins", listOrigins);
app.put("/admin/origins", replaceOrigins);
app.post("/admin/origins", addOrigin);
app.delete("/admin/origins/:pattern", removeOrigin);

// 404 handler
app.notFound((c) => c.json({ status: "error", error: "not_found" }, 404));

export default app;
