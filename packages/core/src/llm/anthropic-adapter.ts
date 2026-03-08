import Anthropic from '@anthropic-ai/sdk';
import { LlmError } from '../errors.js';
import type { LlmGateway, LlmRequest, LlmResponse, LlmStreamChunk, ToolCallResult } from './gateway.js';
import { withRetry, DEFAULT_RETRY_CONFIG, type RetryConfig } from './retry.js';

export interface AnthropicAdapterOptions {
  retryConfig?: RetryConfig;
}

export class AnthropicAdapter implements LlmGateway {
  private client: Anthropic;
  private retryConfig: RetryConfig;

  constructor(apiKey: string, options?: AnthropicAdapterOptions) {
    this.client = new Anthropic({ apiKey });
    this.retryConfig = options?.retryConfig ?? DEFAULT_RETRY_CONFIG;
  }

  async chat(request: LlmRequest): Promise<LlmResponse> {
    return withRetry(
      () => this.doChat(request),
      this.retryConfig,
      (error) => error instanceof LlmError && error.recoverable,
    );
  }

  private async doChat(request: LlmRequest): Promise<LlmResponse> {
    const systemMessages = request.messages.filter((m) => m.role === 'system');
    const nonSystemMessages = request.messages.filter((m) => m.role !== 'system');
    const systemText = systemMessages.map((m) => m.content).join('\n');

    try {
      const response = await this.client.messages.create({
        model: request.model,
        max_tokens: request.maxTokens ?? 4096,
        temperature: request.temperature,
        system: systemText || undefined,
        messages: nonSystemMessages.map((m) => ({
          role: m.role as 'user' | 'assistant',
          content: m.content,
        })),
      });

      return this.mapResponse(response);
    } catch (error: unknown) {
      throw this.mapError(error);
    }
  }

  async *chatStream(request: LlmRequest): AsyncIterable<LlmStreamChunk> {
    // Retry wraps the entire stream creation. Once tokens start flowing,
    // a mid-stream failure is non-retryable (throw immediately).
    const self = this;
    yield* await withRetry(
      () => self.doChatStream(request),
      this.retryConfig,
      (error) => error instanceof LlmError && error.recoverable,
    );
  }

  private async doChatStream(request: LlmRequest): Promise<AsyncGenerator<LlmStreamChunk>> {
    const systemMessages = request.messages.filter((m) => m.role === 'system');
    const nonSystemMessages = request.messages.filter((m) => m.role !== 'system');
    const systemText = systemMessages.map((m) => m.content).join('\n');

    try {
      const stream = this.client.messages.stream({
        model: request.model,
        max_tokens: request.maxTokens ?? 4096,
        temperature: request.temperature,
        system: systemText || undefined,
        messages: nonSystemMessages.map((m) => ({
          role: m.role as 'user' | 'assistant',
          content: m.content,
        })),
      });

      const self = this;
      async function* generate(): AsyncGenerator<LlmStreamChunk> {
        try {
          for await (const event of stream) {
            if (event.type === 'content_block_delta' && event.delta.type === 'text_delta') {
              yield { content: event.delta.text, done: false };
            }
          }

          const finalMessage = await stream.finalMessage();
          yield {
            done: true,
            usage: {
              inputTokens: finalMessage.usage.input_tokens,
              outputTokens: finalMessage.usage.output_tokens,
            },
          };
        } catch (error: unknown) {
          // Mid-stream failure is non-retryable
          throw self.mapError(error);
        }
      }

      return generate();
    } catch (error: unknown) {
      // Connection-level failure before stream starts — retryable via withRetry
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
