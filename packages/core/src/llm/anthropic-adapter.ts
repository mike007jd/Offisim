import Anthropic from '@anthropic-ai/sdk';
import { LlmError } from '../errors.js';
import type { LlmGateway, LlmRequest, LlmResponse, ToolCallResult } from './gateway.js';

export class AnthropicAdapter implements LlmGateway {
  private client: Anthropic;

  constructor(apiKey: string) {
    this.client = new Anthropic({ apiKey });
  }

  async chat(request: LlmRequest): Promise<LlmResponse> {
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
