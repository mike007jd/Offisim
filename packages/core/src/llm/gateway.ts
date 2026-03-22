export interface LlmMessage {
  readonly role: 'system' | 'user' | 'assistant' | 'tool';
  readonly content: string;
  /** For role='assistant': tool calls the model wants to make */
  readonly toolCalls?: readonly ToolCallResult[];
  /** For role='tool': the tool_call_id this result responds to */
  readonly toolCallId?: string;
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
  /** AbortSignal for cancellation. */
  readonly signal?: AbortSignal;
  /** Request timeout in milliseconds. Default: 60000 for chat, 120000 for stream. */
  readonly timeoutMs?: number;
}

export interface LlmResponse {
  readonly content: string;
  readonly toolCalls: readonly ToolCallResult[];
  readonly usage: LlmUsage;
}

export interface LlmStreamChunk {
  readonly content?: string;
  readonly toolCalls?: readonly ToolCallResult[];
  readonly usage?: LlmUsage;
  readonly done: boolean;
}

/** Provider-agnostic LLM gateway. Adapters implement this. */
export interface LlmGateway {
  chat(request: LlmRequest): Promise<LlmResponse>;
  chatStream(request: LlmRequest): AsyncIterable<LlmStreamChunk>;
  /** Release adapter resources (child processes, connections). No-op for stateless adapters. */
  dispose?(): void;
}
