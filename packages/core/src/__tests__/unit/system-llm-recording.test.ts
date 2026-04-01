/**
 * Guard test: System service LLM calls must go through RecordedSystemLlmCaller.
 * See CLAUDE.md — AI Runtime Policy, rule 4.
 */
import { describe, expect, it, vi } from 'vitest';
import { InMemoryEventBus } from '../../events/event-bus.js';
import type { LlmGateway, LlmResponse } from '../../llm/gateway.js';
import { RecordedSystemLlmCaller } from '../../llm/recorded-system-caller.js';
import type { LlmCallRepository } from '../../runtime/repositories.js';

function createMockGateway(): LlmGateway {
  const response: LlmResponse = {
    content: 'test response',
    toolCalls: [],
    usage: { inputTokens: 10, outputTokens: 5 },
  };
  return {
    chat: vi.fn().mockResolvedValue(response),
    chatStream: vi.fn(),
    dispose: vi.fn(),
  };
}

function createMockLlmCallRepo(): LlmCallRepository {
  return {
    create: vi.fn().mockResolvedValue({}),
    findByThread: vi.fn().mockResolvedValue([]),
    findByThreadIds: vi.fn().mockResolvedValue([]),
    findByTaskRun: vi.fn().mockResolvedValue([]),
  };
}

describe('RecordedSystemLlmCaller', () => {
  it('records LLM call to llmCalls repository', async () => {
    const gateway = createMockGateway();
    const llmCalls = createMockLlmCallRepo();
    const eventBus = new InMemoryEventBus();

    const caller = new RecordedSystemLlmCaller({
      llmGateway: gateway,
      llmCalls,
      eventBus,
      companyId: 'test-company',
      threadId: 'test-thread',
    });

    await caller.chat('memory_reflection', {
      messages: [{ role: 'user', content: 'test' }],
      model: 'default',
    });

    expect(gateway.chat).toHaveBeenCalledTimes(1);
    expect(llmCalls.create).toHaveBeenCalledTimes(1);

    const recorded = vi.mocked(llmCalls.create).mock.calls[0][0];
    expect(recorded.node_name).toBe('memory_reflection');
    expect(recorded.thread_id).toBe('test-thread');
    expect(recorded.input_tokens).toBe(10);
    expect(recorded.output_tokens).toBe(5);
  });

  it('emits llm.call.started and llm.call.completed events', async () => {
    const gateway = createMockGateway();
    const llmCalls = createMockLlmCallRepo();
    const eventBus = new InMemoryEventBus();
    const events: string[] = [];
    eventBus.on('llm.call', (event) => events.push(event.type));

    const caller = new RecordedSystemLlmCaller({
      llmGateway: gateway,
      llmCalls,
      eventBus,
      companyId: 'test-company',
      threadId: null,
    });

    await caller.chat('event_consolidation', {
      messages: [{ role: 'user', content: 'test' }],
      model: 'default',
    });

    expect(events).toContain('llm.call.started');
    expect(events).toContain('llm.call.completed');
  });

  it('records errors to llmCalls with error_code', async () => {
    const gateway = createMockGateway();
    vi.mocked(gateway.chat).mockRejectedValue(new Error('LLM timeout'));
    const llmCalls = createMockLlmCallRepo();
    const eventBus = new InMemoryEventBus();

    const caller = new RecordedSystemLlmCaller({
      llmGateway: gateway,
      llmCalls,
      eventBus,
      companyId: 'test-company',
      threadId: 'test-thread',
    });

    await expect(
      caller.chat('conversation_budget', {
        messages: [{ role: 'user', content: 'test' }],
        model: 'default',
      }),
    ).rejects.toThrow('LLM timeout');

    expect(llmCalls.create).toHaveBeenCalledTimes(1);
    const recorded = vi.mocked(llmCalls.create).mock.calls[0][0];
    expect(recorded.error_code).toBe('LLM timeout');
    expect(recorded.input_tokens).toBe(0);
  });
});
