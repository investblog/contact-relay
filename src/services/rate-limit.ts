import type { RateLimitEntry } from "../types";

const WINDOW_MS = 60_000; // 1 minute

/**
 * Check if IP has exceeded rate limit using sliding window in KV.
 * Returns true if rate limited.
 */
export async function isRateLimited(
  kv: KVNamespace,
  ip: string,
  limitPerMin: number
): Promise<boolean> {
  const key = `rate:${ip}`;
  const now = Date.now();

  const raw = await kv.get(key);
  let entry: RateLimitEntry = raw ? JSON.parse(raw) : { timestamps: [] };

  // Remove expired timestamps
  const cutoff = now - WINDOW_MS;
  entry.timestamps = entry.timestamps.filter((t) => t > cutoff);

  // Check limit
  if (entry.timestamps.length >= limitPerMin) {
    return true;
  }

  // Record this request
  entry.timestamps.push(now);

  // Store with TTL of 60 seconds
  await kv.put(key, JSON.stringify(entry), { expirationTtl: 60 });

  return false;
}
