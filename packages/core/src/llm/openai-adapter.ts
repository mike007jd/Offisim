import OpenAI from 'openai';
import { LlmError } from '../errors.js';
import type { LlmGateway, LlmRequest, LlmResponse, LlmStreamChunk, LlmUsage, ToolCallResult } from './gateway.js';
import { withRetry, DEFAULT_RETRY_CONFIG, type RetryConfig } from './retry.js';

export interface OpenAiAdapterOptions {
  /** Custom base URL for OpenAI-compatible endpoints (e.g. OpenRouter, Kimi, Gemini compat) */
  baseURL?: string;
  /** Extra headers sent with every request (e.g. HTTP-Referer for OpenRouter) */
  defaultHeaders?: Record<string, string>;
  retryConfig?: RetryConfig;
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
    );
  }

  private async doChat(request: LlmRequest): Promise<LlmResponse> {
    try {
      const response = await this.client.chat.completions.create({
        model: request.model,
        max_tokens: request.maxTokens ?? 4096,
        temperature: request.temperature,
        messages: request.messages.map((m) => ({
          role: m.role,
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
    try {
      const stream = await this.client.chat.completions.create({
        model: request.model,
        max_tokens: request.maxTokens ?? 4096,
        temperature: request.temperature,
        messages: request.messages.map((m) => ({
          role: m.role,
          content: m.content,
        })),
        stream: true,
        // stream_options.include_usage is an OpenAI extension;
        // not all compat endpoints support it. When omitted, usage will be undefined.
        ...(this.isCompat ? {} : { stream_options: { include_usage: true } }),
      });

      const self = this;
      async function* generate(): AsyncGenerator<LlmStreamChunk> {
        try {
          let finalUsage: LlmUsage | undefined;

          for await (const chunk of stream) {
            const delta = chunk.choices[0]?.delta;
            if (delta?.content) {
              yield { content: delta.content, done: false };
            }
            // OpenAI sends usage in the LAST chunk when stream_options.include_usage is true
            if (chunk.usage) {
              finalUsage = {
                inputTokens: chunk.usage.prompt_tokens ?? 0,
                outputTokens: chunk.usage.completion_tokens ?? 0,
              };
            }
          }

          yield { done: true, usage: finalUsage };
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

  private mapResponse(response: OpenAI.Chat.Completions.ChatCompletion): LlmResponse {
    const choice = response.choices[0];
    const content = choice?.message?.content ?? '';
    const toolCalls: ToolCallResult[] = [];

    if (choice?.message?.tool_calls) {
      for (const tc of choice.message.tool_calls) {
        if (tc.type === 'function') {
          toolCalls.push({
            id: tc.id,
            name: tc.function.name,
            arguments: JSON.parse(tc.function.arguments) as Record<string, unknown>,
          });
        }
      }
    }

    return {
      content,
      toolCalls,
      usage: {
        inputTokens: response.usage?.prompt_tokens ?? 0,
        outputTokens: response.usage?.completion_tokens ?? 0,
      },
    };
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
