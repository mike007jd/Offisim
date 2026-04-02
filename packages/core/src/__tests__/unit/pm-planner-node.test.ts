import { HumanMessage } from '@langchain/core/messages';
import type { RunnableConfig } from '@langchain/core/runnables';
import {
  type InteractionRequest,
  PLAN_REVIEW_REQUIRED,
  type PlanCreatedPayload,
  type RuntimeEvent,
} from '@offisim/shared-types';
import { beforeEach, describe, expect, it } from 'vitest';
import {
  PM_SYSTEM_PROMPT,
  findEmployeeForRole,
  parsePmPlan,
  pmPlannerNode,
} from '../../agents/pm-planner-node.js';
import { InMemoryEventBus } from '../../events/event-bus.js';
import type { OffisimGraphState } from '../../graph/state.js';
import { createMemoryRepositories } from '../../runtime/memory-repositories.js';
import { createRuntimeContext } from '../../runtime/runtime-context.js';
import { MockToolExecutor } from '../../runtime/tool-executor.js';
import { InteractionService } from '../../services/interaction-service.js';
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

function makeState(overrides?: Partial<OffisimGraphState>): OffisimGraphState {
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

function makePlanReviewRequest(overrides?: Partial<InteractionRequest>): InteractionRequest {
  return {
    interactionId: overrides?.interactionId ?? 'ix-plan-1',
    threadId: overrides?.threadId ?? TEST_THREAD_ID,
    companyId: overrides?.companyId ?? TEST_COMPANY_ID,
    kind: 'plan_review',
    severity: overrides?.severity ?? 'normal',
    title: overrides?.title ?? 'Review plan before execution',
    prompt: overrides?.prompt ?? 'Review the generated plan before execution.',
    options: overrides?.options ?? [
      { id: 'start_execution', label: 'Start execution', recommended: true },
      { id: 'revise_plan', label: 'Revise plan' },
      { id: 'cancel', label: 'Cancel' },
    ],
    recommendation: overrides?.recommendation,
    allowFreeformResponse: overrides?.allowFreeformResponse ?? true,
    requestedByNode: overrides?.requestedByNode ?? 'pm_planner',
    employeeId: overrides?.employeeId ?? null,
    taskRunId: overrides?.taskRunId ?? null,
    context: overrides?.context ?? { type: 'plan_review', planId: null },
    createdAt: overrides?.createdAt ?? Date.now(),
  };
}

describe('pmPlannerNode', () => {
  let gateway: MockLlmGateway;
  let config: RunnableConfig;
  let events: RuntimeEvent[];
  let repos: ReturnType<typeof createMemoryRepositories>;
  let eventBus: InMemoryEventBus;

  beforeEach(() => {
    gateway = new MockLlmGateway();
    repos = createMemoryRepositories();
    repos.seed.companies([TEST_COMPANY]);
    repos.seed.employees([makeManager(), makeEmployee()]);

    eventBus = new InMemoryEventBus();
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

  it('prefers employees whose installed skill matches the requested skill', () => {
    const planner = makeEmployee({
      employee_id: 'e-pm-1',
      role_slug: 'developer',
      config_json: JSON.stringify({
        runtimeSkill: {
          skillName: 'SOP Planner',
          summary: 'Breaks work into SOP-backed plans',
        },
      }),
    });
    const generic = makeEmployee({
      employee_id: 'e-pm-2',
      role_slug: 'developer',
      config_json: JSON.stringify({
        runtimeSkill: {
          skillName: 'Generalist',
          summary: 'Can help with many tasks',
        },
      }),
    });

    const match = findEmployeeForRole([generic, planner], 'developer', 'planner');

    expect(match?.employee_id).toBe('e-pm-1');
  });

  it('parses requiredSkills from the PM plan schema', () => {
    const plan = parsePmPlan(
      JSON.stringify({
        summary: 'Use the browser automation specialist',
        steps: [
          {
            stepIndex: 0,
            description: 'Verify browser flow',
            tasks: [
              {
                taskType: 'code',
                employeeId: 'e-dev-1',
                description: 'Run the browser verification flow',
                dependsOnStepOutput: false,
                requiredSkills: ['playwright', 'browser automation'],
              },
            ],
          },
        ],
      }),
    );

    expect(plan?.steps[0]?.tasks[0]?.requiredSkills).toEqual(['playwright', 'browser automation']);
  });

  it('requests plan review in human-in-loop mode before creating task runs', async () => {
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

    const interactionService = new InteractionService({
      eventBus,
      companyId: TEST_COMPANY_ID,
      threadId: TEST_THREAD_ID,
      defaultMode: 'human_in_loop',
    });
    const runtimeCtx = createRuntimeContext({
      repos,
      eventBus,
      llmGateway: gateway,
      modelResolver: createTestModelResolver(),
      toolExecutor: new MockToolExecutor(),
      companyId: TEST_COMPANY_ID,
      threadId: TEST_THREAD_ID,
      interactionService,
    });

    await expect(pmPlannerNode(makeState(), { configurable: { runtimeCtx } })).rejects.toThrow(
      PLAN_REVIEW_REQUIRED,
    );

    expect(interactionService.getPending()).toMatchObject({
      kind: 'plan_review',
      requestedByNode: 'pm_planner',
    });
    expect(await repos.taskRuns.findByThread(TEST_THREAD_ID)).toHaveLength(0);
  });

  it('continues execution after a start-execution plan review approval', async () => {
    gateway.pushResponse({
      content: JSON.stringify({
        summary: 'Approved website plan',
        steps: [
          {
            stepIndex: 0,
            description: 'Build the approved feature set',
            tasks: [
              {
                taskType: 'code',
                employeeId: 'e-dev-1',
                description: 'Implement the approved website plan exactly',
                dependsOnStepOutput: false,
              },
            ],
          },
        ],
      }),
    });

    const interactionService = new InteractionService({
      eventBus,
      companyId: TEST_COMPANY_ID,
      threadId: TEST_THREAD_ID,
      defaultMode: 'human_in_loop',
    });
    const runtimeCtx = createRuntimeContext({
      repos,
      eventBus,
      llmGateway: gateway,
      modelResolver: createTestModelResolver(),
      toolExecutor: new MockToolExecutor(),
      companyId: TEST_COMPANY_ID,
      threadId: TEST_THREAD_ID,
      interactionService,
    });

    await expect(pmPlannerNode(makeState(), { configurable: { runtimeCtx } })).rejects.toThrow(
      PLAN_REVIEW_REQUIRED,
    );

    expect(interactionService.getPending()).toMatchObject({
      kind: 'plan_review',
      prompt: expect.stringContaining('Approved website plan'),
    });

    await interactionService.resolve({
      interactionId: interactionService.getPending()?.interactionId ?? 'ix-plan-1',
      selectedOptionId: 'start_execution',
      respondedAt: Date.now(),
    });

    const result = await pmPlannerNode(makeState(), { configurable: { runtimeCtx } });

    expect(result.taskPlan?.steps).toHaveLength(1);
    expect(result.taskPlan?.summary).toBe('Approved website plan');
    expect(result.taskPlan?.steps[0]?.description).toBe('Build the approved feature set');
    expect(result.taskPlan?.steps[0]?.tasks[0]?.description).toBe(
      'Implement the approved website plan exactly',
    );
    expect(await repos.taskRuns.findByThread(TEST_THREAD_ID)).toHaveLength(1);
    expect(interactionService.getPending()).toBeNull();
  });

  it('applies plan revision notes before re-requesting review', async () => {
    gateway.pushResponse({
      content: JSON.stringify({
        summary: 'Split work into clearer phases',
        steps: [
          {
            stepIndex: 0,
            description: 'Design the approach',
            tasks: [
              {
                taskType: 'analysis',
                employeeId: 'e-dev-1',
                description: 'Draft the implementation plan',
                dependsOnStepOutput: false,
              },
            ],
          },
        ],
      }),
    });

    const interactionService = new InteractionService({
      eventBus,
      companyId: TEST_COMPANY_ID,
      threadId: TEST_THREAD_ID,
      defaultMode: 'human_in_loop',
    });
    await interactionService.request(makePlanReviewRequest());
    await interactionService.resolve({
      interactionId: 'ix-plan-1',
      selectedOptionId: 'revise_plan',
      freeformResponse: 'Split frontend and backend into separate steps.',
      respondedAt: Date.now(),
    });
    const runtimeCtx = createRuntimeContext({
      repos,
      eventBus,
      llmGateway: gateway,
      modelResolver: createTestModelResolver(),
      toolExecutor: new MockToolExecutor(),
      companyId: TEST_COMPANY_ID,
      threadId: TEST_THREAD_ID,
      interactionService,
    });

    await expect(pmPlannerNode(makeState(), { configurable: { runtimeCtx } })).rejects.toThrow(
      PLAN_REVIEW_REQUIRED,
    );

    const lastRequest = gateway.getLastRequest();
    expect(lastRequest?.messages.at(-1)?.content).toContain(
      'Plan revision request: Split frontend and backend into separate steps.',
    );
    expect(interactionService.getPending()).toMatchObject({
      kind: 'plan_review',
      recommendation: { optionId: 'start_execution' },
    });
  });

  it('PM prompt instructs the model to consider expertise and skills', () => {
    expect(PM_SYSTEM_PROMPT).toContain('consider employee expertise and skills');
    expect(PM_SYSTEM_PROMPT).toContain('requiredSkills');
  });
});
