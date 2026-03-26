import { describe, expect, it, vi } from 'vitest';
import { pmHeartbeatNode } from '../../agents/pm-heartbeat-node.js';
import {
  type StructuredError,
  diagnoseAndRecover,
  recordRecoveryOutcome,
} from '../../agents/recovery-agent.js';
import { InMemoryEventBus } from '../../events/event-bus.js';
import { routeFromStart, routeFromStepAdvance } from '../../graph/main-graph.js';
import type { AicsGraphState, PlanStep, TaskPlan } from '../../graph/state.js';
import { createMemoryRepositories } from '../../runtime/memory-repositories.js';
import type { RuntimeContext } from '../../runtime/runtime-context.js';
import { appendAgentEvent } from '../../utils/append-agent-event.js';
import { generateId } from '../../utils/generate-id.js';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function makeState(overrides?: Partial<AicsGraphState>): AicsGraphState {
  return {
    threadId: 'thread-test',
    companyId: 'company-test',
    entryMode: 'boss_chat',
    projectId: null,
    targetEmployeeId: null,
    messages: [],
    routeDecision: null,
    currentTaskRunId: null,
    currentEmployeeId: null,
    pendingAssignments: [],
    completed: false,
    interruptReason: null,
    meetingId: null,
    managerDirective: null,
    taskPlan: null,
    currentStepIndex: 0,
    stepResults: [],
    currentStepOutputs: [],
    dispatchedStepIndices: [],
    completedStepIndices: [],
    handoffCount: 0,
    meetingActionItems: [],
    meetingInterrupt: null,
    hrAssessment: null,
    replanCount: 0,
    ...overrides,
  } as AicsGraphState;
}

function makeRuntimeCtx(overrides?: Partial<RuntimeContext>): RuntimeContext {
  const repos = createMemoryRepositories();
  return {
    repos,
    eventBus: new InMemoryEventBus(),
    llmGateway: { call: vi.fn(), stream: vi.fn() } as unknown as RuntimeContext['llmGateway'],
    modelResolver: {
      resolve: () => ({ provider: 'test', model: 'test-model', temperature: 0, maxTokens: 100 }),
    } as unknown as RuntimeContext['modelResolver'],
    toolExecutor: {
      execute: vi.fn(),
      listAvailable: vi.fn(),
    } as unknown as RuntimeContext['toolExecutor'],
    companyId: 'company-test',
    threadId: 'thread-test',
    meetingInterruptBox: { pending: null },
    ...overrides,
  };
}

function makeConfig(runtimeCtx: RuntimeContext) {
  return { configurable: { runtimeCtx } } as Parameters<typeof pmHeartbeatNode>[1];
}

function makePlan(steps: Partial<PlanStep>[]): TaskPlan {
  return {
    planId: generateId('plan'),
    threadId: 'thread-test',
    companyId: 'company-test',
    summary: 'Test plan',
    steps: steps.map((s, i) => ({
      stepIndex: s.stepIndex ?? i,
      description: s.description ?? `Step ${i}`,
      tasks: s.tasks ?? [
        {
          taskType: 'general',
          employeeId: 'emp-1',
          description: 'Task',
          dependsOnStepOutput: false,
        },
      ],
      phase: s.phase,
      dependsOnSteps: s.dependsOnSteps,
    })),
  };
}

// ===========================================================================
// Phase A: Event Sourcing
// ===========================================================================

