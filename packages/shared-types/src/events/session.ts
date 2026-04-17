export interface SessionCostBreakdown {
  readonly key: string;
  readonly costUsd: number;
  readonly inputTokens: number;
  readonly outputTokens: number;
  readonly latencyMs: number;
  readonly callCount: number;
  readonly pricedCallCount: number;
  readonly unpricedCallCount: number;
  readonly pricingConfidence: 'exact' | 'catalog' | 'fallback' | 'unknown';
}

export interface SessionCostUpdatedPayload {
  readonly sessionId: string;
  readonly threadId: string;
  readonly totalCostUsd: number;
  readonly totalInputTokens: number;
  readonly totalOutputTokens: number;
  readonly totalLatencyMs: number;
  readonly totalCalls: number;
  readonly pricedCallCount: number;
  readonly unpricedCallCount: number;
  readonly costConfidence: 'exact' | 'catalog' | 'fallback' | 'unknown';
  readonly byModel: readonly SessionCostBreakdown[];
  readonly byNode: readonly SessionCostBreakdown[];
  readonly byEmployee: readonly SessionCostBreakdown[];
  readonly lastLlmCallId: string;
}
