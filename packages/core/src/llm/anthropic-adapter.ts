import Anthropic from '@anthropic-ai/sdk';
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
import { DEFAULT_RETRY_CONFIG, type RetryConfig, withRetry } from './retry.js';

export interface AnthropicAdapterOptions {
  /** Custom base URL for Anthropic-compatible providers (e.g. MiniMax) */
  baseURL?: string;
  /** Extra headers for Anthropic-compatible proxying in browser dev mode */
  defaultHeaders?: Record<string, string>;
  retryConfig?: RetryConfig;
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
function mapToolDefs(tools?: readonly ToolDef[]): Anthropic.Tool[] | undefined {
  if (!tools || tools.length === 0) return undefined;
  return tools.map((t) => ({
    name: t.name,
    description: t.description,
    input_schema: t.parameters as Anthropic.Tool.InputSchema,
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
function mapMessages(messages: readonly LlmMessage[]): Anthropic.MessageParam[] {
  const result: Anthropic.MessageParam[] = [];

  for (const msg of messages) {
    if (msg.role === 'system') continue; // system handled separately

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
      result.push({ role: 'assistant', content });
    } else if (msg.role === 'tool' && msg.toolCallId) {
      // Tool result message → Anthropic uses role: 'user' with tool_result block
      result.push({
        role: 'user',
        content: [
          {
            type: 'tool_result',
            tool_use_id: msg.toolCallId,
            content: msg.content,
          },
        ],
      });
    } else {
      result.push({
        role: msg.role as 'user' | 'assistant',
        content: msg.content,
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
    const systemMessages = request.messages.filter((m) => m.role === 'system');
    const systemText = systemMessages.map((m) => m.content).join('\n');

    try {
      const response = await this.client.messages.create(
        {
          model: request.model,
          max_tokens: request.maxTokens ?? 4096,
          temperature: request.temperature,
          system: systemText || undefined,
          messages: mapMessages(request.messages),
          tools: mapToolDefs(request.tools),
          ...(request.toolChoice ? { tool_choice: mapToolChoice(request.toolChoice) } : {}),
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
    const systemMessages = request.messages.filter((m) => m.role === 'system');
    const systemText = systemMessages.map((m) => m.content).join('\n');

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
          system: systemText || undefined,
          messages: mapMessages(request.messages),
          tools: mapToolDefs(request.tools),
          ...(request.toolChoice ? { tool_choice: mapToolChoice(request.toolChoice) } : {}),
          stream: true,
        },
        { signal: request.signal, timeout: request.timeoutMs ?? 120_000 },
      );

      const mapErr = this.mapError.bind(this);
      async function* generate(): AsyncGenerator<LlmStreamChunk> {
        try {
          const streamToolCalls: Map<number, { id: string; name: string; jsonChunks: string[] }> =
            new Map();
          let inputTokens = 0;
          let outputTokens = 0;

          for await (const event of stream) {
            if (event.type === 'message_start') {
              inputTokens = event.message.usage.input_tokens;
              outputTokens = event.message.usage.output_tokens;
            } else if (event.type === 'message_delta') {
              outputTokens = event.usage.output_tokens;
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
            usage: { inputTokens, outputTokens },
          };
        } catch (error: unknown) {
          throw mapErr(error);
        }
      }

      return generate();
    } catch (error: unknown) {
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
      },
    };
  }

  dispose(): void {
    // Stateless HTTP adapter — nothing to release.
  }

  private mapError(error: unknown): LlmError {
    if (error instanceof Anthropic.APIError) {
      return new LlmError(error.message, 'anthropic', error.status, { cause: error });
    }
    return new LlmError(
      error instanceof Error ? error.message : 'Unknown Anthropic error',
      'anthropic',
      undefined,
      { cause: error },
    );
  }
}