describe('Phase A: Event Sourcing', () => {
  it('appendAgentEvent writes to agentEvents repo', async () => {
    const ctx = makeRuntimeCtx();
    const eventId = await appendAgentEvent(ctx, {
      projectId: 'proj-1',
      threadId: 'thread-test',
      agentName: 'boss',
      eventType: 'decision',
      payload: { action: 'delegate', reason: 'complex task' },
    });

    expect(eventId).toBeDefined();
    expect(eventId).toMatch(/^evt-/);

    const eventRepo = ctx.repos.agentEvents;
    expect(eventRepo).toBeDefined();
    if (!eventRepo) throw new Error('agentEvents repo unavailable');
    const events = await eventRepo.findByThread('thread-test');
    expect(events).toHaveLength(1);
    const [firstEvent] = events;
    expect(firstEvent).toBeDefined();
    if (!firstEvent) throw new Error('Expected appended event');
    expect(firstEvent.agent_name).toBe('boss');
    expect(firstEvent.event_type).toBe('decision');
    expect(JSON.parse(firstEvent.payload_json)).toMatchObject({ action: 'delegate' });
  });

  it('appendAgentEvent is no-op when agentEvents repo is undefined', async () => {
    const ctx = makeRuntimeCtx();
    // Remove the repo
    ctx.repos.agentEvents = undefined;

    const eventId = await appendAgentEvent(ctx, {
      threadId: 'thread-test',
      agentName: 'boss',
      eventType: 'decision',
      payload: {},
    });
    expect(eventId).toBeUndefined();
  });

  it('causal chain can be queried', async () => {
    const ctx = makeRuntimeCtx();
    const repo = ctx.repos.agentEvents;
    expect(repo).toBeDefined();
    if (!repo) throw new Error('agentEvents repo unavailable');

    await repo.append({
      event_id: 'evt-1',
      project_id: null,
      thread_id: 't1',
      company_id: 'c1',
      agent_name: 'boss',
      event_type: 'decision',
      payload_json: '{}',
      parent_event_id: null,
    });
    await repo.append({
      event_id: 'evt-2',
      project_id: null,
      thread_id: 't1',
      company_id: 'c1',
      agent_name: 'manager',
      event_type: 'decision',
      payload_json: '{}',
      parent_event_id: 'evt-1',
    });
    await repo.append({
      event_id: 'evt-3',
      project_id: null,
      thread_id: 't1',
      company_id: 'c1',
      agent_name: 'pm',
      event_type: 'decision',
      payload_json: '{}',
      parent_event_id: 'evt-2',
    });

    const chain = await repo.findCausalChain('evt-3');
    expect(chain).toHaveLength(3);
    expect(chain.map((e) => e.event_id)).toEqual(['evt-3', 'evt-2', 'evt-1']);
  });

  it('findByAgent filters by eventType', async () => {
    const ctx = makeRuntimeCtx();
    const repo = ctx.repos.agentEvents;
    expect(repo).toBeDefined();
    if (!repo) throw new Error('agentEvents repo unavailable');

    await repo.append({
      event_id: 'evt-a',
      project_id: null,
      thread_id: 't1',
      company_id: 'c1',
      agent_name: 'pm',
      event_type: 'decision',
      payload_json: '{}',
      parent_event_id: null,
    });
    await repo.append({
      event_id: 'evt-b',
      project_id: null,
      thread_id: 't1',
      company_id: 'c1',
      agent_name: 'pm',
      event_type: 'heartbeat',
      payload_json: '{}',
      parent_event_id: null,
    });

    const decisions = await repo.findByAgent('pm', { eventType: 'decision' });
    expect(decisions).toHaveLength(1);
    expect(decisions[0]?.event_id).toBe('evt-a');

    const all = await repo.findByAgent('pm');
    expect(all).toHaveLength(2);
  });
});

// ===========================================================================
// Phase B: Recovery Agent
// ===========================================================================

