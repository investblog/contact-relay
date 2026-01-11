const TTL_SECONDS = 300; // 5 minutes

/**
 * Check if request with given idempotency key was already processed.
 * Returns true if duplicate.
 */
export async function isDuplicate(
  kv: KVNamespace,
  idempotencyKey: string
): Promise<boolean> {
  if (!idempotencyKey) return false;

  const key = `idem:${idempotencyKey}`;
  const existing = await kv.get(key);

  if (existing) {
    return true;
  }

  // Mark as seen with TTL
  await kv.put(key, "1", { expirationTtl: TTL_SECONDS });

  return false;
}

/**
 * Generate payload hash for idempotency.
 */
export async function payloadHash(payload: Record<string, string>): Promise<string> {
  const body = JSON.stringify(payload, Object.keys(payload).sort());
  const encoder = new TextEncoder();
  const data = encoder.encode(body);
  const hashBuffer = await crypto.subtle.digest("SHA-256", data);
  const hashArray = Array.from(new Uint8Array(hashBuffer));
  return hashArray.map((b) => b.toString(16).padStart(2, "0")).join("");
}
