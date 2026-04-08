import OpenAI from 'openai';
import { LlmError } from '../errors.js';
import type {
  LlmGateway,
  LlmMessage,
  LlmRequest,
  LlmResponse,
  LlmStreamChunk,
  LlmUsage,
  ToolCallResult,
  ToolDef,
} from './gateway.js';
import { DEFAULT_RETRY_CONFIG, type RetryConfig, withRetry } from './retry.js';

export interface OpenAiAdapterOptions {
  /** Custom base URL for OpenAI-compatible endpoints (e.g. OpenRouter, Kimi, Gemini compat) */
  baseURL?: string;
  /** Extra headers sent with every request (e.g. HTTP-Referer for OpenRouter) */
  defaultHeaders?: Record<string, string>;
  retryConfig?: RetryConfig;
  /** Allow browser-side API calls (required for apps/web and Tauri desktop) */
  dangerouslyAllowBrowser?: boolean;
}

type CompatAssistantMessage = OpenAI.Chat.Completions.ChatCompletionAssistantMessageParam & {
  reasoning_content?: string | null;
};

type CompatDelta = {
  content?: string | null;
  reasoning_content?: string | null;
  tool_calls?: OpenAI.Chat.Completions.ChatCompletionChunk.Choice.Delta.ToolCall[];
};

/** Convert our ToolDef to OpenAI's tool format */
function mapToolDefs(
  tools?: readonly ToolDef[],
): OpenAI.Chat.Completions.ChatCompletionTool[] | undefined {
  if (!tools || tools.length === 0) return undefined;
  return tools.map((t) => ({
    type: 'function' as const,
    function: {
      name: t.name,
      description: t.description,
      parameters: t.parameters,
    },
  }));
}

/**
 * Convert our LlmMessage[] to OpenAI's message format.
 * Handles assistant tool_calls and tool result messages properly.
 */
function mapMessages(
  messages: readonly LlmMessage[],
): OpenAI.Chat.Completions.ChatCompletionMessageParam[] {
  const result: OpenAI.Chat.Completions.ChatCompletionMessageParam[] = [];

  for (const msg of messages) {
    if (msg.role === 'assistant' && msg.toolCalls && msg.toolCalls.length > 0) {
      // Assistant message with tool calls
      const assistantMessage: CompatAssistantMessage = {
        role: 'assistant',
        content: msg.content || null,
        tool_calls: msg.toolCalls.map((tc) => ({
          id: tc.id,
          type: 'function' as const,
          function: {
            name: tc.name,
            arguments: JSON.stringify(tc.arguments),
          },
        })),
      };
      if (msg.reasoningContent) {
        assistantMessage.reasoning_content = msg.reasoningContent;
      }
      result.push(assistantMessage);
    } else if (msg.role === 'tool' && msg.toolCallId) {
      // Tool result message
      result.push({
        role: 'tool',
        content: msg.content,
        tool_call_id: msg.toolCallId,
      });
    } else {
      const baseMessage = {
        role: msg.role as 'system' | 'user' | 'assistant',
        content: msg.content,
      };
      if (msg.role === 'assistant' && msg.reasoningContent) {
        result.push({
          ...baseMessage,
          reasoning_content: msg.reasoningContent,
        } as CompatAssistantMessage);
      } else {
        result.push(baseMessage);
      }
    }
  }

  return result;
}

export class OpenAiAdapter implements LlmGateway {
  private client: OpenAI;
  private retryConfig: RetryConfig;
  private providerLabel: string;
  private isCompat: boolean;

  constructor(apiKey: string, options?: OpenAiAdapterOptions) {
    this.client = new OpenAI({
      apiKey,
      baseURL: options?.baseURL,
      defaultHeaders: options?.defaultHeaders,
      dangerouslyAllowBrowser: options?.dangerouslyAllowBrowser,
    });
    this.retryConfig = options?.retryConfig ?? DEFAULT_RETRY_CONFIG;
    this.isCompat = !!options?.baseURL;
    this.providerLabel = this.isCompat ? 'openai-compat' : 'openai';
  }

  async chat(request: LlmRequest): Promise<LlmResponse> {
    return withRetry(
      () => this.doChat(request),
      this.retryConfig,
      (error) => error instanceof LlmError && error.recoverable,
      request.signal,
    );
  }

  private async doChat(request: LlmRequest): Promise<LlmResponse> {
    try {
      const response = await this.client.chat.completions.create(
        {
          model: request.model,
          max_tokens: request.maxTokens ?? 4096,
          temperature: request.temperature,
          messages: mapMessages(request.messages),
          tools: mapToolDefs(request.tools),
        },
        { signal: request.signal, timeout: request.timeoutMs ?? 60_000 },
      );

      return this.mapResponse(response);
    } catch (error: unknown) {
      throw this.mapError(error);
    }
  }

