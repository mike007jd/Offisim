import type { BaseCheckpointSaver } from '@langchain/langgraph';
import { beforeEach, describe, expect, it } from 'vitest';
import { createMemoryCheckpointSaver } from '../../graph/checkpoint-saver.js';
import { createMemoryRepositories } from '../../runtime/memory-repositories.js';
import { ExecutionTraceServiceImpl } from '../../services/execution-trace-service.js';
import { TEST_COMPANY, TEST_COMPANY_ID } from '../helpers/fixtures.js';

describe('ExecutionTraceService', () => {
  let repos: ReturnType<typeof createMemoryRepositories>;
  let checkpointSaver: BaseCheckpointSaver;
  let service: ExecutionTraceServiceImpl;

  beforeEach(() => {
    repos = createMemoryRepositories();
    repos.seed.companies([TEST_COMPANY]);
    checkpointSaver = createMemoryCheckpointSaver();
    service = new ExecutionTraceServiceImpl(repos, checkpointSaver);
  });

  it('returns null for non-existent thread', async () => {
    const trace = await service.getTrace('nonexistent');
    expect(trace).toBeNull();
  });

  it('assembles trace with thread, taskRuns, handoffs, and llmCalls', async () => {
    await repos.threads.create({
      thread_id: 't-1',
      company_id: TEST_COMPANY_ID,
      entry_mode: 'boss_chat',
      root_task_id: null,
      status: 'completed',
    });

    await repos.taskRuns.create({
      task_run_id: 'tr-1',
      thread_id: 't-1',
      employee_id: 'e-1',
      parent_task_run_id: null,
      task_type: 'code',
      status: 'completed',
      input_json: '{}',
      output_json: '{}',
      started_at: new Date().toISOString(),
    });

    await repos.handoffs.create({
      handoff_id: 'ho-1',
      thread_id: 't-1',
      from_employee_id: null,
      to_employee_id: 'e-1',
      reason: 'assign',
      payload_json: null,
      created_at: new Date().toISOString(),
    });

    await repos.llmCalls.create({
      llm_call_id: 'lc-1',
      thread_id: 't-1',
      task_run_id: 'tr-1',
      node_name: 'employee',
      provider: 'anthropic',
      model: 'claude-sonnet-4-20250514',
      input_tokens: 100,
      output_tokens: 50,
      usage_raw_json: null,
      response_json: null,
      latency_ms: 1500,
      error_code: null,
      created_at: new Date().toISOString(),
    });

    const trace = await service.getTrace('t-1');
    expect(trace).not.toBeNull();
    expect(trace?.thread.thread_id).toBe('t-1');
    expect(trace?.taskRuns).toHaveLength(1);
    expect(trace?.handoffs).toHaveLength(1);
    expect(trace?.llmCalls).toHaveLength(1);
  });

  it('listThreads returns threads for company', async () => {
    await repos.threads.create({
      thread_id: 't-1',
      company_id: TEST_COMPANY_ID,
      entry_mode: 'boss_chat',
      root_task_id: null,
      status: 'completed',
    });
    await repos.threads.create({
      thread_id: 't-2',
      company_id: TEST_COMPANY_ID,
      entry_mode: 'boss_chat',
      root_task_id: null,
      status: 'running',
    });

    const threads = await service.listThreads(TEST_COMPANY_ID);
    expect(threads).toHaveLength(2);
  });

  it('getStateAt returns null for unknown checkpoint', async () => {
    const state = await service.getStateAt('nonexistent-thread', 'nonexistent-cp');
    expect(state).toBeNull();
  });

  it('getStateAt retrieves channel values from checkpointSaver', async () => {
    const config = { configurable: { thread_id: 'svc-thread-1' } };
    const checkpoint = {
      v: 1,
      id: 'svc-cp-1',
      ts: new Date().toISOString(),
      channel_values: { messages: [], completed: true, foo: 'bar' },
      channel_versions: {},
      versions_seen: {},
      pending_sends: [],
    };
    const metadata = { source: 'input' as const, step: 0, parents: {} };

    await checkpointSaver.put(config, checkpoint, metadata, {});

    const state = await service.getStateAt('svc-thread-1', 'svc-cp-1');
    expect(state).not.toBeNull();
    expect(state?.completed).toBe(true);
    expect(state?.foo).toBe('bar');
  });
});
