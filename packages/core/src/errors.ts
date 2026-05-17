/** Extract a message string from an unknown thrown value. */
export function toErrorMessage(err: unknown): string {
  return err instanceof Error ? err.message : String(err);
}

export class OffisimError extends Error {
  constructor(
    message: string,
    public readonly code: string,
    public readonly recoverable: boolean,
    options?: { cause?: unknown },
  ) {
    super(message, options);
    this.name = 'OffisimError';
  }
}

/** HTTP status codes that indicate a transient error worth retrying. */
const RETRYABLE_STATUS = new Set([429, 500, 502, 503, 504, 529]);
const CONTEXT_OVERFLOW_STATUS = new Set([400, 413]);

function looksRecoverableWithoutStatus(message: string, cause: unknown): boolean {
  const causeName =
    cause && typeof cause === 'object' && 'name' in cause
      ? String((cause as { name?: unknown }).name ?? '')
      : '';
  return /APIConnectionError|AbortError|TimeoutError|fetch failed|network|socket|ECONNRESET|ECONNREFUSED|ETIMEDOUT|timeout|timed[ -]?out/i.test(
    `${causeName} ${message}`,
  );
}

export function isContextOverflowError(error: unknown): boolean {
  if (!(error instanceof LlmError)) return false;
  if (error.statusCode !== undefined && !CONTEXT_OVERFLOW_STATUS.has(error.statusCode)) {
    return false;
  }
  return /context(?:_| |-)?(?:length|window|overflow)|prompt(?:_| |-)?too(?:_| |-)?long|maximum context|too many tokens|413/i.test(
    error.message,
  );
}

export function isCapacityError(error: unknown): boolean {
  if (!(error instanceof LlmError)) return false;
  return (
    error.statusCode === 529 ||
    /overloaded|capacity|temporar(?:y|ily) unavailable|server is busy|rate limit/i.test(
      error.message,
    )
  );
}

export class LlmError extends OffisimError {
  constructor(
    message: string,
    public readonly provider: string,
    public readonly statusCode?: number,
    options?: { cause?: unknown; shouldRetry?: boolean },
  ) {
    // Server `x-should-retry` directive wins over status/heuristic when present.
    const recoverable =
      options?.shouldRetry !== undefined
        ? options.shouldRetry
        : statusCode !== undefined
          ? RETRYABLE_STATUS.has(statusCode)
          : looksRecoverableWithoutStatus(message, options?.cause);
    super(message, 'LLM_ERROR', recoverable, { cause: options?.cause });
    this.name = 'LlmError';
  }
}

export class GraphError extends OffisimError {
  constructor(
    message: string,
    public readonly nodeName: string,
  ) {
    super(message, 'GRAPH_ERROR', false);
    this.name = 'GraphError';
  }
}

export class DataError extends OffisimError {
  constructor(message: string) {
    super(message, 'DATA_ERROR', false);
    this.name = 'DataError';
  }
}