  async *chatStream(request: LlmRequest): AsyncIterable<LlmStreamChunk> {
    yield* await withRetry(
      () => this.doChatStream(request),
      this.retryConfig,
      (error) => error instanceof LlmError && error.recoverable,
      request.signal,
    );
  }

  private async doChatStream(request: LlmRequest): Promise<AsyncGenerator<LlmStreamChunk>> {
    try {
      const stream = await this.client.chat.completions.create(
        {
          model: request.model,
          max_tokens: request.maxTokens ?? 4096,
          temperature: request.temperature,
          messages: mapMessages(request.messages),
          tools: mapToolDefs(request.tools),
          stream: true,
          // stream_options.include_usage is an OpenAI extension;
          // not all compat endpoints support it. When omitted, usage will be undefined.
          ...(this.isCompat ? {} : { stream_options: { include_usage: true } }),
        },
        { signal: request.signal, timeout: request.timeoutMs ?? 120_000 },
      );

      const self = this;
      async function* generate(): AsyncGenerator<LlmStreamChunk> {
        try {
          let finalUsage: LlmUsage | undefined;
          // Accumulate tool calls during streaming
          const streamToolCalls: Map<number, { id: string; name: string; argChunks: string[] }> =
            new Map();

          for await (const chunk of stream) {
            const delta = chunk.choices[0]?.delta as CompatDelta | undefined;
            if (delta?.reasoning_content) {
              yield { reasoning: delta.reasoning_content, done: false };
            }
            if (delta?.content) {
              yield { content: delta.content, done: false };
            }

            // Handle streamed tool_calls
            if (delta?.tool_calls) {
              for (const tc of delta.tool_calls) {
                const existing = streamToolCalls.get(tc.index);
                if (!existing) {
                  streamToolCalls.set(tc.index, {
                    id: tc.id ?? '',
                    name: tc.function?.name ?? '',
                    argChunks: tc.function?.arguments ? [tc.function.arguments] : [],
                  });
                } else {
                  if (tc.id) existing.id = tc.id;
                  if (tc.function?.name) existing.name = tc.function.name;
                  if (tc.function?.arguments) existing.argChunks.push(tc.function.arguments);
                }
              }
            }

            // OpenAI sends usage in the LAST chunk when stream_options.include_usage is true
            if (chunk.usage) {
              finalUsage = {
                inputTokens: chunk.usage.prompt_tokens ?? 0,
                outputTokens: chunk.usage.completion_tokens ?? 0,
              };
            }
          }

          // Build final tool calls
          const toolCalls: ToolCallResult[] = [];
          for (const tc of streamToolCalls.values()) {
            const jsonStr = tc.argChunks.join('');
            try {
              toolCalls.push({
                id: tc.id,
                name: tc.name,
                arguments: jsonStr ? (JSON.parse(jsonStr) as Record<string, unknown>) : {},
              });
            } catch {
              toolCalls.push({ id: tc.id, name: tc.name, arguments: {} });
            }
          }

          yield {
            done: true,
            toolCalls: toolCalls.length > 0 ? toolCalls : undefined,
            usage: finalUsage,
          };
        } catch (error: unknown) {
          throw self.mapError(error);
        }
      }

      return generate();
    } catch (error: unknown) {
      throw this.mapError(error);
    }
  }

  private mapResponse(response: OpenAI.Chat.Completions.ChatCompletion): LlmResponse {
    const choice = response.choices[0];
    const content = choice?.message?.content ?? '';
    const reasoningContent =
      (choice?.message as OpenAI.Chat.Completions.ChatCompletionMessage & {
        reasoning_content?: string | null;
      } | undefined)?.reasoning_content ?? undefined;
    const toolCalls: ToolCallResult[] = [];

    if (choice?.message?.tool_calls) {
      for (const tc of choice.message.tool_calls) {
        if (tc.type === 'function') {
          try {
            toolCalls.push({
              id: tc.id,
              name: tc.function.name,
              arguments: JSON.parse(tc.function.arguments) as Record<string, unknown>,
            });
          } catch {
            // Malformed JSON from LLM — treat as empty arguments
            toolCalls.push({ id: tc.id, name: tc.function.name, arguments: {} });
          }
        }
      }
    }

    return {
      content,
      ...(reasoningContent ? { reasoningContent } : {}),
      toolCalls,
      usage: {
        inputTokens: response.usage?.prompt_tokens ?? 0,
        outputTokens: response.usage?.completion_tokens ?? 0,
      },
    };
  }

  dispose(): void {
    // Stateless HTTP adapter — nothing to release.
  }

  private mapError(error: unknown): LlmError {
    if (error instanceof OpenAI.APIError) {
      return new LlmError(error.message, this.providerLabel, error.status);
    }
    return new LlmError(
      error instanceof Error ? error.message : `Unknown ${this.providerLabel} error`,
      this.providerLabel,
    );
  }
}
