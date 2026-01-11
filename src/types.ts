export interface Env {
  RATE_LIMIT: KVNamespace;
  IDEMPOTENCY: KVNamespace;
  CONFIG: KVNamespace;
  BOT_TOKEN: string;
  TG_DEFAULT_CHAT_ID: string;
  ROUTING_JSON?: string;
  ALLOWED_ORIGINS?: string;
  RATE_LIMIT_PER_MIN: string;
  ENABLE_TURNSTILE: string;
  TURNSTILE_SECRET?: string;
  ADMIN_KEY?: string;
}

export interface RouteConfig {
  chat_id?: string;
  bot_token?: string;
}

export interface RoutingMap {
  [hostname: string]: RouteConfig;
}

export interface ContactFormData {
  name?: string;
  email?: string;
  telegram?: string;
  message?: string;
  website?: string;
  ts?: string;
  cf_turnstile_response?: string;
  hcaptcha_response?: string;
}

export interface ApiResponse {
  status: "ok" | "error";
  error?: string;
  detail?: string;
  request_id?: string;
  duplicate?: boolean;
}

export interface RateLimitEntry {
  timestamps: number[];
}

export interface OriginsConfig {
  patterns: string[];
  updatedAt: string;
}
