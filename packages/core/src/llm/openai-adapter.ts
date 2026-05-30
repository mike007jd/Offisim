import OpenAI from 'openai';
import { PROMPT_CACHE_VOLATILE_MARKER } from '../agents/employee-prompt-assembly.js';
import { LlmError } from '../errors.js';
import { extractErrorText, isCapacityErrorText } from './error-utils.js';
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
import { createScopedRequestSignal } from './request-timeout.js';
import { DEFAULT_RETRY_CONFIG, type RetryConfig, withRetry } from './retry.js';

export interface OpenAiAdapterOptions {
  /** Custom base URL for OpenAI-compatible endpoints (e.g. OpenRouter, Kimi, Gemini compat) */
  baseURL?: string;
  /** Extra headers sent with every request (e.g. HTTP-Referer for OpenRouter) */
  defaultHeaders?: Record<string, string>;
  retryConfig?: RetryConfig;
  /** Allow browser-side API calls (required for the Tauri WebView) */
  dangerouslyAllowBrowser?: boolean;
  /**
   * Custom fetch implementation. When set, the OpenAI SDK client is
   * constructed with this transport — Tauri desktop uses this to tunnel
   * outbound traffic through the Rust-side `llm_fetch` command so the
   * credential never enters the webview.
   */
  fetch?: typeof fetch;
}

type CompatAssistantMessage = OpenAI.Chat.Completions.ChatCompletionAssistantMessageParam & {
  reasoning_content?: string | null;
};

type CompatDelta = {
  content?: string | null;
  reasoning_content?: string | null;
  tool_calls?: OpenAI.Chat.Completions.ChatCompletionChunk.Choice.Delta.ToolCall[];
};

/**
 * Sleep that rejects with AbortError immediately when the signal aborts,
 * instead of completing the full timeout window. Used by chatStream's retry
 * backoff so user Stop doesn't have to wait out a 30s delay.
 */
function abortableSleep(ms: number, signal: AbortSignal | undefined): Promise<void> {
  if (signal?.aborted) {
    return Promise.reject(new DOMException('Aborted', 'AbortError'));
  }
  return new Promise<void>((resolve, reject) => {
    const onAbort = () => {
      clearTimeout(timer);
      reject(new DOMException('Aborted', 'AbortError'));
    };
    const timer = setTimeout(() => {
      signal?.removeEventListener('abort', onAbort);
      resolve();
    }, ms);
    signal?.addEventListener('abort', onAbort, { once: true });
  });
}

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

