/**
 * Extract hostname from Origin header and strip www prefix.
 */
export function normalizeHost(origin: string): string {
  try {
    const url = new URL(origin);
    let host = url.hostname.toLowerCase();
    if (host.startsWith("www.")) {
      host = host.slice(4);
    }
    return host;
  } catch {
    return "";
  }
}

/**
 * Simple glob-like pattern matching (supports * wildcard).
 * Pattern "*.example.com" matches "sub.example.com" but not "example.com".
 */
function matchPattern(host: string, pattern: string): boolean {
  if (pattern === "*") return true;

  const escaped = pattern
    .replace(/[.+^${}()|[\]\\]/g, "\\$&")
    .replace(/\*/g, ".*");

  const regex = new RegExp(`^${escaped}$`, "i");
  return regex.test(host);
}

/**
 * Check if host matches any of the allowed origin patterns.
 */
export function matchOrigin(host: string, allowedOrigins: string[]): boolean {
  if (allowedOrigins.length === 0) return true;
  return allowedOrigins.some((pattern) => matchPattern(host, pattern));
}

/**
 * Parse ALLOWED_ORIGINS env var into array of patterns.
 */
export function parseAllowedOrigins(envValue?: string): string[] {
  if (!envValue) return [];
  return envValue
    .split(",")
    .map((s) => s.trim().toLowerCase())
    .filter((s) => s.length > 0);
}

/**
 * Get all allowed origins from KV (dynamic) + env (static).
 * Dynamic origins from KV take precedence.
 */
export async function getAllowedOrigins(
  configKv: KVNamespace,
  envValue?: string
): Promise<string[]> {
  const envOrigins = parseAllowedOrigins(envValue);

  try {
    const raw = await configKv.get("allowed_origins");
    if (raw) {
      const config = JSON.parse(raw);
      if (Array.isArray(config.patterns) && config.patterns.length > 0) {
        // Merge: dynamic + env (deduplicated)
        const all = new Set([...config.patterns, ...envOrigins]);
        return Array.from(all);
      }
    }
  } catch {
    // Ignore KV errors, fallback to env
  }

  return envOrigins;
}
