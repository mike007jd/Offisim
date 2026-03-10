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

function computeDelay(attempt: number, config: RetryConfig): number {
  const exponential = config.baseDelayMs * 2 ** attempt;
  const jitter = exponential * (0.5 + Math.random() * 0.5);
  return Math.min(jitter, config.maxDelayMs);
}

export async function withRetry<T>(
  fn: () => Promise<T>,
  config: RetryConfig,
  isRetryable: (error: unknown) => boolean,
): Promise<T> {
  let lastError: unknown;

  for (let attempt = 0; attempt <= config.maxRetries; attempt++) {
    try {
      return await fn();
    } catch (error) {
      lastError = error;
      if (!isRetryable(error) || attempt === config.maxRetries) {
        throw error;
      }
      await sleep(computeDelay(attempt, config));
    }
  }

  throw lastError;
}
