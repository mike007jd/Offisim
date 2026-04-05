import type { AgentContextPack } from '@offisim/shared-types';
import { describe, expect, it } from 'vitest';
import { NodeContextMiddleware } from '../../middleware/builtin/node-context-middleware.js';
import type { LlmCallContext } from '../../middleware/types.js';
import type { AgentContextPackService } from '../../services/agent-context-pack-service.js';

function makeNodeSummaryRepo(
  summaries: Array<{
    node_name: string;
    employee_id: string | null;
    step_index: number | null;
    summary_text: string;
  }> = [],
) {
  return {
    listByThread: async (_threadId: string, _opts?: { limit?: number }) => summaries,
    create: async (row: unknown) => row,
    // biome-ignore lint/suspicious/noExplicitAny: mock type cast in test fixture
  } as any;
}

function makePackService(pack: AgentContextPack | null): AgentContextPackService {
  return {
    buildPack: async () =>
      pack ?? {
        thread: { threadId: 'thread-1', companyId: 'co-1' },
        pendingInteraction: null,
        activeTaskRuns: [],
        recentNodeSummaries: [],
        recommendedFocus: null,
      },
  } as AgentContextPackService;
}

function makeLlmCallContext(systemContent = 'You are a helpful assistant.'): LlmCallContext {
  return {
    request: {
      messages: [
        { role: 'system', content: systemContent },
        { role: 'user', content: 'Hello' },
      ],
      model: 'test-model',
    },
    runtimeCtx: {
      threadId: 'thread-1',
      companyId: 'co-1',
    },
    meta: {
      nodeName: 'employee',
      provider: 'test',
      model: 'test-model',
    },
    extras: {},
    // biome-ignore lint/suspicious/noExplicitAny: mock type cast in test fixture
  } as any;
}

const fullPack: AgentContextPack = {
  thread: { threadId: 'thread-1', companyId: 'co-1' },
  pendingInteraction: {
    kind: 'permission_request',
    severity: 'high',
    title: 'Allow tool X',
    employeeId: 'emp-1',
    taskRunId: 'tr-1',
  },
  activeTaskRuns: [{ taskRunId: 'tr-1', employeeId: 'emp-1', taskType: 'code', status: 'running' }],
  recentNodeSummaries: [
    {
      nodeName: 'boss',
      employeeId: null,
      stepIndex: null,
      summaryText: 'Boss routed to delegate.',
    },
  ],
  recommendedFocus: 'Waiting for user approval before proceeding.',
};