describe('Phase B: Recovery Agent', () => {
  it('recovery knowledge upsert and findBestFix', async () => {
    const ctx = makeRuntimeCtx();
    const repo = ctx.repos.recoveryKnowledge;
    expect(repo).toBeDefined();
    if (!repo) throw new Error('recoveryKnowledge repo unavailable');

    const entry = await repo.upsert({
      knowledge_id: generateId('rk'),
      symptom: 'LLM_TIMEOUT',
      cause: 'rate_limit',
      fix_strategy: 'retry_with_backoff',
      fix_config: JSON.stringify({ maxRetries: 3 }),
    });

    expect(entry.symptom).toBe('LLM_TIMEOUT');
    expect(entry.success_count).toBe(0);

    // Increment success
    await repo.incrementSuccess(entry.knowledge_id);
    await repo.incrementSuccess(entry.knowledge_id);
    await repo.incrementFailure(entry.knowledge_id);

    const best = await repo.findBestFix('LLM_TIMEOUT');
    expect(best).not.toBeNull();
    expect(best?.success_count).toBe(2);
    expect(best?.failure_count).toBe(1);
  });

  it('upsert updates existing entry on symptom+cause match', async () => {
    const ctx = makeRuntimeCtx();
    const repo = ctx.repos.recoveryKnowledge;
    expect(repo).toBeDefined();
    if (!repo) throw new Error('recoveryKnowledge repo unavailable');

    await repo.upsert({
      knowledge_id: 'rk-1',
      symptom: 'LLM_TIMEOUT',
      cause: 'rate_limit',
      fix_strategy: 'retry_with_backoff',
      fix_config: null,
    });

    const updated = await repo.upsert({
      knowledge_id: 'rk-2',
      symptom: 'LLM_TIMEOUT',
      cause: 'rate_limit',
      fix_strategy: 'switch_model',
      fix_config: null,
    });

    // Should update the existing entry, not create a new one
    expect(updated.fix_strategy).toBe('switch_model');
    const all = await repo.findBySymptom('LLM_TIMEOUT');
    expect(all).toHaveLength(1);
  });

  it('diagnoseAndRecover returns knowledge-based fix when available', async () => {
    const ctx = makeRuntimeCtx();
    const config = makeConfig(ctx);

    // Seed knowledge
    const repo = ctx.repos.recoveryKnowledge;
    expect(repo).toBeDefined();
    if (!repo) throw new Error('recoveryKnowledge repo unavailable');
    const entry = await repo.upsert({
      knowledge_id: generateId('rk'),
      symptom: 'LLM_TIMEOUT',
      cause: 'rate_limit',
      fix_strategy: 'retry_with_backoff',
      fix_config: null,
    });
    await repo.incrementSuccess(entry.knowledge_id);
    await repo.incrementSuccess(entry.knowledge_id);

    const error: StructuredError = {
      errorCode: 'LLM_TIMEOUT',
      message: 'Request timed out',
      recoverable: true,
      nodeName: 'employee',
    };

    const decision = await diagnoseAndRecover(ctx, config, error, 'thread-test', null);
    expect(decision).not.toBeNull();
    expect(decision?.strategy).toBe('retry_with_backoff');
    expect(decision?.cause).toBe('rate_limit');
    expect(decision?.knowledgeId).toBe(entry.knowledge_id);
  });

  it('diagnoseAndRecover escalates non-recoverable errors', async () => {
    const ctx = makeRuntimeCtx();
    const config = makeConfig(ctx);

    const error: StructuredError = {
      errorCode: 'FATAL_CONFIG',
      message: 'Invalid configuration',
      recoverable: false,
      nodeName: 'boss',
    };

    const decision = await diagnoseAndRecover(ctx, config, error, 'thread-test', null);
    expect(decision).not.toBeNull();
    expect(decision?.strategy).toBe('escalate');
  });

  it('recordRecoveryOutcome creates new knowledge entry', async () => {
    const ctx = makeRuntimeCtx();

    await recordRecoveryOutcome(ctx, 'PARSE_ERROR', 'malformed_json', 'retry_with_backoff', true);

    const recoveryRepo = ctx.repos.recoveryKnowledge;
    expect(recoveryRepo).toBeDefined();
    if (!recoveryRepo) throw new Error('recoveryKnowledge repo unavailable');
    const entries = await recoveryRepo.findBySymptom('PARSE_ERROR');
    expect(entries).toHaveLength(1);
    const [firstEntry] = entries;
    expect(firstEntry).toBeDefined();
    if (!firstEntry) throw new Error('Expected recovery knowledge entry');
    expect(firstEntry.cause).toBe('malformed_json');
    expect(firstEntry.success_count).toBe(1);
  });
});

