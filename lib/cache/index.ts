/**
 * Safe Cache API - Never Throws, Respects Disabled State
 * 
 * All operations gracefully degrade when Redis is unavailable.
 * No exceptions bubble up to callers.
 */

import { getRedis, cacheEnabled } from "./redis";
import { log } from "@/lib/logger";

/**
 * Get cached value (returns null if cache miss or unavailable)
 */
export async function cacheGet<T>(key: string): Promise<T | null> {
  const redis = getRedis();
  if (!redis) return null;

  try {
    const value = await redis.get(key);
    if (!value) return null;

    const parsed = JSON.parse(value) as T;
  log.debug("[Cache] Hit", { key });
    return parsed;

  } catch (err) {
  log.warn("[Cache] Get failed; returning null", { key, err: String(err) });
    return null;
  }
}

/**
 * Set cached value with TTL (no-op if cache unavailable)
 */
export async function cacheSet(
  key: string,
  value: unknown,
  ttlSeconds: number
): Promise<void> {
  const redis = getRedis();
  if (!redis) return;

  try {
    const serialized = JSON.stringify(value);
    await redis.setex(key, ttlSeconds, serialized);
  log.debug("[Cache] Set", { key, ttl: `${ttlSeconds}s` });

  } catch (err) {
  log.warn("[Cache] Set failed; ignoring", { key, err: String(err) });
  }
}

/**
 * Delete cached value (no-op if cache unavailable)
 */
export async function cacheDel(key: string): Promise<void> {
  const redis = getRedis();
  if (!redis) return;

  try {
    await redis.del(key);
  log.debug("[Cache] Deleted", { key });

  } catch (err) {
  log.warn("[Cache] Delete failed; ignoring", { key, err: String(err) });
  }
}

/**
 * Check if cache is healthy and available
 */
export function isCacheAvailable(): boolean {
  return cacheEnabled();
}

/**
 * Export for backward compatibility
 */
export { getRedis, cacheEnabled } from "./redis";
