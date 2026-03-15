import type { RuntimeEvent } from '@aics/shared-types';
import { HumanMessage } from '@langchain/core/messages';
import type { RunnableConfig } from '@langchain/core/runnables';
import { beforeEach, describe, expect, it } from 'vitest';
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

function makePlan(overrides?: Partial<TaskPlan>): TaskPlan {
  return {
    planId: 'plan-test-1',
    threadId: TEST_THREAD_ID,
    companyId: TEST_COMPANY_ID,
    summary: 'Build a website',
    steps: [
      {
        stepIndex: 0,
        description: 'Build backend',
        tasks: [
          {
            taskType: 'code',
            employeeId: 'e-dev-1',
            description: 'Build REST API',
            dependsOnStepOutput: false,
            taskRunId: 'tr-step0-task0',
          },
        ],
      },
    ],
    ...overrides,
  };
}

function makeState(overrides?: Partial<AicsGraphState>): AicsGraphState {
  return {
    threadId: TEST_THREAD_ID,
    companyId: TEST_COMPANY_ID,
    entryMode: 'boss_chat' as const,
    targetEmployeeId: null,
    messages: [new HumanMessage('Build me a website')],
    routeDecision: 'delegate_manager',
    currentTaskRunId: null,
    currentEmployeeId: null,
    pendingAssignments: [],
    completed: false,
    interruptReason: null,
    meetingId: null,
    managerDirective: null,
    taskPlan: makePlan(),
    currentStepIndex: 0,
    stepResults: [],
    currentStepOutputs: [],
    handoffCount: 0,
    meetingActionItems: [],
    hrAssessment: null,
    meetingInterrupt: null,
    ...overrides,
  };
}

describe('stepDispatcherNode', () => {
  let config: RunnableConfig;
  let events: RuntimeEvent[];
  let repos: ReturnType<typeof createMemoryRepositories>;

  beforeEach(async () => {
    const gateway = new MockLlmGateway();
    repos = createMemoryRepositories();
    repos.seed.companies([TEST_COMPANY]);
    repos.seed.employees([makeManager(), makeEmployee()]);

    const eventBus = new InMemoryEventBus();
    events = [];
    eventBus.on('', (e) => events.push(e));

    const resolver = new ModelResolver(JSON.parse(TEST_COMPANY.default_model_policy_json!));
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

    // Seed task runs that match the plan
    await repos.taskRuns.create({
      task_run_id: 'tr-step0-task0',
      thread_id: TEST_THREAD_ID,
      employee_id: 'e-dev-1',
      parent_task_run_id: null,
      task_type: 'code',
      status: 'planned',
      input_json: JSON.stringify({ description: 'Build REST API' }),
      output_json: null,
      started_at: new Date().toISOString(),
    });
  });

  it('dispatches first step tasks as pendingAssignments', async () => {
    const state = makeState();
    const result = await stepDispatcherNode(state, config);

    expect(result.pendingAssignments).toHaveLength(1);
    expect(result.pendingAssignments?.[0]?.employeeId).toBe('e-dev-1');
    expect(result.pendingAssignments?.[0]?.taskType).toBe('code');
    expect((result.pendingAssignments?.[0]?.inputJson as Record<string, unknown>).description).toBe(
      'Build REST API',
    );
    expect((result.pendingAssignments?.[0]?.inputJson as Record<string, unknown>).taskRunId).toBe(
      'tr-step0-task0',
    );
    expect(result.currentStepOutputs).toEqual([]);
  });

  it('injects previousStepOutput when dependsOnStepOutput is true', async () => {
    const plan = makePlan({
      steps: [
        {
          stepIndex: 0,
          description: 'Research phase',
          tasks: [
            {
              taskType: 'research',
              employeeId: 'e-dev-1',
              description: 'Research APIs',
              dependsOnStepOutput: false,
              taskRunId: 'tr-step0-task0',
            },
          ],
        },
        {
          stepIndex: 1,
          description: 'Implementation phase',
          tasks: [
            {
              taskType: 'code',
              employeeId: 'e-dev-1',
              description: 'Implement based on research',
              dependsOnStepOutput: true,
              taskRunId: 'tr-step1-task0',
            },
          ],
        },
      ],
    });

    // Seed the step 1 task run
    await repos.taskRuns.create({
      task_run_id: 'tr-step1-task0',
      thread_id: TEST_THREAD_ID,
      employee_id: 'e-dev-1',
      parent_task_run_id: null,
      task_type: 'code',
      status: 'planned',
      input_json: JSON.stringify({ description: 'Implement based on research' }),
      output_json: null,
      started_at: new Date().toISOString(),
    });

    const state = makeState({
      taskPlan: plan,
      currentStepIndex: 1,
      stepResults: [
        {
          stepIndex: 0,
          outputs: [
            {
              employeeId: 'e-dev-1',
              employeeName: 'Dev Bot',
              content: 'Found three suitable APIs: A, B, and C.',
              taskRunId: 'tr-step0-task0',
            },
          ],
        },
      ],
    });

    const result = await stepDispatcherNode(state, config);

    expect(result.pendingAssignments).toHaveLength(1);
    const description = (result.pendingAssignments?.[0]?.inputJson as Record<string, unknown>)
      .description as string;
    expect(description).toContain('Implement based on research');
    expect(description).toContain('Previous step results');
    expect(description).toContain('Found three suitable APIs');
  });

  it('emits planStepStarted event', async () => {
    const state = makeState();
    await stepDispatcherNode(state, config);

    const stepEvents = events.filter((e) => e.type === 'plan.step.started');
    expect(stepEvents).toHaveLength(1);
    expect(stepEvents[0]?.payload.planId).toBe('plan-test-1');
    expect(stepEvents[0]?.payload.stepIndex).toBe(0);
    expect(stepEvents[0]?.payload.taskCount).toBe(1);
  });

  it('updates taskRun status from planned to queued', async () => {
    const state = makeState();
    await stepDispatcherNode(state, config);

    const taskRun = await repos.taskRuns.findById('tr-step0-task0');
    expect(taskRun?.status).toBe('queued');

    const taskStateEvents = events.filter((e) => e.type === 'task.state.changed');
    expect(taskStateEvents.length).toBeGreaterThanOrEqual(1);

    const queuedEvent = taskStateEvents.find(
      (e) => e.payload.prev === 'planned' && e.payload.next === 'queued',
    );
    expect(queuedEvent).toBeTruthy();
  });
});