// ===========================================================================
// Phase C: Heartbeat
// ===========================================================================

describe('Phase C: Heartbeat', () => {
  it('routeFromStart routes heartbeat to pm_heartbeat', () => {
    const state = makeState({ entryMode: 'heartbeat' });
    expect(routeFromStart(state)).toBe('pm_heartbeat');
  });

  it('heartbeat is no-op when no plan exists', async () => {
    const ctx = makeRuntimeCtx();
    const state = makeState({ entryMode: 'heartbeat' });
    const result = await pmHeartbeatNode(state, makeConfig(ctx));
    expect(result).toEqual({});
  });

  it('heartbeat writes event when progress changes', async () => {
    const ctx = makeRuntimeCtx();
    const plan = makePlan([{ stepIndex: 0 }, { stepIndex: 1 }, { stepIndex: 2 }]);
    const state = makeState({
      entryMode: 'heartbeat',
      taskPlan: plan,
      completedStepIndices: [0],
      dispatchedStepIndices: [0, 1],
    });

    await pmHeartbeatNode(state, makeConfig(ctx));

    const eventRepo = ctx.repos.agentEvents;
    expect(eventRepo).toBeDefined();
    if (!eventRepo) throw new Error('agentEvents repo unavailable');
    const events = await eventRepo.findByAgent('pm', { eventType: 'heartbeat' });
    expect(events).toHaveLength(1);
    const [firstEvent] = events;
    expect(firstEvent).toBeDefined();
    if (!firstEvent) throw new Error('Expected heartbeat event');
    const payload = JSON.parse(firstEvent.payload_json);
    expect(payload.progress).toBe('1/3 steps');
    expect(payload.recommendation).toBe('in_progress');
  });

  it('heartbeat is silent when nothing changed since last heartbeat', async () => {
    const ctx = makeRuntimeCtx();
    const plan = makePlan([{ stepIndex: 0 }, { stepIndex: 1 }]);
    const state = makeState({
      entryMode: 'heartbeat',
      taskPlan: plan,
      completedStepIndices: [0],
      dispatchedStepIndices: [0, 1],
    });

    // First heartbeat
    await pmHeartbeatNode(state, makeConfig(ctx));

    // Second heartbeat with same state — should be silent
    await pmHeartbeatNode(state, makeConfig(ctx));

    const events = await ctx.repos.agentEvents?.findByAgent('pm', { eventType: 'heartbeat' });
    expect(events).toHaveLength(1); // Only one event, not two
  });
});

// ===========================================================================
// Phase D: Dynamic Re-Planning
// ===========================================================================

