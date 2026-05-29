export const DEV_AUTH_SECRET = 'offisim-dev-secret-change-in-production';

// CORS allowlist for the platform server. `tauri://localhost` is required for
// the desktop release `.app` to call platform endpoints (Invariant B:
// Tauri release `.app` CSP `connect-src` SHALL include platform listen origins).
// Drift on this constant is enforced by `scripts/check-platform-tauri-origin-sync.mjs`.
export const DEV_DEFAULT_ORIGINS = [
  'http://localhost:3000',
  'http://localhost:5176',
  'http://localhost:1420',
  'tauri://localhost',
];

interface StartupConfigInput {
  authSecret?: string;
  nodeEnv?: string;
  rawCorsOrigins?: string;
  betterAuthUrl?: string;
  trustProxyHeaders?: string;
}

export function resolveAuthSecret(input: StartupConfigInput = {}) {
  const nodeEnv = input.nodeEnv ?? process.env.NODE_ENV ?? 'development';
  const authSecret = input.authSecret ?? process.env.BETTER_AUTH_SECRET;

  if (!authSecret && nodeEnv === 'production') {
    throw new Error('BETTER_AUTH_SECRET is not set in production.');
  }

  return authSecret ?? DEV_AUTH_SECRET;
}

export function resolveCorsOrigins(input: StartupConfigInput = {}) {
  const nodeEnv = input.nodeEnv ?? process.env.NODE_ENV ?? 'development';
  const rawCorsOrigins = input.rawCorsOrigins ?? process.env.CORS_ORIGINS?.trim();

  if (rawCorsOrigins) {
    return rawCorsOrigins
      .split(',')
      .map((origin) => origin.trim())
      .filter(Boolean);
  }

  if (nodeEnv === 'production') {
    throw new Error('CORS_ORIGINS is not set in production.');
  }

  return DEV_DEFAULT_ORIGINS;
}

/**
 * Better Auth `baseURL`. In production it MUST be set explicitly — Better Auth
 * uses it to build callback/cookie URLs, and silently defaulting to
 * `http://localhost:4100` in a deployed environment breaks OAuth redirects and
 * cookie domains.
 */
export function resolveAuthBaseUrl(input: StartupConfigInput = {}) {
  const nodeEnv = input.nodeEnv ?? process.env.NODE_ENV ?? 'development';
  const baseUrl = input.betterAuthUrl ?? process.env.BETTER_AUTH_URL;
  if (!baseUrl) {
    if (nodeEnv === 'production') {
      throw new Error('BETTER_AUTH_URL is not set in production.');
    }
    return 'http://localhost:4100';
  }
  return baseUrl;
}

/**
 * Warn loudly at startup if running in production without trusting proxy
 * headers. The rate limiter derives the client IP from the right-most trusted
 * `X-Forwarded-For` hop only when `OFFISIM_TRUST_PROXY_HEADERS=1`. Behind a
 * reverse proxy without it, every request resolves to the proxy's own IP, so
 * per-IP limits (including auth throttling) collapse into one global bucket —
 * an effective rate-limit bypass. We warn rather than throw because a
 * direct-to-internet deployment legitimately should NOT trust the header.
 */
export function assertProxyTrustConfig(input: StartupConfigInput = {}): void {
  const nodeEnv = input.nodeEnv ?? process.env.NODE_ENV ?? 'development';
  const trust = input.trustProxyHeaders ?? process.env.OFFISIM_TRUST_PROXY_HEADERS;
  if (nodeEnv === 'production' && trust !== '1') {
    console.warn(
      '[platform] OFFISIM_TRUST_PROXY_HEADERS is not "1" in production. If this ' +
        'server sits behind a reverse proxy, all requests share the proxy IP and ' +
        'per-IP rate limiting (including auth throttling) collapses to a single ' +
        'global bucket. Set OFFISIM_TRUST_PROXY_HEADERS=1 only when a trusted ' +
        'proxy rewrites X-Forwarded-For; leave it unset for direct exposure.',
    );
  }
}
