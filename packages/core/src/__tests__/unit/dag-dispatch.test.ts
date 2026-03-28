/**
 * DAG-aware step dispatch tests.
 *
 * These tests exercise the stepDispatcherNode's ability to dispatch tasks from
 * all steps whose dependencies are satisfied, in any order, without requiring
 * a strictly sequential step index.
 *
 * Test matrix:
 *  1. Sequential plan (no dependsOnSteps) → same one-at-a-time behaviour as before
 *  2. Two independent steps (no deps)     → both dispatched in first round
 *  3. Step 2 depends on both 0 and 1     → dispatched only after both complete
 *  4. Diamond: 0→1, 0→2, 1+2→3          → steps 1 and 2 together, then 3
 *  5. Single step plan                   → immediate dispatch
 */
import { HumanMessage } from '@langchain/core/messages';
import type { RunnableConfig } from '@langchain/core/runnables';
import { beforeEach, describe, expect, it } from 'vitest';
import { stepDispatcherNode } from '../../agents/step-dispatcher-node.js';
import { InMemoryEventBus } from '../../events/event-bus.js';
import type { OffisimGraphState, TaskPlan } from '../../graph/state.js';
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
// Helpers
// ---------------------------------------------------------------------------

function makeState(plan: TaskPlan, overrides?: Partial<OffisimGraphState>): OffisimGraphState {
  return {
    threadId: TEST_THREAD_ID,
    companyId: TEST_COMPANY_ID,
    entryMode: 'boss_chat' as const,
    targetEmployeeId: null,
    messages: [new HumanMessage('Run plan')],
    routeDecision: 'delegate_manager',
    currentTaskRunId: null,
    currentEmployeeId: null,
    pendingAssignments: [],
    completed: false,
    interruptReason: null,
    meetingId: null,
    managerDirective: null,
    taskPlan: plan,
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

async function seedTaskRun(
  repos: ReturnType<typeof createMemoryRepositories>,
  taskRunId: string,
  employeeId = 'e-dev-1',
  taskType = 'general',
) {
  await repos.taskRuns.create({
    task_run_id: taskRunId,
    thread_id: TEST_THREAD_ID,
    employee_id: employeeId,
    parent_task_run_id: null,
    task_type: taskType,
    status: 'planned',
    input_json: JSON.stringify({ description: `Task ${taskRunId}` }),
    output_json: null,
    started_at: new Date().toISOString(),
  });
}

// ---------------------------------------------------------------------------
// Setup
// ---------------------------------------------------------------------------

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
});

// ---------------------------------------------------------------------------
// 1. Sequential plan — legacy behaviour preserved
// ---------------------------------------------------------------------------

describe('sequential plan (no dependsOnSteps)', () => {
  const plan: TaskPlan = {
    planId: 'plan-seq',
    threadId: TEST_THREAD_ID,
    companyId: TEST_COMPANY_ID,
    summary: 'Sequential plan',
    steps: [
      {
        stepIndex: 0,
        description: 'Step A',
        tasks: [
          {
            taskType: 'code',
            employeeId: 'e-dev-1',
            description: 'Do A',
            dependsOnStepOutput: false,
            taskRunId: 'tr-seq-0',
          },
        ],
      },
      {
        stepIndex: 1,
        description: 'Step B',
        tasks: [
          {
            taskType: 'code',
            employeeId: 'e-dev-1',
            description: 'Do B',
            dependsOnStepOutput: false,
            taskRunId: 'tr-seq-1',
          },
        ],
      },
    ],
  };

  beforeEach(async () => {
    await seedTaskRun(repos, 'tr-seq-0');
    await seedTaskRun(repos, 'tr-seq-1');
  });

  it('dispatches only step 0 on first round (step 1 must wait for step 0 to complete)', async () => {
    const state = makeState(plan);
    const result = await stepDispatcherNode(state, config);

    expect(result.pendingAssignments).toHaveLength(1);
    expect((result.pendingAssignments?.[0]?.inputJson as Record<string, unknown>).taskRunId).toBe(
      'tr-seq-0',
    );
  });

  it('dispatches step 1 once step 0 is in completedStepIndices', async () => {
    const state = makeState(plan, {
      currentStepIndex: 1,
      dispatchedStepIndices: [0],
      completedStepIndices: [0],
    });
    const result = await stepDispatcherNode(state, config);

    expect(result.pendingAssignments).toHaveLength(1);
    const tr = (result.pendingAssignments?.[0]?.inputJson as Record<string, unknown>).taskRunId;
    expect(tr).toBe('tr-seq-1');
  });

  it('dispatches nothing when step 0 is dispatched but not complete', async () => {
    const state = makeState(plan, {
      dispatchedStepIndices: [0],
      completedStepIndices: [],
    });
    const result = await stepDispatcherNode(state, config);

    // Step 0 already dispatched; step 1's implicit dep on step 0 not satisfied
    expect(result.pendingAssignments).toHaveLength(0);
  });
});

