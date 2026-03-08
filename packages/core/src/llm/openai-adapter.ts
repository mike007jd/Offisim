import OpenAI from 'openai';
import { LlmError } from '../errors.js';
import type { LlmGateway, LlmRequest, LlmResponse, ToolCallResult } from './gateway.js';

export class OpenAiAdapter implements LlmGateway {
  private client: OpenAI;

  constructor(apiKey: string) {
    this.client = new OpenAI({ apiKey });
  }

  async chat(request: LlmRequest): Promise<LlmResponse> {
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
      return new LlmError(error.message, 'openai', error.status);
    }
    return new LlmError(
      error instanceof Error ? error.message : 'Unknown OpenAI error',
      'openai',
    );
  }
}
