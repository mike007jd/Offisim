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

export class LlmError extends OffisimError {
  constructor(
    message: string,
    public readonly provider: string,
    public readonly statusCode?: number,
    options?: { cause?: unknown },
  ) {
    const recoverable = statusCode !== undefined && RETRYABLE_STATUS.has(statusCode);
    super(message, 'LLM_ERROR', recoverable, options);
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
