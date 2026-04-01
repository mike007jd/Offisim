import { describe, expect, it } from 'vitest';
import { InMemoryEventBus } from '../../events/event-bus.js';
import { llmUsageRecorded } from '../../events/event-factories.js';
import { DEFAULT_COST_RATES } from '../../runtime/default-cost-rates.js';
import { createMemoryRepositories } from '../../runtime/memory-repositories.js';
import { SessionCostTracker } from '../../runtime/session-cost-tracker.js';

async function seedRates(repos: ReturnType<typeof createMemoryRepositories>) {
  const today = new Date().toISOString().slice(0, 10);
  for (const rate of DEFAULT_COST_RATES) {
    await repos.costRates.create({
      provider: rate.provider,
      model_pattern: rate.model_pattern,
      input_cost_per_mtok: rate.input_cost_per_mtok,
      output_cost_per_mtok: rate.output_cost_per_mtok,
      effective_from: today,
      effective_until: null,
    });
  }
}

describe('SessionCostTracker', () => {
  it('restores prior LLM usage from thread history', async () => {
    const repos = createMemoryRepositories();
    const eventBus = new InMemoryEventBus();

    await seedRates(repos);
    await repos.taskRuns.create({
      task_run_id: 'tr-restore',
      thread_id: 'thread-1',
      employee_id: 'emp-restore',
      parent_task_run_id: null,
      task_type: 'general',
      status: 'completed',
      input_json: null,
      output_json: null,
      started_at: '2026-04-01T10:00:00.000Z',
    });
    await repos.llmCalls.create({
      llm_call_id: 'lc-restore',
      thread_id: 'thread-1',
      task_run_id: 'tr-restore',
      node_name: 'employee',
      provider: 'openai',
      model: 'gpt-4o',
      input_tokens: 1_000,
      output_tokens: 500,
      usage_raw_json: null,
      response_json: null,
      latency_ms: 1200,
      error_code: null,
      created_at: '2026-04-01T10:00:05.000Z',
    });

    const tracker = await SessionCostTracker.create({
      eventBus,
      repos,
      companyId: 'company-1',
      threadId: 'thread-1',
    });

    const state = tracker.getState();
    expect(state.totalCalls).toBe(1);
    expect(state.pricedCallCount).toBe(1);
    expect(state.unpricedCallCount).toBe(0);
    expect(state.costConfidence).toBe('exact');
    expect(state.totalInputTokens).toBe(1_000);
    expect(state.totalOutputTokens).toBe(500);
    expect(state.totalLatencyMs).toBe(1200);
    expect(state.byEmployee).toEqual([
      expect.objectContaining({
        key: 'emp-restore',
        callCount: 1,
      }),
    ]);
    expect(state.byModel).toEqual([
      expect.objectContaining({
        key: 'openai/gpt-4o',
        callCount: 1,
      }),
    ]);
  });

  it('tracks new usage events and emits cost.session.updated', async () => {
    const repos = createMemoryRepositories();
    const eventBus = new InMemoryEventBus();

    await seedRates(repos);
    await repos.taskRuns.create({
      task_run_id: 'tr-live',
      thread_id: 'thread-1',
      employee_id: 'emp-live',
      parent_task_run_id: null,
      task_type: 'general',
      status: 'running',
      input_json: null,
      output_json: null,
      started_at: '2026-04-01T10:05:00.000Z',
    });

    const tracker = await SessionCostTracker.create({
      eventBus,
      repos,
      companyId: 'company-1',
      threadId: 'thread-1',
    });
    const seenEvents: string[] = [];

    eventBus.on('cost.session.updated', (event) => {
      seenEvents.push(event.type);
    });

    eventBus.emit(
      llmUsageRecorded(
        'company-1',
        'lc-live',
        'thread-1',
        'tr-live',
        'openai',
        'gpt-4o-mini',
        'employee',
        900,
        300,
        640,
      ),
    );
    await new Promise((resolve) => setTimeout(resolve, 0));

    const state = tracker.getState();
    expect(seenEvents).toEqual(['cost.session.updated']);
    expect(state.totalCalls).toBe(1);
    expect(state.pricedCallCount).toBe(1);
    expect(state.unpricedCallCount).toBe(0);
    expect(state.costConfidence).toBe('exact');
    expect(state.totalInputTokens).toBe(900);
    expect(state.totalOutputTokens).toBe(300);
    expect(state.totalLatencyMs).toBe(640);
    expect(state.byNode).toEqual([
      expect.objectContaining({
        key: 'employee',
        callCount: 1,
      }),
    ]);
    expect(state.byEmployee).toEqual([
      expect.objectContaining({
        key: 'emp-live',
        callCount: 1,
      }),
    ]);
    expect(state.totalCostUsd).toBeGreaterThan(0);
  });

  it('tracks unpriced calls and downgrades confidence to unknown', async () => {
    const repos = createMemoryRepositories();
    const eventBus = new InMemoryEventBus();

    const tracker = await SessionCostTracker.create({
      eventBus,
      repos,
      companyId: 'company-1',
      threadId: 'thread-1',
    });

    eventBus.emit(
      llmUsageRecorded(
        'company-1',
        'lc-unknown',
        'thread-1',
        null,
        'unknown-provider',
        'opaque-model',
        'boss',
        100,
        50,
        120,
      ),
    );
    await new Promise((resolve) => setTimeout(resolve, 0));

    const state = tracker.getState();
    expect(state.pricedCallCount).toBe(0);
    expect(state.unpricedCallCount).toBe(1);
    expect(state.costConfidence).toBe('unknown');
    expect(state.totalCostUsd).toBe(0);
  });
});
