export class AicsError extends Error {
  constructor(
    message: string,
    public readonly code: string,
    public readonly recoverable: boolean,
  ) {
    super(message);
    this.name = 'AicsError';
  }
}

/** HTTP status codes that indicate a transient error worth retrying. */
const RETRYABLE_STATUS = new Set([429, 500, 502, 503, 504, 529]);

export class LlmError extends AicsError {
  constructor(
    message: string,
    public readonly provider: string,
    public readonly statusCode?: number,
  ) {
    const recoverable = statusCode !== undefined && RETRYABLE_STATUS.has(statusCode);
    super(message, 'LLM_ERROR', recoverable);
    this.name = 'LlmError';
  }
}

export class GraphError extends AicsError {
  constructor(
    message: string,
    public readonly nodeName: string,
  ) {
    super(message, 'GRAPH_ERROR', false);
    this.name = 'GraphError';
  }
}

export class DataError extends AicsError {
  constructor(message: string) {
    super(message, 'DATA_ERROR', false);
    this.name = 'DataError';
  }
}