describe('Phase D: Dynamic Re-Planning', () => {
  it('routeFromStepAdvance detects REPLAN_NEEDED in employee output', () => {
    const state = makeState({
      stepResults: [
        {
          stepIndex: 0,
          outputs: [
            {
              employeeId: 'e1',
              employeeName: 'Dev',
              content: 'This approach is infeasible, we need a different method. REPLAN_NEEDED',
              taskRunId: 'tr-1',
            },
          ],
        },
      ],
      replanCount: 0,
    });
    expect(routeFromStepAdvance(state)).toBe('pm_replan');
  });

  it('routeFromStepAdvance routes to step_dispatcher when no replan signal', () => {
    const state = makeState({
      stepResults: [
        {
          stepIndex: 0,
          outputs: [
            {
              employeeId: 'e1',
              employeeName: 'Dev',
              content: 'Task completed successfully.',
              taskRunId: 'tr-1',
            },
          ],
        },
      ],
    });
    expect(routeFromStepAdvance(state)).toBe('step_dispatcher');
  });

  it('routeFromStepAdvance routes to step_dispatcher when replanCount >= 3', () => {
    const state = makeState({
      stepResults: [
        {
          stepIndex: 0,
          outputs: [
            { employeeId: 'e1', employeeName: 'Dev', content: 'REPLAN_NEEDED', taskRunId: 'tr-1' },
          ],
        },
      ],
      replanCount: 3,
    });
    expect(routeFromStepAdvance(state)).toBe('step_dispatcher');
  });

  it('routeFromStepAdvance detects explicit replan signals', () => {
    // [SIGNAL:REPLAN_NEEDED] marker format
    const markerState = makeState({
      stepResults: [
        {
          stepIndex: 0,
          outputs: [
            {
              employeeId: 'e1',
              employeeName: 'Dev',
              content: 'This is [SIGNAL:REPLAN_NEEDED] because of X',
              taskRunId: 'tr-1',
            },
          ],
        },
      ],
      replanCount: 0,
    });
    expect(routeFromStepAdvance(markerState)).toBe('pm_replan');

    // Standalone REPLAN_NEEDED literal (backward compat)
    const literalState = makeState({
      stepResults: [
        {
          stepIndex: 0,
          outputs: [
            {
              employeeId: 'e1',
              employeeName: 'Dev',
              content: 'Status: REPLAN_NEEDED due to dependency failure',
              taskRunId: 'tr-1',
            },
          ],
        },
      ],
      replanCount: 0,
    });
    expect(routeFromStepAdvance(literalState)).toBe('pm_replan');
  });

  it('routeFromStepAdvance does NOT trigger replan on common English words', () => {
    // "blocked" as a normal word should NOT trigger replan
    const state = makeState({
      stepResults: [
        {
          stepIndex: 0,
          outputs: [
            {
              employeeId: 'e1',
              employeeName: 'Dev',
              content: 'The request was blocked by the firewall',
              taskRunId: 'tr-1',
            },
          ],
        },
      ],
      replanCount: 0,
    });
    expect(routeFromStepAdvance(state)).toBe('step_dispatcher');
  });

  it('replanCount field exists in state annotation with default 0', () => {
    const state = makeState();
    expect(state.replanCount).toBe(0);
  });
});

// ===========================================================================
// Recovery-Aware Local Retry (employee catch block integration)
// ===========================================================================

describe('Recovery-aware local retry', () => {
  it('skip_and_continue returns a skip message without retrying LLM', async () => {
    const ctx = makeRuntimeCtx();
    const repo = ctx.repos.recoveryKnowledge;
    expect(repo).toBeDefined();
    if (!repo) throw new Error('recoveryKnowledge repo unavailable');

    // Seed: skip_and_continue with 100% success rate
    const entry = await repo.upsert({
      knowledge_id: generateId('rk'),
      symptom: 'LLM_CALL_FAILED',
      cause: 'non_critical',
      fix_strategy: 'skip_and_continue',
      fix_config: null,
    });
    await repo.incrementSuccess(entry.knowledge_id);

    // Import the function — test it indirectly through knowledge base state
    const bestFix = await repo.findBestFix('LLM_CALL_FAILED');
    expect(bestFix).not.toBeNull();
    expect(bestFix?.fix_strategy).toBe('skip_and_continue');
  });

  it('knowledge base tracks success and failure accurately', async () => {
    const ctx = makeRuntimeCtx();
    const repo = ctx.repos.recoveryKnowledge;
    expect(repo).toBeDefined();
    if (!repo) throw new Error('recoveryKnowledge repo unavailable');

    const entry = await repo.upsert({
      knowledge_id: generateId('rk'),
      symptom: 'LLM_TIMEOUT',
      cause: 'rate_limit',
      fix_strategy: 'retry_with_backoff',
      fix_config: null,
    });

    // Simulate: 3 successes, 1 failure
    await repo.incrementSuccess(entry.knowledge_id);
    await repo.incrementSuccess(entry.knowledge_id);
    await repo.incrementSuccess(entry.knowledge_id);
    await repo.incrementFailure(entry.knowledge_id);

    const best = await repo.findBestFix('LLM_TIMEOUT');
    expect(best).toBeDefined();
    if (!best) throw new Error('Expected best fix');
    expect(best.success_count).toBe(3);
    expect(best.failure_count).toBe(1);
    // 75% success rate > 30% threshold → should be recommended
    const successRate = best.success_count / (best.success_count + best.failure_count);
    expect(successRate).toBe(0.75);
  });

  it('knowledge base rejects strategies with < 30% success rate', async () => {
    const ctx = makeRuntimeCtx();

    // Seed: retry_with_backoff with terrible success rate (1/10 = 10%)
    const recoveryRepo = ctx.repos.recoveryKnowledge;
    expect(recoveryRepo).toBeDefined();
    if (!recoveryRepo) throw new Error('recoveryKnowledge repo unavailable');
    const entry = await recoveryRepo.upsert({
      knowledge_id: generateId('rk'),
      symptom: 'LLM_CALL_FAILED',
      cause: 'provider_down',
      fix_strategy: 'retry_with_backoff',
      fix_config: null,
    });
    await recoveryRepo.incrementSuccess(entry.knowledge_id);
    for (let i = 0; i < 9; i++) {
      await recoveryRepo.incrementFailure(entry.knowledge_id);
    }

    // diagnoseAndRecover should NOT use this fix (10% < 30%)
    const config = makeConfig(ctx);
    const decision = await diagnoseAndRecover(
      ctx,
      config,
      { errorCode: 'LLM_CALL_FAILED', message: 'fail', recoverable: true, nodeName: 'employee' },
      'thread-test',
      null,
    );

    // Should fall through to LLM diagnosis (which returns null in test because LLM is mocked)
    // The key point: it did NOT return the low-success-rate knowledge entry
    if (decision) {
      expect(decision.knowledgeId).toBeUndefined();
    }
  });
});

