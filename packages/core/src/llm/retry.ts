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

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function retryAfterMs(error: unknown): number | null {
  const headers =
    error && typeof error === 'object' && 'headers' in error
      ? (error as { headers?: unknown }).headers
      : error instanceof Error && error.cause && typeof error.cause === 'object' && 'headers' in error.cause
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

export function computeDelay(attempt: number, config: RetryConfig, error: unknown): number {
  const headerDelay = retryAfterMs(error);
  if (headerDelay !== null) return headerDelay;
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
      await sleep(computeDelay(attempt, config, error));
    }
  }

  throw lastError;
}
