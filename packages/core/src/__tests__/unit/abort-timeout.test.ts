import { describe, expect, it } from 'vitest';
import type { LlmRequest } from '../../llm/gateway.js';

describe('LlmRequest signal support', () => {
  it('accepts optional signal', () => {
    const controller = new AbortController();
    const req: LlmRequest = {
      model: 'test',
      messages: [{ role: 'user', content: 'hi' }],
      signal: controller.signal,
    };
    expect(req.signal).toBe(controller.signal);
  });

  it('accepts optional timeoutMs', () => {
    const req: LlmRequest = {
      model: 'test',
      messages: [{ role: 'user', content: 'hi' }],
      timeoutMs: 30000,
    };
    expect(req.timeoutMs).toBe(30000);
  });
});
