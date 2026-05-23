/**
 * In-memory token bucket rate limiter middleware for Hono.
 *
 * Uses a simple Map-based store with periodic cleanup.
 * Sufficient for 1.0 — replace with Redis when horizontal scaling is needed.
 */

import { createMiddleware } from 'hono/factory';
import type { PlatformEnv } from '../types.js';

interface Bucket {
  tokens: number;
  lastRefill: number;
}

interface RateLimitConfig {
  /** Maximum tokens (burst capacity) */
  maxTokens: number;
  /** Tokens added per second */
  refillRate: number;
  /** Window label for logging */
  label?: string;
}

// Shared store across all rate limiters
const store = new Map<string, Bucket>();

// Periodic cleanup every 5 minutes — remove entries older than 10 minutes
const CLEANUP_INTERVAL_MS = 5 * 60 * 1000;
const ENTRY_TTL_MS = 10 * 60 * 1000;

let cleanupTimer: ReturnType<typeof setInterval> | undefined;

function ensureCleanup() {
  if (cleanupTimer) return;
  cleanupTimer = setInterval(() => {
    const now = Date.now();
    for (const [key, bucket] of store) {
      if (now - bucket.lastRefill > ENTRY_TTL_MS) {
        store.delete(key);
      }
    }
  }, CLEANUP_INTERVAL_MS);
  // Don't block process exit
  if (typeof cleanupTimer === 'object' && 'unref' in cleanupTimer) {
    cleanupTimer.unref();
  }
}

/**
 * Number of trusted proxy hops. We take the Nth-from-right entry in
 * X-Forwarded-For, which is the IP written by the closest trusted proxy.
 *
 * Production deployments MUST configure their reverse proxy to overwrite
 * (not append to) X-Forwarded-For, or set this to match the proxy chain depth.
 */
const TRUSTED_PROXY_DEPTH = Number(process.env.TRUSTED_PROXY_DEPTH) || 1;
const TRUST_PROXY_HEADERS = process.env.OFFISIM_TRUST_PROXY_HEADERS === '1';

/**
 * Extract client identifier for rate limiting.
 * Takes the Nth-from-right IP from X-Forwarded-For (the one written by the
 * closest trusted proxy), rather than the leftmost (which the client controls).
 */
function getClientKey(c: { req: { header: (name: string) => string | undefined } }): string {
  const forwarded = c.req.header('x-forwarded-for');
  if (TRUST_PROXY_HEADERS && forwarded) {
    const parts = forwarded.split(',').map((s) => s.trim());
    // Take the Nth-from-right entry (index = length - depth)
    const idx = Math.max(0, parts.length - TRUSTED_PROXY_DEPTH);
    const ip = parts[idx];
    if (ip) return ip;
  }
  // X-Real-IP is equally client-spoofable — only trust it when a proxy is
  // known to set it. For now, fall back to a shared key rather than trusting
  // an unverified header that lets attackers rotate buckets.
  // Fallback — in production this should always have a proxy header
  return 'unknown';
}

/**
 * Consume one token from the bucket. Returns remaining tokens or -1 if exhausted.
 */
function consumeToken(
  key: string,
  config: RateLimitConfig,
): {
  remaining: number;
  retryAfter: number;
} {
  const now = Date.now();
  let bucket = store.get(key);

  if (!bucket) {
    bucket = { tokens: config.maxTokens, lastRefill: now };
    store.set(key, bucket);
  }

  // Refill tokens based on elapsed time
  const elapsed = (now - bucket.lastRefill) / 1000;
  bucket.tokens = Math.min(config.maxTokens, bucket.tokens + elapsed * config.refillRate);
  bucket.lastRefill = now;

  if (bucket.tokens >= 1) {
    bucket.tokens -= 1;
    return { remaining: Math.floor(bucket.tokens), retryAfter: 0 };
  }

  // Tokens exhausted — calculate retry-after
  const deficit = 1 - bucket.tokens;
  const retryAfter = Math.ceil(deficit / config.refillRate);
  return { remaining: 0, retryAfter };
}

/**
 * Create a rate-limiting middleware with the given configuration.
 *
 * Presets:
 * - General API: 100 req/min (maxTokens=100, refillRate=100/60)
 * - Auth endpoints: 10 req/min (maxTokens=10, refillRate=10/60)
 * - Publish endpoints: 20 req/min (maxTokens=20, refillRate=20/60)
 */
export function rateLimit(config: RateLimitConfig) {
  ensureCleanup();
  const label = config.label ?? 'default';

  return createMiddleware<PlatformEnv>(async (c, next) => {
    const clientKey = `${label}:${getClientKey(c)}`;
    const result = consumeToken(clientKey, config);

    c.header('X-RateLimit-Limit', String(config.maxTokens));
    c.header('X-RateLimit-Remaining', String(result.remaining));

    if (result.retryAfter > 0) {
      c.header('Retry-After', String(result.retryAfter));
      return c.json(
        {
          error: {
            code: 'RATE_LIMITED',
            message: 'Too many requests. Please try again later.',
            retry_after: result.retryAfter,
          },
        },
        429,
      );
    }

    await next();
  });
}

// ── Presets ──

/** General API rate limit: 100 requests/minute */
export const generalRateLimit = rateLimit({
  maxTokens: 100,
  refillRate: 100 / 60,
  label: 'general',
});

/** Strict rate limit for auth endpoints: 10 requests/minute */
export const authRateLimit = rateLimit({
  maxTokens: 10,
  refillRate: 10 / 60,
  label: 'auth',
});

/** Strict rate limit for publish endpoints: 20 requests/minute */
export const publishRateLimit = rateLimit({
  maxTokens: 20,
  refillRate: 20 / 60,
  label: 'publish',
});

/** Rate limit for install receipts: 30 requests/minute */
export const installRateLimit = rateLimit({
  maxTokens: 30,
  refillRate: 30 / 60,
  label: 'install',
});

// ── Test helpers ──

/** Clear all rate limit state (for testing only) */
export function _resetRateLimitStore() {
  store.clear();
}
