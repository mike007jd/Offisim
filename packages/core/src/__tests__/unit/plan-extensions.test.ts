import { HumanMessage } from '@langchain/core/messages';
import type { RunnableConfig } from '@langchain/core/runnables';
import { beforeEach, describe, expect, it } from 'vitest';
import { parsePmPlan } from '../../agents/pm-planner-node.js';
import { stepDispatcherNode } from '../../agents/step-dispatcher-node.js';
import { InMemoryEventBus } from '../../events/event-bus.js';
import type { AicsGraphState, TaskPlan } from '../../graph/state.js';
import { ModelResolver } from '../../llm/model-resolver.js';
import { createMemoryRepositories } from '../../runtime/memory-repositories.js';
import { createRuntimeContext } from '../../runtime/runtime-context.js';
import { MockToolExecutor } from '../../runtime/tool-executor.js';
import {
  TEST_COMPANY,
  TEST_COMPANY_ID,
  TEST_THREAD_ID,
  makeEmployee,
  makeManager,
} from '../helpers/fixtures.js';
import { MockLlmGateway } from '../helpers/mock-gateway.js';

// ---------------------------------------------------------------------------
// parsePmPlan unit tests
// ---------------------------------------------------------------------------

describe('parsePmPlan — phase and dependsOnSteps preservation', () => {
  it('preserves phase when present in LLM output', () => {
    const content = JSON.stringify({
      summary: 'Multi-phase project',
      steps: [
        {
          stepIndex: 0,
          phase: '需求调研',
          description: 'Research requirements',
          dependsOnSteps: [],
          tasks: [
            {
              taskType: 'research',
              employeeId: 'e-dev-1',
              description: 'Gather user stories',
              dependsOnStepOutput: false,
            },
          ],
        },
        {
          stepIndex: 1,
          phase: '核心开发',
          description: 'Implement core features',
          dependsOnSteps: [0],
          tasks: [
            {
              taskType: 'code',
              employeeId: 'e-dev-1',
              description: 'Write backend',
              dependsOnStepOutput: true,
            },
          ],
        },
      ],
    });

    const result = parsePmPlan(content);

    expect(result).not.toBeNull();
    expect(result?.steps).toHaveLength(2);
    expect(result?.steps[0]?.phase).toBe('需求调研');
    expect(result?.steps[1]?.phase).toBe('核心开发');
  });

  it('preserves dependsOnSteps array and filters non-numbers', () => {
    const content = JSON.stringify({
      summary: 'DAG plan',
      steps: [
        {
          stepIndex: 0,
          description: 'Step A',
          dependsOnSteps: [],
          tasks: [
            {
              taskType: 'general',
              employeeId: 'e-dev-1',
              description: 'Do A',
              dependsOnStepOutput: false,
            },
          ],
        },
        {
          stepIndex: 1,
          description: 'Step B depends on A',
          // Mixed array: valid numbers plus invalid entries that must be filtered
          dependsOnSteps: [0, 'invalid', null, 2, true],
          tasks: [
            {
              taskType: 'general',
              employeeId: 'e-dev-1',
              description: 'Do B',
              dependsOnStepOutput: false,
            },
          ],
        },
      ],
    });

    const result = parsePmPlan(content);

    expect(result).not.toBeNull();
    // Step A: empty array stays empty
    expect(result?.steps[0]?.dependsOnSteps).toEqual([]);
    // Step B: only numeric entries survive
    expect(result?.steps[1]?.dependsOnSteps).toEqual([0, 2]);
  });

  it('backward compat: old-format plans without phase/dependsOnSteps still parse', () => {
    // Old LLM output that does not include phase or dependsOnSteps
    const content = JSON.stringify({
      summary: 'Legacy plan',
      steps: [
        {
          stepIndex: 0,
          description: 'Build feature',
          tasks: [
            {
              taskType: 'code',
              employeeId: 'e-dev-1',
              description: 'Write code',
              dependsOnStepOutput: false,
            },
          ],
        },
      ],
    });

    const result = parsePmPlan(content);

    expect(result).not.toBeNull();
    expect(result?.steps).toHaveLength(1);
    expect(result?.steps[0]?.phase).toBeUndefined();
    expect(result?.steps[0]?.dependsOnSteps).toBeUndefined();
    // Core fields intact
    expect(result?.steps[0]?.stepIndex).toBe(0);
    expect(result?.steps[0]?.description).toBe('Build feature');
    expect(result?.steps[0]?.tasks).toHaveLength(1);
  });

  it('returns null for completely malformed input', () => {
    expect(parsePmPlan('not json at all')).toBeNull();
    expect(parsePmPlan(JSON.stringify({ summary: 'no steps' }))).toBeNull();
    expect(parsePmPlan(JSON.stringify({ steps: [] }))).toBeNull();
  });

  it('ignores steps with no valid tasks', () => {
    const content = JSON.stringify({
      summary: 'Partial plan',
      steps: [
        {
          stepIndex: 0,
          description: 'Empty step',
          tasks: [],
        },
        {
          stepIndex: 1,
          description: 'Valid step',
          tasks: [
            {
              taskType: 'code',
              employeeId: 'e-dev-1',
              description: 'Do something',
              dependsOnStepOutput: false,
            },
          ],
        },
      ],
    });

    const result = parsePmPlan(content);

    expect(result).not.toBeNull();
    // Only the step with tasks survives
    expect(result?.steps).toHaveLength(1);
    expect(result?.steps[0]?.stepIndex).toBe(1);
  });
});

