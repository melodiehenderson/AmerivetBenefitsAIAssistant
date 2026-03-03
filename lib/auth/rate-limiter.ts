/**
 * Simple in-memory rate limiter for login attempts
 * Production should use Redis/Upstash/Edge Config for distributed state
 * 
 * Current limits: 3 attempts per IP per 15 minutes
 */

interface RateLimitEntry {
  attempts: number;
  windowStart: number;
}

// In-memory store (resets on server restart)
const store = new Map<string, RateLimitEntry>();

const WINDOW_MS = 15 * 60 * 1000; // 15 minutes
const MAX_ATTEMPTS = 10;

export function checkRateLimit(identifier: string): { allowed: boolean; remaining: number } {
  const now = Date.now();
  const entry = store.get(identifier);

  // No entry or window expired - start fresh
  if (!entry || now - entry.windowStart > WINDOW_MS) {
    store.set(identifier, { attempts: 1, windowStart: now });
    return { allowed: true, remaining: MAX_ATTEMPTS - 1 };
  }

  // Within window - increment attempts
  entry.attempts++;

  if (entry.attempts > MAX_ATTEMPTS) {
    return { allowed: false, remaining: 0 };
  }

  return { allowed: true, remaining: MAX_ATTEMPTS - entry.attempts };
}

export function resetRateLimit(identifier: string): void {
  store.delete(identifier);
}

// Cleanup old entries every hour to prevent memory leak
setInterval(() => {
  const now = Date.now();
  for (const [key, entry] of store.entries()) {
    if (now - entry.windowStart > WINDOW_MS) {
      store.delete(key);
    }
  }
}, 60 * 60 * 1000);