// ---------------------------------------------------------------------------
// 2. Two independent steps — both dispatched in first round
// ---------------------------------------------------------------------------

describe('two independent DAG steps', () => {
  const plan: TaskPlan = {
    planId: 'plan-parallel',
    threadId: TEST_THREAD_ID,
    companyId: TEST_COMPANY_ID,
    summary: 'Parallel steps',
    steps: [
      {
        stepIndex: 0,
        description: 'Step A (no deps)',
        dependsOnSteps: [],
        tasks: [
          {
            taskType: 'code',
            employeeId: 'e-dev-1',
            description: 'Do A',
            dependsOnStepOutput: false,
            taskRunId: 'tr-par-0',
          },
        ],
      },
      {
        stepIndex: 1,
        description: 'Step B (no deps)',
        dependsOnSteps: [],
        tasks: [
          {
            taskType: 'code',
            employeeId: 'e-dev-1',
            description: 'Do B',
            dependsOnStepOutput: false,
            taskRunId: 'tr-par-1',
          },
        ],
      },
    ],
  };

  beforeEach(async () => {
    await seedTaskRun(repos, 'tr-par-0');
    await seedTaskRun(repos, 'tr-par-1');
  });

  it('dispatches BOTH steps in first round because neither has dependencies', async () => {
    const state = makeState(plan);
    const result = await stepDispatcherNode(state, config);

    expect(result.pendingAssignments).toHaveLength(2);
    const taskRunIds = result.pendingAssignments?.map(
      (a) => (a.inputJson as Record<string, unknown>).taskRunId,
    );
    expect(taskRunIds).toContain('tr-par-0');
    expect(taskRunIds).toContain('tr-par-1');
  });

  it('records both steps in dispatchedStepIndices after first round', async () => {
    const state = makeState(plan);
    const result = await stepDispatcherNode(state, config);

    expect(result.dispatchedStepIndices).toEqual(expect.arrayContaining([0, 1]));
  });
});

// ---------------------------------------------------------------------------
// 3. Step 2 depends on steps 0 AND 1
// ---------------------------------------------------------------------------

describe('fan-in: step 2 depends on step 0 and step 1', () => {
  const plan: TaskPlan = {
    planId: 'plan-fanin',
    threadId: TEST_THREAD_ID,
    companyId: TEST_COMPANY_ID,
    summary: 'Fan-in plan',
    steps: [
      {
        stepIndex: 0,
        description: 'Step 0 (no deps)',
        dependsOnSteps: [],
        tasks: [
          {
            taskType: 'code',
            employeeId: 'e-dev-1',
            description: 'Do 0',
            dependsOnStepOutput: false,
            taskRunId: 'tr-fi-0',
          },
        ],
      },
      {
        stepIndex: 1,
        description: 'Step 1 (no deps)',
        dependsOnSteps: [],
        tasks: [
          {
            taskType: 'code',
            employeeId: 'e-dev-1',
            description: 'Do 1',
            dependsOnStepOutput: false,
            taskRunId: 'tr-fi-1',
          },
        ],
      },
      {
        stepIndex: 2,
        description: 'Step 2 (depends on 0 and 1)',
        dependsOnSteps: [0, 1],
        tasks: [
          {
            taskType: 'code',
            employeeId: 'e-dev-1',
            description: 'Do 2',
            dependsOnStepOutput: false,
            taskRunId: 'tr-fi-2',
          },
        ],
      },
    ],
  };

  beforeEach(async () => {
    await seedTaskRun(repos, 'tr-fi-0');
    await seedTaskRun(repos, 'tr-fi-1');
    await seedTaskRun(repos, 'tr-fi-2');
  });

  it('dispatches steps 0 and 1 together in first round', async () => {
    const state = makeState(plan);
    const result = await stepDispatcherNode(state, config);

    expect(result.pendingAssignments).toHaveLength(2);
    const trs = result.pendingAssignments?.map(
      (a) => (a.inputJson as Record<string, unknown>).taskRunId,
    );
    expect(trs).toContain('tr-fi-0');
    expect(trs).toContain('tr-fi-1');
  });

  it('does NOT dispatch step 2 when only step 0 is complete (step 1 still missing)', async () => {
    const state = makeState(plan, {
      dispatchedStepIndices: [0, 1],
      completedStepIndices: [0], // only step 0 done
    });
    const result = await stepDispatcherNode(state, config);

    expect(result.pendingAssignments).toHaveLength(0);
  });

  it('dispatches step 2 once both step 0 and step 1 are complete', async () => {
    const state = makeState(plan, {
      dispatchedStepIndices: [0, 1],
      completedStepIndices: [0, 1],
    });
    const result = await stepDispatcherNode(state, config);

    expect(result.pendingAssignments).toHaveLength(1);
    const tr = (result.pendingAssignments?.[0]?.inputJson as Record<string, unknown>).taskRunId;
    expect(tr).toBe('tr-fi-2');
  });
});

