import { describe, it, expect } from 'vitest';
import { llmCallStarted, llmCallCompleted, llmUsageRecorded } from '../../events/event-factories.js';

describe('LLM event factories', () => {
  it('creates llm.call.started event', () => {
    const event = llmCallStarted('c-1', 'lc-1', 'boss', 'anthropic', 'claude-sonnet-4-20250514', 't-1');
    expect(event.type).toBe('llm.call.started');
    expect(event.entityType).toBe('llm');
    expect(event.entityId).toBe('lc-1');
    expect(event.companyId).toBe('c-1');
    expect(event.payload.llmCallId).toBe('lc-1');
    expect(event.payload.nodeName).toBe('boss');
    expect(event.payload.provider).toBe('anthropic');
    expect(event.payload.model).toBe('claude-sonnet-4-20250514');
  });

  it('creates llm.call.completed event', () => {
    const event = llmCallCompleted('c-1', 'lc-1', 'employee', 1500, 100, 50);
    expect(event.type).toBe('llm.call.completed');
    expect(event.payload.latencyMs).toBe(1500);
    expect(event.payload.inputTokens).toBe(100);
    expect(event.payload.outputTokens).toBe(50);
  });

  it('creates llm.usage.recorded event', () => {
    const event = llmUsageRecorded('c-1', 'lc-1', 't-1', 'tr-1', 'anthropic', 'claude-sonnet-4-20250514', 100, 50);
    expect(event.type).toBe('llm.usage.recorded');
    expect(event.payload.taskRunId).toBe('tr-1');
  });
});
