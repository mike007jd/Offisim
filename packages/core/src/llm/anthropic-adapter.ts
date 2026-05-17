import Anthropic from '@anthropic-ai/sdk';
import { PROMPT_CACHE_VOLATILE_MARKER } from '../agents/employee-prompt-assembly.js';
import { LlmError } from '../errors.js';
import type {
  LlmGateway,
  LlmMessage,
  LlmRequest,
  LlmResponse,
  LlmStreamChunk,
  ToolCallResult,
  ToolDef,
} from './gateway.js';
import { createScopedRequestSignal } from './request-timeout.js';
import { DEFAULT_RETRY_CONFIG, type RetryConfig, withRetry } from './retry.js';

export interface AnthropicAdapterOptions {
  /** Custom base URL for Anthropic-compatible providers (e.g. MiniMax) */
  baseURL?: string;
  /** Extra headers for Anthropic-compatible proxying in browser dev mode */
  defaultHeaders?: Record<string, string>;
  retryConfig?: RetryConfig;
  supportsPromptCaching?: boolean;
  streamIdleTimeoutMs?: number;
  /** Allow browser-side API calls (required for apps/web and Tauri desktop) */
  dangerouslyAllowBrowser?: boolean;
  /**
   * Custom fetch implementation. When set, the SDK is constructed with this
   * transport and the legacy `createCorsCleanFetch` / third-party Bearer
   * compat header shim is skipped — the injected fetch is expected to handle
   * auth + telemetry-header stripping itself (Tauri's Rust transport does).
   */
  fetch?: typeof fetch;
}

/** Convert our ToolDef to Anthropic's tool format */
type AnthropicCacheControl = { type: 'ephemeral' };

function cacheControl(): AnthropicCacheControl {
  return { type: 'ephemeral' };
}

function mapToolDefs(
  tools?: readonly ToolDef[],
  supportsPromptCaching = false,
): Anthropic.Tool[] | undefined {
  if (!tools || tools.length === 0) return undefined;
  return tools.map((t, index) => ({
    name: t.name,
    description: t.description,
    input_schema: t.parameters as Anthropic.Tool.InputSchema,
    ...(supportsPromptCaching && index === tools.length - 1
      ? { cache_control: cacheControl() }
      : {}),
  }));
}

function mapToolChoice(choice: LlmRequest['toolChoice']): Anthropic.ToolChoice | undefined {
  if (!choice) return undefined;
  if (choice === 'auto' || choice === 'none') return { type: choice };
  return { type: 'tool', name: choice.name };
}

/**
 * Convert our LlmMessage[] to Anthropic's message format.
 * Handles assistant tool_use and tool result messages properly.
 */
function cacheableMessageIndex(messages: readonly LlmMessage[]): number {
  // Mirror ClaudeSource `addCacheBreakpoints`: place the rolling breakpoint on
  // the last stable message (second-to-last, so the newest turn stays an
  // uncached fresh suffix) WITHOUT skipping tool_use / tool_result messages.
  // Those are stable history; skipping them collapses the cached prefix to an
  // early message in tool loops, which is the dominant agent path — defeating
  // the cache entirely.
  for (let index = messages.length - 2; index >= 0; index -= 1) {
    const message = messages[index];
    if (!message || message.role === 'system') continue;
    const hasToolCalls =
      message.role === 'assistant' && !!message.toolCalls && message.toolCalls.length > 0;
    const isToolResult = message.role === 'tool';
    // Plain text blocks must be non-empty for Anthropic to accept cache_control.
    if (!hasToolCalls && !isToolResult && message.content.trim().length === 0) continue;
    return index;
  }
  return -1;
}

function appendCacheControl(blocks: Anthropic.ContentBlockParam[]): void {
  const last = blocks[blocks.length - 1];
  if (!last) return;
  (last as { cache_control?: AnthropicCacheControl }).cache_control = cacheControl();
}

/**
 * Collect text from the full error surface: message + cause chain + parsed
 * error body. Used so overloaded/capacity detection sees the real body even
 * when the SDK wraps it in a generic `APIConnectionError`.
 */