// ---------------------------------------------------------------------------
// 4. Diamond dependency: 0→1, 0→2, 1+2→3
// ---------------------------------------------------------------------------

describe('diamond dependency: 0→1, 0→2, then 1+2→3', () => {
  const plan: TaskPlan = {
    planId: 'plan-diamond',
    threadId: TEST_THREAD_ID,
    companyId: TEST_COMPANY_ID,
    summary: 'Diamond plan',
    steps: [
      {
        stepIndex: 0,
        description: 'Root (no deps)',
        dependsOnSteps: [],
        tasks: [
          {
            taskType: 'code',
            employeeId: 'e-dev-1',
            description: 'Root',
            dependsOnStepOutput: false,
            taskRunId: 'tr-dia-0',
          },
        ],
      },
      {
        stepIndex: 1,
        description: 'Branch A (depends on 0)',
        dependsOnSteps: [0],
        tasks: [
          {
            taskType: 'code',
            employeeId: 'e-dev-1',
            description: 'Branch A',
            dependsOnStepOutput: false,
            taskRunId: 'tr-dia-1',
          },
        ],
      },
      {
        stepIndex: 2,
        description: 'Branch B (depends on 0)',
        dependsOnSteps: [0],
        tasks: [
          {
            taskType: 'code',
            employeeId: 'e-dev-1',
            description: 'Branch B',
            dependsOnStepOutput: false,
            taskRunId: 'tr-dia-2',
          },
        ],
      },
      {
        stepIndex: 3,
        description: 'Merge (depends on 1 and 2)',
        dependsOnSteps: [1, 2],
        tasks: [
          {
            taskType: 'code',
            employeeId: 'e-dev-1',
            description: 'Merge',
            dependsOnStepOutput: false,
            taskRunId: 'tr-dia-3',
          },
        ],
      },
    ],
  };

  beforeEach(async () => {
    await seedTaskRun(repos, 'tr-dia-0');
    await seedTaskRun(repos, 'tr-dia-1');
    await seedTaskRun(repos, 'tr-dia-2');
    await seedTaskRun(repos, 'tr-dia-3');
  });

  it('Round 1: dispatches only step 0', async () => {
    const state = makeState(plan);
    const result = await stepDispatcherNode(state, config);

    expect(result.pendingAssignments).toHaveLength(1);
    const tr = (result.pendingAssignments?.[0]?.inputJson as Record<string, unknown>).taskRunId;
    expect(tr).toBe('tr-dia-0');
  });

  it('Round 2: dispatches steps 1 and 2 after step 0 completes', async () => {
    const state = makeState(plan, {
      dispatchedStepIndices: [0],
      completedStepIndices: [0],
    });
    const result = await stepDispatcherNode(state, config);

    expect(result.pendingAssignments).toHaveLength(2);
    const trs = result.pendingAssignments?.map(
      (a) => (a.inputJson as Record<string, unknown>).taskRunId,
    );
    expect(trs).toContain('tr-dia-1');
    expect(trs).toContain('tr-dia-2');
  });

  it('Round 3: dispatches step 3 only after both steps 1 and 2 complete', async () => {
    const state = makeState(plan, {
      dispatchedStepIndices: [0, 1, 2],
      completedStepIndices: [0, 1, 2],
    });
    const result = await stepDispatcherNode(state, config);

    expect(result.pendingAssignments).toHaveLength(1);
    const tr = (result.pendingAssignments?.[0]?.inputJson as Record<string, unknown>).taskRunId;
    expect(tr).toBe('tr-dia-3');
  });

  it('does NOT dispatch step 3 when only step 1 is done (step 2 still running)', async () => {
    const state = makeState(plan, {
      dispatchedStepIndices: [0, 1, 2],
      completedStepIndices: [0, 1], // step 2 not yet done
    });
    const result = await stepDispatcherNode(state, config);

    expect(result.pendingAssignments).toHaveLength(0);
  });
});

