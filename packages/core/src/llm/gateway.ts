export interface LlmMessage {
  readonly role: 'system' | 'user' | 'assistant';
  readonly content: string;
}

export interface ToolDef {
  readonly name: string;
  readonly description: string;
  readonly parameters: Record<string, unknown>;
}

export interface ToolCallResult {
  readonly id: string;
  readonly name: string;
  readonly arguments: Record<string, unknown>;
}

export interface LlmUsage {
  readonly inputTokens: number;
  readonly outputTokens: number;
}

export interface LlmRequest {
  readonly messages: readonly LlmMessage[];
  readonly model: string;
  readonly temperature?: number;
  readonly maxTokens?: number;
  readonly tools?: readonly ToolDef[];
}

export interface LlmResponse {
  readonly content: string;
  readonly toolCalls: readonly ToolCallResult[];
  readonly usage: LlmUsage;
}

/** Provider-agnostic LLM gateway. Adapters implement this. */
export interface LlmGateway {
  chat(request: LlmRequest): Promise<LlmResponse>;
}