// ---------------------------------------------------------------------------
// stepDispatcherNode — sequential dispatch ignores dependsOnSteps DAG field
// ---------------------------------------------------------------------------

function makePlanWithDag(): TaskPlan {
  return {
    planId: 'plan-dag-test',
    threadId: TEST_THREAD_ID,
    companyId: TEST_COMPANY_ID,
    summary: 'DAG-annotated plan that still dispatches sequentially',
    steps: [
      {
        stepIndex: 0,
        phase: '研究',
        description: 'Research phase',
        dependsOnSteps: [],
        tasks: [
          {
            taskType: 'research',
            employeeId: 'e-dev-1',
            description: 'Gather requirements',
            dependsOnStepOutput: false,
            taskRunId: 'tr-dag-step0',
          },
        ],
      },
      {
        stepIndex: 1,
        phase: '开发',
        description: 'Development phase',
        dependsOnSteps: [0],
        tasks: [
          {
            taskType: 'code',
            employeeId: 'e-dev-1',
            description: 'Implement feature',
            dependsOnStepOutput: true,
            taskRunId: 'tr-dag-step1',
          },
        ],
      },
    ],
  };
}

function makeState(overrides?: Partial<AicsGraphState>): AicsGraphState {
  return {
    threadId: TEST_THREAD_ID,
    companyId: TEST_COMPANY_ID,
    entryMode: 'boss_chat' as const,
    targetEmployeeId: null,
    messages: [new HumanMessage('Do something')],
    routeDecision: 'delegate_manager',
    currentTaskRunId: null,
    currentEmployeeId: null,
    pendingAssignments: [],
    completed: false,
    interruptReason: null,
    meetingId: null,
    managerDirective: null,
    taskPlan: makePlanWithDag(),
    currentStepIndex: 0,
    stepResults: [],
    currentStepOutputs: [],
    handoffCount: 0,
    meetingActionItems: [],
    hrAssessment: null,
    replanCount: 0,
    projectId: null,
    meetingInterrupt: null,
    dispatchedStepIndices: [],
    completedStepIndices: [],
    ...overrides,
  };
}

