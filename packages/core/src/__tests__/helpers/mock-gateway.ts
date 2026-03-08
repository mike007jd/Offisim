import type { LlmGateway, LlmRequest, LlmResponse } from '../../llm/gateway.js';

export class MockLlmGateway implements LlmGateway {
  private keywordResponses = new Map<string, LlmResponse>();
  private sequentialResponses: LlmResponse[] = [];
  private callCount = 0;

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

  async chat(request: LlmRequest): Promise<LlmResponse> {
    // Sequential mode takes priority
    if (this.callCount < this.sequentialResponses.length) {
      return this.sequentialResponses[this.callCount++]!;
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
}