function mapToolChoice(
  choice: LlmRequest['toolChoice'],
): OpenAI.Chat.Completions.ChatCompletionToolChoiceOption | undefined {
  if (!choice) return undefined;
  if (choice === 'auto' || choice === 'none') return choice;
  return {
    type: 'function',
    function: { name: choice.name },
  };
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
        content:
          msg.role === 'system'
            ? msg.content.replaceAll(PROMPT_CACHE_VOLATILE_MARKER, '').trim()
            : msg.content,
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
      // The custom withRetry loop is the single source of truth for retry policy
      // (Retry-After, jitter, abortable backoff, x-should-retry). Disable the
      // SDK's built-in retries so the two layers don't stack into retry storms.
      maxRetries: 0,
      ...(typeof options?.fetch === 'function' ? { fetch: options.fetch } : {}),
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
    const timeoutMs = request.timeoutMs ?? 60_000;
    const scoped = createScopedRequestSignal(request.signal, timeoutMs, this.providerLabel);
    try {
      const response = await this.client.chat.completions.create(
        {
          model: request.model,
          max_tokens: request.maxTokens ?? 4096,
          temperature: request.temperature,
          messages: mapMessages(request.messages),
          tools: mapToolDefs(request.tools),
          tool_choice: mapToolChoice(request.toolChoice),
        },
        { signal: scoped.signal, timeout: timeoutMs },
      );

      return this.mapResponse(response);
    } catch (error: unknown) {
      throw this.mapError(error);
    } finally {
      scoped.cleanup();
    }
  }

  async *chatStream(request: LlmRequest): AsyncIterable<LlmStreamChunk> {
    // Single retry boundary that covers both HTTP setup (Promise resolution)
    // AND SSE consumption (idle timeout, mid-stream disconnect). We previously
    // wrapped this in withRetry, which itself retries — making the worst case
    // (maxRetries+1)². The doChatStream call is now inside the try, so setup
    // errors and mid-stream errors share the same retry budget.
    //
    // Stop retrying once any visible chunk has been forwarded — re-running
    // would duplicate output. Node-level recovery still applies after that.
    const config = this.retryConfig;
    let attempt = 0;
    while (true) {
      let emittedVisibleChunk = false;
      try {
        const stream = await this.doChatStream(request);
        for await (const chunk of stream) {
          if (chunk.content || chunk.reasoning || chunk.toolCalls || chunk.done) {
            emittedVisibleChunk = true;
          }
          yield chunk;
        }
        return;
      } catch (err) {
        if (emittedVisibleChunk) throw err;
        if (!(err instanceof LlmError) || !err.recoverable) throw err;
        if (attempt >= config.maxRetries) throw err;
        attempt += 1;
        const delayMs = Math.min(config.baseDelayMs * 2 ** (attempt - 1), config.maxDelayMs);
        await abortableSleep(delayMs, request.signal);
      }
    }
  }

  private async doChatStream(request: LlmRequest): Promise<AsyncGenerator<LlmStreamChunk>> {
    const timeoutMs = request.timeoutMs ?? 120_000;
    const scoped = createScopedRequestSignal(request.signal, timeoutMs, this.providerLabel);
    try {
      const stream = await this.client.chat.completions.create(
        {
          model: request.model,
          max_tokens: request.maxTokens ?? 4096,
          temperature: request.temperature,
          messages: mapMessages(request.messages),
          tools: mapToolDefs(request.tools),
          tool_choice: mapToolChoice(request.toolChoice),
          stream: true,
          // include_usage is unconditional: MiniMax/OpenRouter/together/groq/fireworks all support it.
          // teeStream's `if (chunk.usage)` already guards providers that ignore the option.
          stream_options: { include_usage: true },
        },
        { signal: scoped.signal, timeout: timeoutMs },
      );

      const self = this;
      async function* generate(): AsyncGenerator<LlmStreamChunk> {
        try {
          let finalUsage: LlmUsage | undefined;
          let stopReason: LlmResponse['stopReason'];
          // Accumulate tool calls during streaming
          const streamToolCalls: Map<number, { id: string; name: string; argChunks: string[] }> =
            new Map();

          for await (const chunk of stream) {
            const delta = chunk.choices[0]?.delta as CompatDelta | undefined;
            const finishReason = chunk.choices[0]?.finish_reason;
            if (finishReason) stopReason = mapFinishReason(finishReason);
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
            stopReason,
          };
        } catch (error: unknown) {
          throw self.mapError(error);
        } finally {
          scoped.cleanup();
        }
      }

      return generate();
    } catch (error: unknown) {
      scoped.cleanup();
      throw this.mapError(error);
    }
  }

  private mapResponse(response: OpenAI.Chat.Completions.ChatCompletion): LlmResponse {
    const choice = response.choices[0];
    const content = choice?.message?.content ?? '';
    const reasoningContent =
      (
        choice?.message as
          | (OpenAI.Chat.Completions.ChatCompletionMessage & {
              reasoning_content?: string | null;
            })
          | undefined
      )?.reasoning_content ?? undefined;
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
      stopReason: mapFinishReason(choice?.finish_reason),
    };
  }

  dispose(): void {
    // Stateless HTTP adapter — nothing to release.
  }

  private mapError(error: unknown): LlmError {
    const baseStatus = error instanceof OpenAI.APIError ? error.status : undefined;
    const baseMessage =
      error instanceof OpenAI.APIError
        ? error.message
        : error instanceof Error
          ? error.message
          : `Unknown ${this.providerLabel} error`;

    // Compat providers like MiniMax surface overloaded with HTTP 200 + a body
    // string that the SDK can't easily decode. Without lifting the status to
    // 529, `isCapacityError` would miss it and `callWithCapacityFallback`
    // would never trigger a fallback model.
    const surfaceText = extractErrorText(error);
    if (isCapacityErrorText(surfaceText) || isCapacityErrorText(baseMessage)) {
      return new LlmError(baseMessage, this.providerLabel, 529, { cause: error });
    }
    return new LlmError(baseMessage, this.providerLabel, baseStatus, { cause: error });
  }
}

function mapFinishReason(reason: string | null | undefined): LlmResponse['stopReason'] {
  switch (reason) {
    case 'stop':
      return 'end_turn';
    case 'tool_calls':
    case 'function_call':
      return 'tool_use';
    case 'length':
      return 'max_tokens';
    case 'content_filter':
      return 'refusal';
    default:
      return 'unknown';
  }
}