describe('stepDispatcherNode — DAG-aware dispatch with annotated plan', () => {
  let config: RunnableConfig;
  let repos: ReturnType<typeof createMemoryRepositories>;

  beforeEach(async () => {
    const gateway = new MockLlmGateway();
    repos = createMemoryRepositories();
    repos.seed.companies([TEST_COMPANY]);
    repos.seed.employees([makeManager(), makeEmployee()]);

    const eventBus = new InMemoryEventBus();
    const resolver = new ModelResolver(JSON.parse(TEST_COMPANY.default_model_policy_json));
    const toolExecutor = new MockToolExecutor();

    const runtimeCtx = createRuntimeContext({
      repos,
      eventBus,
      llmGateway: gateway,
      modelResolver: resolver,
      toolExecutor,
      companyId: TEST_COMPANY_ID,
      threadId: TEST_THREAD_ID,
    });

    config = { configurable: { runtimeCtx } };

    // Seed task runs referenced by the plan
    await repos.taskRuns.create({
      task_run_id: 'tr-dag-step0',
      thread_id: TEST_THREAD_ID,
      employee_id: 'e-dev-1',
      parent_task_run_id: null,
      task_type: 'research',
      status: 'planned',
      input_json: JSON.stringify({ description: 'Gather requirements' }),
      output_json: null,
      started_at: new Date().toISOString(),
    });

    await repos.taskRuns.create({
      task_run_id: 'tr-dag-step1',
      thread_id: TEST_THREAD_ID,
      employee_id: 'e-dev-1',
      parent_task_run_id: null,
      task_type: 'code',
      status: 'planned',
      input_json: JSON.stringify({ description: 'Implement feature' }),
      output_json: null,
      started_at: new Date().toISOString(),
    });
  });

  it('dispatches step 0 first (no dependencies, so ready immediately)', async () => {
    const state = makeState({ currentStepIndex: 0 });
    const result = await stepDispatcherNode(state, config);

    expect(result.pendingAssignments).toHaveLength(1);
    expect(result.pendingAssignments?.[0]?.employeeId).toBe('e-dev-1');
    expect(result.pendingAssignments?.[0]?.taskType).toBe('research');
  });

  it('does NOT dispatch step 1 until step 0 is in completedStepIndices (DAG dependency)', async () => {
    // Step 1 has dependsOnSteps: [0]. Since completedStepIndices is empty,
    // step 1 must NOT be dispatched.
    const state = makeState({
      currentStepIndex: 0,
      dispatchedStepIndices: [0],
      completedStepIndices: [], // step 0 dispatched but not yet complete
    });

    const result = await stepDispatcherNode(state, config);

    // Neither step 0 (already dispatched) nor step 1 (dep not satisfied) should be dispatched
    expect(result.pendingAssignments).toHaveLength(0);
  });

  it('dispatches step 1 once step 0 is complete, injecting dependency output', async () => {
    // Step 0 is in completedStepIndices → step 1's dependency is satisfied.
    const state = makeState({
      currentStepIndex: 1,
      dispatchedStepIndices: [0],
      completedStepIndices: [0],
      stepResults: [
        {
          stepIndex: 0,
          outputs: [
            {
              employeeId: 'e-dev-1',
              employeeName: 'Dev Bot',
              content: 'Requirements gathered.',
              taskRunId: 'tr-dag-step0',
            },
          ],
        },
      ],
    });

    const result = await stepDispatcherNode(state, config);

    expect(result.pendingAssignments).toHaveLength(1);
    expect(result.pendingAssignments?.[0]?.taskType).toBe('code');
    // dependsOnStepOutput: true — dependency step output must be injected
    const description = (result.pendingAssignments?.[0]?.inputJson as Record<string, unknown>)
      .description as string;
    expect(description).toContain('Implement feature');
    expect(description).toContain('Requirements gathered.');
  });

  it('phase field is preserved on PlanStep and accessible after dispatch', async () => {
    const state = makeState({ currentStepIndex: 0 });
    // Dispatching does not strip phase — the plan remains intact in state
    expect(state.taskPlan?.steps[0]?.phase).toBe('研究');
    expect(state.taskPlan?.steps[1]?.phase).toBe('开发');
    // dispatch completes without error
    const result = await stepDispatcherNode(state, config);
    expect(result.pendingAssignments).toHaveLength(1);
  });
});
