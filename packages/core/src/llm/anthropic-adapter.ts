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
  retryConfig?: RetryConfig;
  /** Allow browser-side API calls (required for apps/web and Tauri desktop) */
  dangerouslyAllowBrowser?: boolean;
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

export class AnthropicAdapter implements LlmGateway {
  private client: Anthropic;
  private retryConfig: RetryConfig;

  constructor(apiKey: string, options?: AnthropicAdapterOptions) {
    this.client = new Anthropic({
      apiKey,
      dangerouslyAllowBrowser: options?.dangerouslyAllowBrowser,
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
      const stream = this.client.messages.stream(
        {
          model: request.model,
          max_tokens: request.maxTokens ?? 4096,
          temperature: request.temperature,
          system: systemText || undefined,
          messages: mapMessages(request.messages),
          tools: mapToolDefs(request.tools),
        },
        { signal: request.signal, timeout: request.timeoutMs ?? 120_000 },
      );

      const self = this;
      async function* generate(): AsyncGenerator<LlmStreamChunk> {
        try {
          // Accumulate tool calls during streaming
          const streamToolCalls: Map<number, { id: string; name: string; jsonChunks: string[] }> =
            new Map();

          for await (const event of stream) {
            if (event.type === 'content_block_delta' && event.delta.type === 'text_delta') {
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

          // Build final tool calls from accumulated chunks
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

          const finalMessage = await stream.finalMessage();
          yield {
            done: true,
            toolCalls: toolCalls.length > 0 ? toolCalls : undefined,
            usage: {
              inputTokens: finalMessage.usage.input_tokens,
              outputTokens: finalMessage.usage.output_tokens,
            },
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
      return new LlmError(error.message, 'anthropic', error.status);
    }
    return new LlmError(
      error instanceof Error ? error.message : 'Unknown Anthropic error',
      'anthropic',
    );
  }
}