describe('NodeContextMiddleware with context pack', () => {
  it('includes both summaries and pack in one block', async () => {
    const summaries = [
      {
        node_name: 'boss',
        employee_id: null,
        step_index: null,
        summary_text: 'Boss routed.',
      },
    ];
    const middleware = new NodeContextMiddleware(
      makeNodeSummaryRepo(summaries),
      {},
      makePackService(fullPack),
    );

    const result = await middleware.before(makeLlmCallContext());
    const systemMsg = result.request.messages[0];
    expect(systemMsg?.content).toContain('## Execution Context (previous nodes)');
    expect(systemMsg?.content).toContain('## Runtime Context (current state)');
    expect(systemMsg?.content).toContain('Boss routed.');
    expect(systemMsg?.content).toContain('Allow tool X');
  });

  it('gives full budget to summaries when pack is empty', async () => {
    const summaries = [
      { node_name: 'boss', employee_id: null, step_index: null, summary_text: 'Boss routed.' },
    ];
    const emptyPack: AgentContextPack = {
      thread: { threadId: 'thread-1', companyId: 'co-1' },
      pendingInteraction: null,
      activeTaskRuns: [],
      recentNodeSummaries: [],
      recommendedFocus: null,
    };
    const middleware = new NodeContextMiddleware(
      makeNodeSummaryRepo(summaries),
      {},
      makePackService(emptyPack),
    );

    const result = await middleware.before(makeLlmCallContext());
    const systemMsg = result.request.messages[0];
    expect(systemMsg?.content).toContain('## Execution Context');
    expect(systemMsg?.content).not.toContain('## Runtime Context');
  });

  it('gives full budget to pack when no summaries exist', async () => {
    const middleware = new NodeContextMiddleware(
      makeNodeSummaryRepo([]),
      {},
      makePackService(fullPack),
    );

    const result = await middleware.before(makeLlmCallContext());
    const systemMsg = result.request.messages[0];
    expect(systemMsg?.content).not.toContain('## Execution Context');
    expect(systemMsg?.content).toContain('## Runtime Context');
    expect(systemMsg?.content).toContain('Waiting for user approval');
  });

  it('returns ctx unchanged when both are empty', async () => {
    const middleware = new NodeContextMiddleware(
      makeNodeSummaryRepo([]),
      {},
      makePackService(null),
    );

    const ctx = makeLlmCallContext();
    const result = await middleware.before(ctx);
    expect(result).toBe(ctx);
  });

  it('works without pack service (backward compat)', async () => {
    const summaries = [
      { node_name: 'boss', employee_id: null, step_index: null, summary_text: 'Boss routed.' },
    ];
    const middleware = new NodeContextMiddleware(makeNodeSummaryRepo(summaries));

    const result = await middleware.before(makeLlmCallContext());
    const systemMsg = result.request.messages[0];
    expect(systemMsg?.content).toContain('## Execution Context');
    expect(systemMsg?.content).not.toContain('## Runtime Context');
  });

  it('does not render recentNodeSummaries in pack block (dedup with execution context)', async () => {
    const middleware = new NodeContextMiddleware(
      makeNodeSummaryRepo([]),
      {},
      makePackService(fullPack),
    );

    const result = await middleware.before(makeLlmCallContext());
    const systemMsg = result.request.messages[0];
    // The pack has recentNodeSummaries but they must NOT appear in the pack block
    expect(systemMsg?.content).not.toContain('Recent outcomes');
    expect(systemMsg?.content).not.toContain('Boss routed to delegate');
    // Pack block should still have other content
    expect(systemMsg?.content).toContain('Allow tool X');
  });

  it('respects total char budget', async () => {
    const longSummary = 'x'.repeat(500);
    const summaries = [
      { node_name: 'boss', employee_id: null, step_index: null, summary_text: longSummary },
    ];
    const middleware = new NodeContextMiddleware(
      makeNodeSummaryRepo(summaries),
      { maxChars: 200 },
      makePackService(fullPack),
    );

    const result = await middleware.before(makeLlmCallContext());
    const systemMsg = result.request.messages[0];
    const injected = (systemMsg?.content as string).slice(
      'You are a helpful assistant.\n\n'.length,
    );
    expect(injected.length).toBeLessThanOrEqual(200);
  });

  it('renders pending interaction severity', async () => {
    const middleware = new NodeContextMiddleware(
      makeNodeSummaryRepo([]),
      {},
      makePackService(fullPack),
    );

    const result = await middleware.before(makeLlmCallContext());
    const systemMsg = result.request.messages[0];
    expect(systemMsg?.content).toContain('(HIGH)');
  });

  it('renders active task run details', async () => {
    const middleware = new NodeContextMiddleware(
      makeNodeSummaryRepo([]),
      {},
      makePackService(fullPack),
    );

    const result = await middleware.before(makeLlmCallContext());
    const systemMsg = result.request.messages[0];
    expect(systemMsg?.content).toContain('[running] code (emp-1)');
  });

  it('prepends system message when none exists', async () => {
    const ctx: LlmCallContext = {
      request: {
        messages: [{ role: 'user', content: 'Hello' }],
        model: 'test',
      },
      runtimeCtx: { threadId: 'thread-1', companyId: 'co-1' },
      meta: { nodeName: 'boss', provider: 'test', model: 'test' },
      extras: {},
      // biome-ignore lint/suspicious/noExplicitAny: mock type cast in test fixture
    } as any;

    const middleware = new NodeContextMiddleware(
      makeNodeSummaryRepo([]),
      {},
      makePackService(fullPack),
    );

    const result = await middleware.before(ctx);
    expect(result.request.messages[0]?.role).toBe('system');
    expect(result.request.messages[0]?.content).toContain('## Runtime Context');
  });
});