function extractAnthropicErrorText(error: unknown, depth = 0): string {
  if (error === null || error === undefined || depth > 4) return '';
  if (typeof error === 'string') return error;
  if (typeof error !== 'object') return String(error);
  const record = error as Record<string, unknown>;
  const parts: string[] = [];
  if (typeof record.message === 'string') parts.push(record.message);
  for (const key of ['error', 'body', 'response'] as const) {
    const value = record[key];
    if (typeof value === 'string') parts.push(value);
    else if (value && typeof value === 'object') {
      try {
        parts.push(JSON.stringify(value));
      } catch {
        // ignore non-serializable
      }
    }
  }
  if (record.cause && record.cause !== error) {
    parts.push(extractAnthropicErrorText(record.cause, depth + 1));
  }
  return parts.join(' ');
}

/**
 * Honor the server `x-should-retry` directive. `'true'` → recoverable,
 * `'false'` → explicitly non-retryable (overrides status/heuristic).
 */
function readShouldRetryHeader(error: unknown): boolean | undefined {
  if (!error || typeof error !== 'object') return undefined;
  const headers = (error as { headers?: unknown }).headers;
  if (!headers) return undefined;
  let raw: string | null | undefined;
  if (typeof (headers as { get?: unknown }).get === 'function') {
    raw = (headers as { get(name: string): string | null }).get('x-should-retry');
  } else if (typeof headers === 'object') {
    const entry = Object.entries(headers as Record<string, unknown>).find(
      ([key]) => key.toLowerCase() === 'x-should-retry',
    );
    raw = entry ? String(entry[1]) : undefined;
  }
  if (raw === 'true') return true;
  if (raw === 'false') return false;
  return undefined;
}

function textContent(text: string, cached: boolean): Anthropic.ContentBlockParam[] | string {
  if (!cached) return text;
  return [{ type: 'text', text, cache_control: cacheControl() } as Anthropic.TextBlockParam];
}

function mapMessages(
  messages: readonly LlmMessage[],
  supportsPromptCaching = false,
): Anthropic.MessageParam[] {
  const result: Anthropic.MessageParam[] = [];
  const cachedMessageIndex = supportsPromptCaching ? cacheableMessageIndex(messages) : -1;

  for (const [index, msg] of messages.entries()) {
    if (msg.role === 'system') continue; // system handled separately
    const cached = index === cachedMessageIndex;

    if (msg.role === 'assistant' && msg.toolCalls && msg.toolCalls.length > 0) {
      // Assistant message with tool calls → content blocks
      const content: Anthropic.ContentBlockParam[] = [];
      if (msg.content) {
        content.push({ type: 'text', text: msg.content });
      }
      for (const tc of msg.toolCalls) {
        content.push({
          type: 'tool_use',
          id: tc.id,
          name: tc.name,
          input: tc.arguments,
        });
      }
      if (cached) appendCacheControl(content);
      result.push({ role: 'assistant', content });
    } else if (msg.role === 'tool' && msg.toolCallId) {
      // Tool result message → Anthropic uses role: 'user' with tool_result block
      const toolResultContent: Anthropic.ContentBlockParam[] = [
        {
          type: 'tool_result',
          tool_use_id: msg.toolCallId,
          content: msg.content,
        },
      ];
      if (cached) appendCacheControl(toolResultContent);
      result.push({
        role: 'user',
        content: toolResultContent,
      });
    } else {
      result.push({
        role: msg.role as 'user' | 'assistant',
        content: textContent(msg.content, cached),
      });
    }
  }

  return result;
}

// Third-party Anthropic-compatible endpoints (MiniMax, etc.) typically do not
// whitelist the Stainless SDK telemetry headers, `x-api-key`, or
// `anthropic-version` in their CORS allow-list, so browser calls would fail
// at the CORS preflight stage. We apply two layers:
// 1. `defaultHeaders` with null-delete semantics for the known non-CORS-safe
//    headers (`x-api-key`, `anthropic-version`, browser-access flag) and use
//    `Authorization: Bearer` for auth instead.
// 2. A custom `fetch` wrapper that strips any header matching `/^x-stainless-/i`
//    right before the request fires. This denylist approach is future-proof:
//    if the SDK adds new x-stainless-* telemetry headers in a later version
//    they are automatically removed, rather than silently leaking and breaking
//    CORS preflight.
function buildBrowserCompatHeaders(apiKey: string): Record<string, string | null> {
  return {
    Authorization: `Bearer ${apiKey}`,
    'x-api-key': null,
    'anthropic-version': null,
    'anthropic-dangerous-direct-browser-access': null,
  };
}

