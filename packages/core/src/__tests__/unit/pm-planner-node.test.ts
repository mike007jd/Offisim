import type { PlanCreatedPayload, RuntimeEvent } from '@aics/shared-types';
import { HumanMessage } from '@langchain/core/messages';
import type { RunnableConfig } from '@langchain/core/runnables';
import { beforeEach, describe, expect, it } from 'vitest';
import { pmPlannerNode } from '../../agents/pm-planner-node.js';
import { InMemoryEventBus } from '../../events/event-bus.js';
import type { AicsGraphState } from '../../graph/state.js';
import { createMemoryRepositories } from '../../runtime/memory-repositories.js';
import { createRuntimeContext } from '../../runtime/runtime-context.js';
import { MockToolExecutor } from '../../runtime/tool-executor.js';
import {
  TEST_COMPANY,
  TEST_COMPANY_ID,
  TEST_THREAD_ID,
  assertDefined,
  createTestModelResolver,
  makeEmployee,
  makeManager,
} from '../helpers/fixtures.js';
import { MockLlmGateway } from '../helpers/mock-gateway.js';

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
    managerDirective: {
      intent: 'Build me a website',
      recommendedEmployees: ['e-dev-1'],
    },
    taskPlan: null,
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

describe('pmPlannerNode', () => {
  let gateway: MockLlmGateway;
  let config: RunnableConfig;
  let events: RuntimeEvent[];
  let repos: ReturnType<typeof createMemoryRepositories>;

  beforeEach(() => {
    gateway = new MockLlmGateway();
    repos = createMemoryRepositories();
    repos.seed.companies([TEST_COMPANY]);
    repos.seed.employees([makeManager(), makeEmployee()]);

    const eventBus = new InMemoryEventBus();
    events = [];
    eventBus.on('', (e) => events.push(e));

    const resolver = createTestModelResolver();
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

  it('generates multi-step plan from manager directive', async () => {
    gateway.pushResponse({
      content: JSON.stringify({
        summary: 'Build a website with backend and frontend',
        steps: [
          {
            stepIndex: 0,
            description: 'Implement backend API',
            tasks: [
              {
                taskType: 'code',
                employeeId: 'e-dev-1',
                description: 'Build REST endpoints',
                dependsOnStepOutput: false,
              },
            ],
          },
          {
            stepIndex: 1,
            description: 'Implement frontend',
            tasks: [
              {
                taskType: 'code',
                employeeId: 'e-dev-1',
                description: 'Build React components',
                dependsOnStepOutput: true,
              },
            ],
          },
        ],
      }),
    });

    const state = makeState();
    const result = await pmPlannerNode(state, config);

    expect(result.taskPlan).not.toBeNull();
    expect(result.taskPlan?.steps).toHaveLength(2);
    expect(result.taskPlan?.steps[0]?.stepIndex).toBe(0);
    expect(result.taskPlan?.steps[1]?.stepIndex).toBe(1);
    expect(result.taskPlan?.summary).toBe('Build a website with backend and frontend');
    expect(result.currentStepIndex).toBe(0);
    expect(result.stepResults).toEqual([]);
    expect(result.currentStepOutputs).toEqual([]);
  });

  it('creates taskRun records for each planned task', async () => {
    gateway.pushResponse({
      content: JSON.stringify({
        summary: 'Build a website',
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
      }),
    });

    const state = makeState();
    const result = await pmPlannerNode(state, config);

    // taskRunId should be set on each task
    const task = assertDefined(result.taskPlan?.steps[0]?.tasks[0]);
    expect(task.taskRunId).toBeTruthy();
    expect(task.taskRunId).toMatch(/^tr-/);

    // Verify taskRun was created in repository
    const taskRuns = await repos.taskRuns.findByThread(TEST_THREAD_ID);
    expect(taskRuns).toHaveLength(1);
    expect(taskRuns[0]?.status).toBe('planned');
    expect(taskRuns[0]?.employee_id).toBe('e-dev-1');
  });

  it('emits planCreated event', async () => {
    gateway.pushResponse({
      content: JSON.stringify({
        summary: 'Build a website',
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
      }),
    });

    const state = makeState();
    await pmPlannerNode(state, config);

    const planEvents = events.filter((e) => e.type === 'plan.created');
    expect(planEvents).toHaveLength(1);
    const payload = planEvents[0]?.payload as unknown as PlanCreatedPayload;
    expect(payload.steps).toHaveLength(1);
    expect(payload.steps[0]?.taskCount).toBe(1);
  });

  it('falls back to single-step plan when LLM response is unparseable', async () => {
    gateway.pushResponse({
      content: 'I think we should build a website step by step.',
    });

    const state = makeState();
    const result = await pmPlannerNode(state, config);

    expect(result.taskPlan).not.toBeNull();
    expect(result.taskPlan?.steps).toHaveLength(1);
    expect(result.taskPlan?.steps[0]?.tasks).toHaveLength(1);
    expect(result.taskPlan?.steps[0]?.tasks[0]?.employeeId).toBe('e-dev-1');
    expect(result.taskPlan?.steps[0]?.tasks[0]?.taskType).toBe('general');
  });

  it('returns empty plan when directive has no recommended employees', async () => {
    const state = makeState({
      managerDirective: {
        intent: 'Build me a website',
        recommendedEmployees: [],
      },
    });

    const result = await pmPlannerNode(state, config);

    expect(result.taskPlan).toBeNull();
    expect(result.currentStepIndex).toBe(0);
    expect(result.stepResults).toEqual([]);
  });
});