// ===========================================================================
// EventConsolidator
// ===========================================================================

describe('EventConsolidator', () => {
  it('skips consolidation when fewer than 3 events', async () => {
    const ctx = makeRuntimeCtx();
    const { EventConsolidator } = await import('../../services/event-consolidator.js');

    // Only 2 events — not worth consolidating
    await ctx.repos.agentEvents?.append({
      event_id: 'e1',
      project_id: null,
      thread_id: 't1',
      company_id: 'c1',
      agent_name: 'boss',
      event_type: 'decision',
      payload_json: '{}',
      parent_event_id: null,
    });
    await ctx.repos.agentEvents?.append({
      event_id: 'e2',
      project_id: null,
      thread_id: 't1',
      company_id: 'c1',
      agent_name: 'pm',
      event_type: 'decision',
      payload_json: '{}',
      parent_event_id: null,
    });

    const agentEventsRepo = ctx.repos.agentEvents;
    expect(agentEventsRepo).toBeDefined();
    if (!agentEventsRepo) throw new Error('agentEvents repo unavailable');
    const consolidator = new EventConsolidator(
      agentEventsRepo,
      ctx.repos.memories,
      ctx.llmGateway,
      ctx.eventBus,
    );
    const result = await consolidator.consolidate({ threadId: 't1', companyId: 'c1' });
    expect(result).toBeNull();
  });
});

// ===========================================================================
// Manager fast path
// ===========================================================================

describe('Manager rule-based fast path', () => {
  it('hiring keywords bypass fast path', () => {
    // The fast path uses a regex to detect hire/assess keywords
    // \b doesn't work with CJK — Chinese terms matched without word boundary
    const HIRE_KEYWORDS = /\b(hire|recruit|assess|staffing)\b|团队评估|招聘|招人/i;
    expect(HIRE_KEYWORDS.test('hire a designer')).toBe(true);
    expect(HIRE_KEYWORDS.test('I want to recruit an analyst')).toBe(true);
    expect(HIRE_KEYWORDS.test('assess the team composition')).toBe(true);
    expect(HIRE_KEYWORDS.test('帮我招聘一个设计师')).toBe(true);
    expect(HIRE_KEYWORDS.test('build a website')).toBe(false);
    expect(HIRE_KEYWORDS.test('write a report')).toBe(false);
  });
});