function createCorsCleanFetch(): typeof globalThis.fetch {
  return (input, init) => {
    if (init?.headers) {
      const headers = new Headers(init.headers as HeadersInit);
      const toDelete: string[] = [];
      headers.forEach((_value, key) => {
        if (/^x-stainless-/i.test(key)) toDelete.push(key);
      });
      for (const key of toDelete) headers.delete(key);
      return globalThis.fetch(input, { ...init, headers });
    }
    return globalThis.fetch(input, init);
  };
}

function isThirdPartyAnthropicEndpoint(baseURL: string | undefined): boolean {
  if (!baseURL) return false;
  try {
    return !new URL(baseURL).host.endsWith('api.anthropic.com');
  } catch (e) {
    console.warn(
      '[AnthropicAdapter] Could not parse baseURL for third-party detection:',
      baseURL,
      e,
    );
    return false;
  }
}

export class AnthropicAdapter implements LlmGateway {
  private client: Anthropic;
  private retryConfig: RetryConfig;
  private supportsPromptCaching: boolean;
  private streamIdleTimeoutMs: number;

  constructor(apiKey: string, options?: AnthropicAdapterOptions) {
    const hasInjectedFetch = typeof options?.fetch === 'function';
    const isThirdParty = isThirdPartyAnthropicEndpoint(options?.baseURL);
    // When a Tauri-side (or other) transport has been injected it rewrites
    // Authorization from Keychain, so the browser-CORS compat shim is not
    // only unnecessary but counter-productive (TS sends `Bearer ignored`
    // which the Rust side strips; we also want `x-api-key` / the Stainless
    // telemetry headers to reach the native endpoint untouched).
    const browserCompatHeaders =
      !hasInjectedFetch && isThirdParty ? buildBrowserCompatHeaders(apiKey) : undefined;
    const mergedHeaders =
      browserCompatHeaders || options?.defaultHeaders
        ? { ...browserCompatHeaders, ...options?.defaultHeaders }
        : undefined;

    this.client = new Anthropic({
      apiKey,
      baseURL: options?.baseURL,
      // Cast: `@anthropic-ai/sdk` accepts `null` values in defaultHeaders
      // (see internal/headers.js buildHeaders) to delete headers, but the
      // exported type is `Record<string, string>`.
      defaultHeaders: mergedHeaders as Record<string, string> | undefined,
      dangerouslyAllowBrowser: options?.dangerouslyAllowBrowser,
      // Transport precedence: injected fetch > third-party CORS shim > SDK default.
      ...(hasInjectedFetch
        ? { fetch: options?.fetch }
        : isThirdParty
          ? { fetch: createCorsCleanFetch() }
          : {}),
    });
    this.retryConfig = options?.retryConfig ?? DEFAULT_RETRY_CONFIG;
    this.supportsPromptCaching = options?.supportsPromptCaching ?? !isThirdParty;
    this.streamIdleTimeoutMs = options?.streamIdleTimeoutMs ?? 60_000;
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
    const system = this.mapSystemPrompt(request.messages);
    const timeoutMs = request.timeoutMs ?? 60_000;
    const scoped = createScopedRequestSignal(request.signal, timeoutMs, 'anthropic');

    try {
      const response = await this.client.messages.create(
        {
          model: request.model,
          max_tokens: request.maxTokens ?? 4096,
          temperature: request.temperature,
          system,
          messages: mapMessages(request.messages, this.supportsPromptCaching),
          tools: mapToolDefs(request.tools, this.supportsPromptCaching),
          ...(request.toolChoice ? { tool_choice: mapToolChoice(request.toolChoice) } : {}),
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
    yield* await withRetry(
      () => this.doChatStream(request),
      this.retryConfig,
      (error) => error instanceof LlmError && error.recoverable,
      request.signal,
    );
  }

  private async doChatStream(request: LlmRequest): Promise<AsyncGenerator<LlmStreamChunk>> {
    const system = this.mapSystemPrompt(request.messages);
    const timeoutMs = request.timeoutMs ?? 120_000;
    const scoped = createScopedRequestSignal(request.signal, timeoutMs, 'anthropic');

    try {
      // Use `messages.create({ stream: true })` instead of the `messages.stream()`
      // helper. The helper hard-injects `X-Stainless-Helper-Method: 'stream'`
      // into the last slot of the SDK's header merge chain, which overrides any
      // null-delete we set in defaultHeaders and trips CORS preflight on
      // third-party Anthropic-compatible endpoints whose allow-list does not
      // include Stainless telemetry headers. We accumulate usage from
      // message_start / message_delta events ourselves to replace
      // stream.finalMessage().
      const stream = await this.client.messages.create(
        {
          model: request.model,
          max_tokens: request.maxTokens ?? 4096,
          temperature: request.temperature,
          system,
          messages: mapMessages(request.messages, this.supportsPromptCaching),
          tools: mapToolDefs(request.tools, this.supportsPromptCaching),
          ...(request.toolChoice ? { tool_choice: mapToolChoice(request.toolChoice) } : {}),
          stream: true,
        },
        { signal: scoped.signal, timeout: timeoutMs },
      );

      const mapErr = this.mapError.bind(this);
      const idleTimeoutMs = this.streamIdleTimeoutMs;
      async function* generate(): AsyncGenerator<LlmStreamChunk> {
        try {
          const streamToolCalls: Map<number, { id: string; name: string; jsonChunks: string[] }> =
            new Map();
          const iterator = stream[Symbol.asyncIterator]();
          let inputTokens = 0;
          let outputTokens = 0;
          let cacheReadInputTokens = 0;
          let cacheCreationInputTokens = 0;
          let stopReason: LlmResponse['stopReason'];

          while (true) {
            const next = await nextStreamEvent(iterator, idleTimeoutMs);
            if (next.done) break;
            const event = next.value;
            if (event.type === 'message_start') {
              inputTokens = event.message.usage.input_tokens;
              outputTokens = event.message.usage.output_tokens;
              cacheReadInputTokens = event.message.usage.cache_read_input_tokens ?? 0;
              cacheCreationInputTokens = event.message.usage.cache_creation_input_tokens ?? 0;
            } else if (event.type === 'message_delta') {
              outputTokens = event.usage.output_tokens;
              cacheReadInputTokens = event.usage.cache_read_input_tokens ?? cacheReadInputTokens;
              cacheCreationInputTokens =
                event.usage.cache_creation_input_tokens ?? cacheCreationInputTokens;
              stopReason = mapAnthropicStopReason(event.delta.stop_reason ?? null);
            } else if (
              event.type === 'content_block_delta' &&
              event.delta.type === 'thinking_delta'
            ) {
              yield { reasoning: event.delta.thinking, done: false };
            } else if (event.type === 'content_block_delta' && event.delta.type === 'text_delta') {
              yield { content: event.delta.text, done: false };
            } else if (
              event.type === 'content_block_start' &&
              event.content_block.type === 'tool_use'
            ) {
              streamToolCalls.set(event.index, {
                id: event.content_block.id,
                name: event.content_block.name,
                jsonChunks: [],
              });
            } else if (
              event.type === 'content_block_delta' &&
              event.delta.type === 'input_json_delta'
            ) {
              const tc = streamToolCalls.get(event.index);
              if (tc) tc.jsonChunks.push(event.delta.partial_json);
            }
          }

          const toolCalls: ToolCallResult[] = [];
          for (const tc of streamToolCalls.values()) {
            const jsonStr = tc.jsonChunks.join('');
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
            usage: { inputTokens, outputTokens, cacheReadInputTokens, cacheCreationInputTokens },
            stopReason,
          };
        } catch (error: unknown) {
          throw mapErr(error);
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

  private mapResponse(response: Anthropic.Message): LlmResponse {
    let content = '';
    const toolCalls: ToolCallResult[] = [];

    for (const block of response.content) {
      if (block.type === 'text') {
        content += block.text;
      } else if (block.type === 'tool_use') {
        toolCalls.push({
          id: block.id,
          name: block.name,
          arguments: block.input as Record<string, unknown>,
        });
      }
    }

    return {
      content,
      toolCalls,
      usage: {
        inputTokens: response.usage.input_tokens,
        outputTokens: response.usage.output_tokens,
        cacheReadInputTokens: response.usage.cache_read_input_tokens ?? 0,
        cacheCreationInputTokens: response.usage.cache_creation_input_tokens ?? 0,
      },
      stopReason: mapAnthropicStopReason(response.stop_reason),
    };
  }

  dispose(): void {
    // Stateless HTTP adapter — nothing to release.
  }

  private mapError(error: unknown): LlmError {
    // Inspect the FULL error surface (message + cause chain + nested body),
    // not just `error.message`. The SDK wraps mid-stream/transport failures as
    // `APIConnectionError` with a generic message and the real overloaded body
    // in `cause`/`error` — checking only message after the APIError branch made
    // capacity detection dead code (capacity fallback never triggered).
    const surfaceText = extractAnthropicErrorText(error);
    const isOverloaded =
      /overloaded_error|overloaded|capacity|server is busy|temporar(?:y|ily) unavailable|rate limit/i.test(
        surfaceText,
      );
    const shouldRetry = readShouldRetryHeader(error);

    if (error instanceof Anthropic.APIError) {
      const status = error.status ?? (isOverloaded ? 529 : undefined);
      return new LlmError(error.message || surfaceText || 'Anthropic API error', 'anthropic', status, {
        cause: error,
        ...(shouldRetry !== undefined ? { shouldRetry } : {}),
      });
    }
    const message = error instanceof Error ? error.message : 'Unknown Anthropic error';
    if (isOverloaded) {
      return new LlmError(message, 'anthropic', 529, { cause: error });
    }
    return new LlmError(message, 'anthropic', undefined, {
      cause: error,
      ...(shouldRetry !== undefined ? { shouldRetry } : {}),
    });
  }

  private mapSystemPrompt(messages: readonly LlmMessage[]):
    | string
    | Anthropic.TextBlockParam[]
    | undefined {
    const systemText = messages
      .filter((m) => m.role === 'system')
      .map((m) => m.content)
      .join('\n');
    if (!systemText) return undefined;
    const cleanSystemText = systemText.replaceAll(PROMPT_CACHE_VOLATILE_MARKER, '').trim();
    if (!this.supportsPromptCaching) return cleanSystemText;
    const [stablePrefix, ...volatileParts] = systemText.split(PROMPT_CACHE_VOLATILE_MARKER);
    const blocks: Anthropic.TextBlockParam[] = [];
    const stableText = (stablePrefix ?? '').trim();
    const volatileText = volatileParts.join(PROMPT_CACHE_VOLATILE_MARKER).trim();
    if (stableText) {
      blocks.push({ type: 'text', text: stableText, cache_control: cacheControl() } as Anthropic.TextBlockParam);
    }
    if (volatileText) {
      blocks.push({ type: 'text', text: volatileText } as Anthropic.TextBlockParam);
    }
    return blocks.length > 0 ? blocks : undefined;
  }
}

function mapAnthropicStopReason(reason: Anthropic.Message['stop_reason']): LlmResponse['stopReason'] {
  switch (reason) {
    case 'end_turn':
    case 'tool_use':
    case 'max_tokens':
    case 'stop_sequence':
      return reason;
    case 'refusal':
      return 'refusal';
    default:
      return 'unknown';
  }
}

async function nextStreamEvent<T>(
  iterator: AsyncIterator<T>,
  idleTimeoutMs: number,
): Promise<IteratorResult<T>> {
  let timeout: ReturnType<typeof setTimeout> | undefined;
  try {
    return await Promise.race([
      iterator.next(),
      new Promise<IteratorResult<T>>((_resolve, reject) => {
        timeout = setTimeout(() => {
          reject(
            new LlmError(
              `Anthropic stream idle timeout after ${idleTimeoutMs}ms.`,
              'anthropic',
              undefined,
            ),
          );
        }, idleTimeoutMs);
      }),
    ]);
  } catch (error) {
    await iterator.return?.();
    throw error;
  } finally {
    if (timeout) clearTimeout(timeout);
  }
}
