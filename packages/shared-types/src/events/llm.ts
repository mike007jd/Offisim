export interface LlmCallStartedPayload {
  readonly llmCallId: string;
  readonly nodeName: string;
  readonly provider: string;
  readonly model: string;
  readonly threadId: string;
}

export interface LlmCallCompletedPayload {
  readonly llmCallId: string;
  readonly nodeName: string;
  readonly latencyMs: number;
  readonly inputTokens: number;
  readonly outputTokens: number;
}

export interface LlmUsageRecordedPayload {
  readonly llmCallId: string;
  readonly threadId: string;
  readonly taskRunId: string | null;
  readonly provider: string;
  readonly model: string;
  readonly nodeName: string;
  readonly inputTokens: number;
  readonly outputTokens: number;
  readonly latencyMs: number;
}

export interface LlmStreamChunkPayload {
  readonly nodeName: string;
  readonly content: string;
  readonly channel?: 'content' | 'reasoning';
}
