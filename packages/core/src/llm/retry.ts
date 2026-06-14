export interface RetryConfig {
  maxRetries: number;
  baseDelayMs: number;
  maxDelayMs: number;
}

export const DEFAULT_RETRY_CONFIG: RetryConfig = {
  maxRetries: 3,
  baseDelayMs: 1000,
  maxDelayMs: 30000,
};

export function abortableSleep(ms: number, signal?: AbortSignal): Promise<void> {
  return new Promise((resolve, reject) => {
    if (signal?.aborted) {
      reject(new DOMException('Aborted', 'AbortError'));
      return;
    }
    const onAbort = () => {
      clearTimeout(timer);
      reject(new DOMException('Aborted', 'AbortError'));
    };
    const timer = setTimeout(() => {
      signal?.removeEventListener('abort', onAbort);
      resolve();
    }, ms);
    signal?.addEventListener('abort', onAbort, { once: true });
  });
}

function retryAfterMs(error: unknown): number | null {
  const headers =
    error && typeof error === 'object' && 'headers' in error
      ? (error as { headers?: unknown }).headers
      : error instanceof Error &&
          error.cause &&
          typeof error.cause === 'object' &&
          'headers' in error.cause
        ? (error.cause as { headers?: unknown }).headers
        : undefined;
  const value =
    headers instanceof Headers
      ? headers.get('retry-after')
      : headers && typeof headers === 'object'
        ? ((headers as Record<string, unknown>)['retry-after'] ??
          (headers as Record<string, unknown>)['Retry-After'])
        : undefined;
  if (typeof value !== 'string' && typeof value !== 'number') return null;
  const raw = String(value).trim();
  const seconds = Number(raw);
  if (Number.isFinite(seconds)) return Math.max(0, seconds * 1000);
  const at = Date.parse(raw);
  return Number.isFinite(at) ? Math.max(0, at - Date.now()) : null;
}

// Dedicated ceiling for a server-provided Retry-After. A legitimate Retry-After
// routinely exceeds our jittered-backoff `maxDelayMs` (servers ask for 10-60s),
// so it must NOT be clamped to that knob — but an untrusted/misbehaving server
// still must not stall a call indefinitely. 2 minutes honors every realistic
// Retry-After while capping absurd values.
const RETRY_AFTER_MAX_MS = 120_000;

export function computeDelay(attempt: number, config: RetryConfig, error: unknown): number {
  const headerDelay = retryAfterMs(error);
  // Honor the server-provided Retry-After (clamped only to RETRY_AFTER_MAX_MS,
  // never the lower backoff ceiling). Stays abortable via sleep(signal) in withRetry.
  if (headerDelay !== null) return Math.min(headerDelay, RETRY_AFTER_MAX_MS);
  const exponential = config.baseDelayMs * 2 ** attempt;
  const jitter = exponential * (0.5 + Math.random() * 0.5);
  return Math.min(jitter, config.maxDelayMs);
}

export async function withRetry<T>(
  fn: () => Promise<T>,
  config: RetryConfig,
  isRetryable: (error: unknown) => boolean,
  signal?: AbortSignal,
): Promise<T> {
  let lastError: unknown;

  for (let attempt = 0; attempt <= config.maxRetries; attempt++) {
    if (signal?.aborted) {
      throw new DOMException('Aborted', 'AbortError');
    }
    try {
      return await fn();
    } catch (error) {
      lastError = error;
      if (!isRetryable(error) || attempt === config.maxRetries) {
        throw error;
      }
      // Abortable backoff: if the signal fires during the (up to maxDelayMs)
      // wait, reject immediately instead of stalling for the full delay.
      await abortableSleep(computeDelay(attempt, config, error), signal);
    }
  }

  throw lastError;
}
