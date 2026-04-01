import type { LlmGateway, LlmRequest, LlmResponse, LlmStreamChunk } from '../../llm/gateway.js';

export class MockLlmGateway implements LlmGateway {
  private keywordResponses = new Map<string, LlmResponse>();
  private sequentialResponses: LlmResponse[] = [];
  private streamResponses: LlmResponse[] = [];
  private callCount = 0;
  readonly requests: LlmRequest[] = [];

  whenSystemContains(keyword: string, response: Partial<LlmResponse>): void {
    this.keywordResponses.set(keyword, {
      content: '',
      toolCalls: [],
      usage: { inputTokens: 10, outputTokens: 5 },
      ...response,
    });
  }

  pushResponse(...responses: Array<Partial<LlmResponse>>): void {
    for (const r of responses) {
      this.sequentialResponses.push({
        content: '',
        toolCalls: [],
        usage: { inputTokens: 10, outputTokens: 5 },
        ...r,
      });
    }
  }

  pushStreamResponse(...responses: Array<Partial<LlmResponse>>): void {
    for (const r of responses) {
      this.streamResponses.push({
        content: '',
        toolCalls: [],
        usage: { inputTokens: 10, outputTokens: 5 },
        ...r,
      });
    }
  }

  async chat(request: LlmRequest): Promise<LlmResponse> {
    this.requests.push(request);
    // Sequential mode takes priority
    if (this.callCount < this.sequentialResponses.length) {
      const response = this.sequentialResponses[this.callCount];
      this.callCount += 1;
      if (!response) {
        throw new Error(`Missing sequential response at index ${this.callCount - 1}`);
      }
      return response;
    }

    // Keyword matching
    const systemText = request.messages
      .filter((m) => m.role === 'system')
      .map((m) => m.content)
      .join(' ');

    for (const [keyword, response] of this.keywordResponses) {
      if (systemText.includes(keyword)) {
        this.callCount++;
        return response;
      }
    }

    this.callCount++;
    const lastUserMsg = request.messages.filter((m) => m.role === 'user').at(-1);
    return {
      content: `Mock response for: ${lastUserMsg?.content ?? 'unknown'}`,
      toolCalls: [],
      usage: { inputTokens: 10, outputTokens: 5 },
    };
  }

  dispose(): void {
    // No-op for mock.
  }

  async *chatStream(request: LlmRequest): AsyncIterable<LlmStreamChunk> {
    // Use stream-specific responses first, then fall back to chat()
    let response: LlmResponse;
    if (this.streamResponses.length > 0) {
      this.requests.push(request);
      const shifted = this.streamResponses.shift();
      if (!shifted) {
        throw new Error('Expected a queued stream response');
      }
      response = shifted;
    } else {
      response = await this.chat(request);
    }

    // Simulate streaming by yielding content word by word
    const words = response.content.split(' ');
    for (const word of words) {
      if (word) {
        yield { content: `${word} `, done: false };
      }
    }
    yield { usage: response.usage, done: true };
  }

  getLastRequest(): LlmRequest | undefined {
    return this.requests.at(-1);
  }
}