// ---------------------------------------------------------------------------
// 5. Single step plan — immediate dispatch and no blocking
// ---------------------------------------------------------------------------

describe('single step plan', () => {
  const plan: TaskPlan = {
    planId: 'plan-single',
    threadId: TEST_THREAD_ID,
    companyId: TEST_COMPANY_ID,
    summary: 'Single step',
    steps: [
      {
        stepIndex: 0,
        description: 'Only step',
        dependsOnSteps: [],
        tasks: [
          {
            taskType: 'code',
            employeeId: 'e-dev-1',
            description: 'Do it',
            dependsOnStepOutput: false,
            taskRunId: 'tr-single-0',
          },
        ],
      },
    ],
  };

  beforeEach(async () => {
    await seedTaskRun(repos, 'tr-single-0');
  });

  it('dispatches the single step immediately', async () => {
    const state = makeState(plan);
    const result = await stepDispatcherNode(state, config);

    expect(result.pendingAssignments).toHaveLength(1);
    const tr = (result.pendingAssignments?.[0]?.inputJson as Record<string, unknown>).taskRunId;
    expect(tr).toBe('tr-single-0');
  });

  it('dispatches nothing on second call (step already dispatched)', async () => {
    const state = makeState(plan, { dispatchedStepIndices: [0] });
    const result = await stepDispatcherNode(state, config);

    expect(result.pendingAssignments).toHaveLength(0);
  });
});

// ---------------------------------------------------------------------------
// 6. DAG output injection from dependency steps
// ---------------------------------------------------------------------------

describe('dependency output injection', () => {
  const plan: TaskPlan = {
    planId: 'plan-output-inject',
    threadId: TEST_THREAD_ID,
    companyId: TEST_COMPANY_ID,
    summary: 'Output injection',
    steps: [
      {
        stepIndex: 0,
        description: 'Research',
        dependsOnSteps: [],
        tasks: [
          {
            taskType: 'research',
            employeeId: 'e-dev-1',
            description: 'Research topic',
            dependsOnStepOutput: false,
            taskRunId: 'tr-oi-0',
          },
        ],
      },
      {
        stepIndex: 1,
        description: 'Write based on research',
        dependsOnSteps: [0],
        tasks: [
          {
            taskType: 'write',
            employeeId: 'e-dev-1',
            description: 'Write report',
            dependsOnStepOutput: true,
            taskRunId: 'tr-oi-1',
          },
        ],
      },
    ],
  };

  beforeEach(async () => {
    await seedTaskRun(repos, 'tr-oi-0', 'e-dev-1', 'research');
    await seedTaskRun(repos, 'tr-oi-1', 'e-dev-1', 'write');
  });

  it('injects dependency step output when dependsOnStepOutput is true and dep is complete', async () => {
    const state = makeState(plan, {
      dispatchedStepIndices: [0],
      completedStepIndices: [0],
      stepResults: [
        {
          stepIndex: 0,
          outputs: [
            {
              employeeId: 'e-dev-1',
              employeeName: 'Dev Bot',
              content: 'Key finding: X is better than Y.',
              taskRunId: 'tr-oi-0',
            },
          ],
        },
      ],
    });

    const result = await stepDispatcherNode(state, config);

    expect(result.pendingAssignments).toHaveLength(1);
    const description = (result.pendingAssignments?.[0]?.inputJson as Record<string, unknown>)
      .description as string;
    expect(description).toContain('Write report');
    expect(description).toContain('Previous step results');
    expect(description).toContain('Key finding: X is better than Y.');
  });
});
