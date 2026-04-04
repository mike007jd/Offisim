import type { InteractionRequest } from '@offisim/shared-types';
import { describe, expect, it } from 'vitest';
import {
  AgentContextPackService,
  type AgentContextPackDeps,
} from '../../services/agent-context-pack-service.js';

function makeDeps(overrides: Partial<AgentContextPackDeps> = {}): AgentContextPackDeps {
  return {
    threadId: 'thread-1',
    companyId: 'co-1',
    getPendingInteraction: () => null,
    listNodeSummaries: async () => [],
    listTaskRuns: async () => [],
    ...overrides,
  };
}

const makeInteraction = (
  overrides: Partial<InteractionRequest> = {},
): InteractionRequest => ({
  interactionId: 'ix-1',
  threadId: 'thread-1',
  companyId: 'co-1',
  kind: 'permission_request',
  severity: 'normal',
  title: 'Allow tool X',
  prompt: 'The employee wants to use tool X',
  options: [],
  allowFreeformResponse: false,
  createdAt: Date.now(),
  ...overrides,
});

describe('AgentContextPackService', () => {
  it('builds a pack with all empty sources', async () => {
    const service = new AgentContextPackService(makeDeps());
    const pack = await service.buildPack();

    expect(pack.thread).toEqual({ threadId: 'thread-1', companyId: 'co-1' });
    expect(pack.pendingInteraction).toBeNull();
    expect(pack.activeTaskRuns).toEqual([]);
    expect(pack.recentNodeSummaries).toEqual([]);
    expect(pack.recommendedFocus).toBeNull();
  });

  it('includes pending interaction', async () => {
    const interaction = makeInteraction({ kind: 'plan_review', title: 'Review plan' });
    const service = new AgentContextPackService(
      makeDeps({ getPendingInteraction: () => interaction }),
    );
    const pack = await service.buildPack();

    expect(pack.pendingInteraction).toEqual({
      kind: 'plan_review',
      severity: 'normal',
      title: 'Review plan',
      employeeId: null,
      taskRunId: null,
    });
    expect(pack.recommendedFocus).toBe('Waiting for plan review before execution.');
  });

  it('includes active task runs', async () => {
    const service = new AgentContextPackService(
      makeDeps({
        listTaskRuns: async () => [
          { task_run_id: 'tr-1', employee_id: 'emp-1', task_type: 'code', status: 'running' },
          { task_run_id: 'tr-2', employee_id: 'emp-2', task_type: 'review', status: 'completed' },
        ],
      }),
    );
    const pack = await service.buildPack();

    expect(pack.activeTaskRuns).toHaveLength(1);
    expect(pack.activeTaskRuns[0]?.taskRunId).toBe('tr-1');
    expect(pack.recommendedFocus).toBe('1 task currently executing.');
  });

  it('includes recent node summaries', async () => {
    const service = new AgentContextPackService(
      makeDeps({
        listNodeSummaries: async () => [
          {
            node_name: 'boss',
            employee_id: null,
            step_index: null,
            summary_text: 'Boss routed to delegate.',
          },
        ],
      }),
    );
    const pack = await service.buildPack();

    expect(pack.recentNodeSummaries).toHaveLength(1);
    expect(pack.recentNodeSummaries[0]?.nodeName).toBe('boss');
  });

  it('prefers pending interaction over task runs for recommended focus', async () => {
    const interaction = makeInteraction({ kind: 'agent_question' });
    const service = new AgentContextPackService(
      makeDeps({
        getPendingInteraction: () => interaction,
        listTaskRuns: async () => [
          { task_run_id: 'tr-1', employee_id: 'emp-1', task_type: 'code', status: 'running' },
        ],
      }),
    );
    const pack = await service.buildPack();
    expect(pack.recommendedFocus).toBe('Waiting for user clarification.');
  });

  it('queries both sources in parallel', async () => {
    const callOrder: string[] = [];
    const service = new AgentContextPackService(
      makeDeps({
        listNodeSummaries: async () => {
          callOrder.push('summaries');
          return [];
        },
        listTaskRuns: async () => {
          callOrder.push('taskRuns');
          return [];
        },
      }),
    );
    await service.buildPack();
    expect(callOrder).toContain('summaries');
    expect(callOrder).toContain('taskRuns');
  });

  it('skips summary query when preloadedSummaries are provided', async () => {
    let summariesQueried = false;
    const service = new AgentContextPackService(
      makeDeps({
        listNodeSummaries: async () => {
          summariesQueried = true;
          return [];
        },
      }),
    );
    const preloaded = [
      { node_name: 'boss', employee_id: null, step_index: null, summary_text: 'Preloaded.' },
    ];
    const pack = await service.buildPack({ preloadedSummaries: preloaded });
    expect(summariesQueried).toBe(false);
    expect(pack.recentNodeSummaries).toHaveLength(1);
    expect(pack.recentNodeSummaries[0]?.summaryText).toBe('Preloaded.');
  });
});
