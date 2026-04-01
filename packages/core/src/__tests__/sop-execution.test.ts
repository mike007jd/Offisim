import { HumanMessage } from '@langchain/core/messages';
import type { RunnableConfig } from '@langchain/core/runnables';
import type { SopDefinition } from '@offisim/shared-types';
import { beforeEach, describe, expect, it } from 'vitest';
import {
  findEmployeeForRole,
  matchSopTemplate,
  sopBatchesToLlmPlan,
  tryBuildSopPlan,
} from '../agents/pm-planner-node.js';
import { pmPlannerNode } from '../agents/pm-planner-node.js';
import { InMemoryEventBus } from '../events/event-bus.js';
import type { OffisimGraphState } from '../graph/state.js';
import { ModelResolver } from '../llm/model-resolver.js';
import { createMemoryRepositories } from '../runtime/memory-repositories.js';
import type { EmployeeRow, SopTemplateRow } from '../runtime/repositories.js';
import { createRuntimeContext } from '../runtime/runtime-context.js';
import { MockToolExecutor } from '../runtime/tool-executor.js';
import { SopService } from '../services/sop-service.js';
import {
  TEST_COMPANY,
  TEST_COMPANY_ID,
  TEST_THREAD_ID,
  makeEmployee,
  makeManager,
} from './helpers/fixtures.js';
import { MockLlmGateway } from './helpers/mock-gateway.js';

// ---------------------------------------------------------------------------
// Test data helpers
// ---------------------------------------------------------------------------

function makeSopDefinition(overrides?: Partial<SopDefinition>): SopDefinition {
  return {
    sop_id: 'sop-1',
    name: 'Content Pipeline',
    description: 'Research, write, then review',
    steps: [
      {
        step_id: 's1',
        label: 'Research',
        role_slug: 'researcher',
        instruction: 'Gather background info on the topic',
        dependencies: [],
        output_key: 'research_output',
      },
      {
        step_id: 's2',
        label: 'Write',
        role_slug: 'writer',
        instruction: 'Write a draft based on research',
        dependencies: ['s1'],
        output_key: 'draft',
      },
      {
        step_id: 's3',
        label: 'Review',
        role_slug: 'reviewer',
        instruction: 'Review and finalize the draft',
        dependencies: ['s2'],
        output_key: 'review',
      },
    ],
    created_at: new Date().toISOString(),
    ...overrides,
  };
}

function makeSopTemplateRow(
  sopDef: SopDefinition,
  companyId: string = TEST_COMPANY_ID,
): SopTemplateRow {
  return {
    sop_template_id: `sopt_${sopDef.sop_id}`,
    company_id: companyId,
    name: sopDef.name,
    description: sopDef.description,
    definition_json: JSON.stringify(sopDef),
    source_thread_id: null,
    created_at: new Date().toISOString(),
    updated_at: new Date().toISOString(),
  };
}

function makeResearcher(): EmployeeRow {
  return makeEmployee({
    employee_id: 'e-res-1',
    name: 'Researcher Bot',
    role_slug: 'researcher',
  });
}

function makeWriter(): EmployeeRow {
  return makeEmployee({
    employee_id: 'e-wrt-1',
    name: 'Writer Bot',
    role_slug: 'writer',
  });
}

function makeReviewer(): EmployeeRow {
  return makeEmployee({
    employee_id: 'e-rev-1',
    name: 'Reviewer Bot',
    role_slug: 'reviewer',
  });
}

function makeState(overrides?: Partial<OffisimGraphState>): OffisimGraphState {
  return {
    threadId: TEST_THREAD_ID,
    companyId: TEST_COMPANY_ID,
    entryMode: 'boss_chat' as const,
    targetEmployeeId: null,
    messages: [new HumanMessage('Run the Content Pipeline for our blog post')],
    routeDecision: 'delegate_manager',
    currentTaskRunId: null,
    currentEmployeeId: null,
    pendingAssignments: [],
    completed: false,
    interruptReason: null,
    meetingId: null,
    managerDirective: {
      intent: 'Run the Content Pipeline for our blog post',
      recommendedEmployees: ['e-res-1', 'e-wrt-1', 'e-rev-1'],
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

// ---------------------------------------------------------------------------
// Unit tests: matchSopTemplate
// ---------------------------------------------------------------------------

describe('matchSopTemplate', () => {
  const templates: SopTemplateRow[] = [
    makeSopTemplateRow(makeSopDefinition()),
    makeSopTemplateRow(makeSopDefinition({ sop_id: 'sop-2', name: 'Code Review Process' })),
  ];

  it('matches template by case-insensitive substring', () => {
    const result = matchSopTemplate(templates, 'please run the content pipeline');
    expect(result).not.toBeNull();
    expect(result?.name).toBe('Content Pipeline');
  });

  it('matches regardless of case', () => {
    const result = matchSopTemplate(templates, 'Use CODE REVIEW PROCESS');
    expect(result).not.toBeNull();
    expect(result?.name).toBe('Code Review Process');
  });

  it('returns null when no template matches', () => {
    const result = matchSopTemplate(templates, 'build me a website');
    expect(result).toBeNull();
  });

  it('returns first match when multiple could match', () => {
    const result = matchSopTemplate(templates, 'content pipeline and code review process');
    expect(result).not.toBeNull();
    expect(result?.name).toBe('Content Pipeline');
  });
});

// ---------------------------------------------------------------------------
// Unit tests: findEmployeeForRole
// ---------------------------------------------------------------------------

describe('findEmployeeForRole', () => {
  const employees: EmployeeRow[] = [makeResearcher(), makeWriter(), makeReviewer()];

  it('finds exact role_slug match', () => {
    const result = findEmployeeForRole(employees, 'researcher');
    expect(result).not.toBeNull();
    expect(result?.employee_id).toBe('e-res-1');
  });

  it('falls back to any enabled employee when no role match', () => {
    const result = findEmployeeForRole(employees, 'nonexistent_role');
    expect(result).not.toBeNull();
    // Should return any enabled employee
    expect(employees.map((e) => e.employee_id)).toContain(result?.employee_id);
  });

  it('skips disabled employees for exact match', () => {
    const disabled = makeResearcher();
    disabled.enabled = 0;
    const result = findEmployeeForRole([disabled, makeWriter()], 'researcher');
    // No enabled researcher, fallback to writer
    expect(result).not.toBeNull();
    expect(result?.employee_id).toBe('e-wrt-1');
  });

  it('returns null when no employees at all', () => {
    const result = findEmployeeForRole([], 'researcher');
    expect(result).toBeNull();
  });
});

// ---------------------------------------------------------------------------
// Unit tests: sopBatchesToLlmPlan
// ---------------------------------------------------------------------------

describe('sopBatchesToLlmPlan', () => {
  const sopDef = makeSopDefinition();
  const employees: EmployeeRow[] = [makeResearcher(), makeWriter(), makeReviewer()];

  it('converts linear SOP batches to correct plan structure', () => {
    const sopService = new SopService(
      {
        findByCompany: async () => [],
        findById: async () => null,
        create: async () => ({}) as SopTemplateRow,
        delete: async () => {},
      },
      new InMemoryEventBus(),
    );
    const batches = sopService.getExecutionOrder(sopDef);
    // Linear SOP: 3 batches of 1 step each
    expect(batches).toHaveLength(3);

    const plan = sopBatchesToLlmPlan(sopDef, batches, employees);

    expect(plan.summary).toContain('Content Pipeline');
    expect(plan.steps).toHaveLength(3);

    // Step 0: Research
    expect(plan.steps[0]?.stepIndex).toBe(0);
    expect(plan.steps[0]?.tasks).toHaveLength(1);
    expect(plan.steps[0]?.tasks[0]?.employeeId).toBe('e-res-1');
    expect(plan.steps[0]?.tasks[0]?.description).toBe('Gather background info on the topic');
    expect(plan.steps[0]?.tasks[0]?.dependsOnStepOutput).toBe(false);

    // Step 1: Write (depends on previous)
    expect(plan.steps[1]?.tasks[0]?.employeeId).toBe('e-wrt-1');
    expect(plan.steps[1]?.tasks[0]?.dependsOnStepOutput).toBe(true);

    // Step 2: Review (depends on previous)
    expect(plan.steps[2]?.tasks[0]?.employeeId).toBe('e-rev-1');
    expect(plan.steps[2]?.tasks[0]?.dependsOnStepOutput).toBe(true);
  });

  it('groups parallel SOP steps into one plan step', () => {
    const parallelDef = makeSopDefinition({
      steps: [
        {
          step_id: 's1',
          label: 'Research',
          role_slug: 'researcher',
          instruction: 'Research',
          dependencies: [],
          output_key: 'r',
        },
        {
          step_id: 's2',
          label: 'Design',
          role_slug: 'writer',
          instruction: 'Design',
          dependencies: [],
          output_key: 'd',
        },
        {
          step_id: 's3',
          label: 'Merge',
          role_slug: 'reviewer',
          instruction: 'Merge results',
          dependencies: ['s1', 's2'],
          output_key: 'm',
        },
      ],
    });

    const sopService = new SopService(
      {
        findByCompany: async () => [],
        findById: async () => null,
        create: async () => ({}) as SopTemplateRow,
        delete: async () => {},
      },
      new InMemoryEventBus(),
    );
    const batches = sopService.getExecutionOrder(parallelDef);
    expect(batches).toHaveLength(2);
    expect(batches[0]).toHaveLength(2); // s1, s2 parallel

    const plan = sopBatchesToLlmPlan(parallelDef, batches, employees);

    expect(plan.steps).toHaveLength(2);
    expect(plan.steps[0]?.tasks).toHaveLength(2);
    expect(plan.steps[0]?.tasks[0]?.dependsOnStepOutput).toBe(false);
    expect(plan.steps[0]?.tasks[1]?.dependsOnStepOutput).toBe(false);
    expect(plan.steps[1]?.tasks).toHaveLength(1);
    expect(plan.steps[1]?.tasks[0]?.dependsOnStepOutput).toBe(true);
  });

  it('falls back to available employee when role not found', () => {
    // Only researcher and writer, no reviewer
    const limitedEmployees = [makeResearcher(), makeWriter()];
    const sopService = new SopService(
      {
        findByCompany: async () => [],
        findById: async () => null,
        create: async () => ({}) as SopTemplateRow,
        delete: async () => {},
      },
      new InMemoryEventBus(),
    );
    const batches = sopService.getExecutionOrder(sopDef);
    const plan = sopBatchesToLlmPlan(sopDef, batches, limitedEmployees);

    // Step 2 (review) should fall back to some enabled employee
    expect(plan.steps[2]?.tasks[0]?.employeeId).toBeTruthy();
    // It won't be 'e-rev-1' since we don't have a reviewer
    expect(limitedEmployees.map((e) => e.employee_id)).toContain(
      plan.steps[2]?.tasks[0]?.employeeId,
    );
  });
});

// ---------------------------------------------------------------------------
// Unit tests: tryBuildSopPlan
// ---------------------------------------------------------------------------

describe('tryBuildSopPlan', () => {
  it('returns plan when SOP matches intent', async () => {
    const repos = createMemoryRepositories();
    const eventBus = new InMemoryEventBus();
    const sopDef = makeSopDefinition();

    // Seed SOP template
    await repos.sopTemplates.create({
      sop_template_id: 'sopt-1',
      company_id: TEST_COMPANY_ID,
      name: sopDef.name,
      description: sopDef.description,
      definition_json: JSON.stringify(sopDef),
      source_thread_id: null,
    });

    const employees = [makeResearcher(), makeWriter(), makeReviewer()];

    const plan = await tryBuildSopPlan(
      repos,
      eventBus,
      TEST_COMPANY_ID,
      'Run the Content Pipeline for the blog',
      employees,
    );

    expect(plan).not.toBeNull();
    expect(plan?.steps).toHaveLength(3);
    expect(plan?.summary).toContain('Content Pipeline');
  });

  it('returns null when no SOP matches', async () => {
    const repos = createMemoryRepositories();
    const eventBus = new InMemoryEventBus();
    const sopDef = makeSopDefinition();

    await repos.sopTemplates.create({
      sop_template_id: 'sopt-1',
      company_id: TEST_COMPANY_ID,
      name: sopDef.name,
      description: sopDef.description,
      definition_json: JSON.stringify(sopDef),
      source_thread_id: null,
    });

    const employees = [makeResearcher()];

    const plan = await tryBuildSopPlan(
      repos,
      eventBus,
      TEST_COMPANY_ID,
      'Build me a website',
      employees,
    );

    expect(plan).toBeNull();
  });

  it('returns null when no templates exist', async () => {
    const repos = createMemoryRepositories();
    const eventBus = new InMemoryEventBus();
    const employees = [makeResearcher()];

    const plan = await tryBuildSopPlan(
      repos,
      eventBus,
      TEST_COMPANY_ID,
      'Run Content Pipeline',
      employees,
    );

    expect(plan).toBeNull();
  });

  it('returns null for invalid SOP definition', async () => {
    const repos = createMemoryRepositories();
    const eventBus = new InMemoryEventBus();

    // Invalid: cyclic dependencies
    const badDef = makeSopDefinition({
      steps: [
        {
          step_id: 's1',
          label: 'A',
          role_slug: 'dev',
          instruction: 'do A',
          dependencies: ['s2'],
          output_key: 'a',
        },
        {
          step_id: 's2',
          label: 'B',
          role_slug: 'dev',
          instruction: 'do B',
          dependencies: ['s1'],
          output_key: 'b',
        },
      ],
    });

    await repos.sopTemplates.create({
      sop_template_id: 'sopt-bad',
      company_id: TEST_COMPANY_ID,
      name: badDef.name,
      description: badDef.description,
      definition_json: JSON.stringify(badDef),
      source_thread_id: null,
    });

    const employees = [makeEmployee()];

    const plan = await tryBuildSopPlan(
      repos,
      eventBus,
      TEST_COMPANY_ID,
      'Run Content Pipeline',
      employees,
    );

    expect(plan).toBeNull();
  });
});

// ---------------------------------------------------------------------------
// Integration: pmPlannerNode with SOP
// ---------------------------------------------------------------------------

describe('pmPlannerNode — SOP integration', () => {
  let gateway: MockLlmGateway;
  let config: RunnableConfig;
  let repos: ReturnType<typeof createMemoryRepositories>;

  beforeEach(async () => {
    gateway = new MockLlmGateway();
    repos = createMemoryRepositories();
    repos.seed.companies([TEST_COMPANY]);
    repos.seed.employees([makeManager(), makeResearcher(), makeWriter(), makeReviewer()]);

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

    // Seed SOP template
    const sopDef = makeSopDefinition();
    await repos.sopTemplates.create({
      sop_template_id: 'sopt-1',
      company_id: TEST_COMPANY_ID,
      name: sopDef.name,
      description: sopDef.description,
      definition_json: JSON.stringify(sopDef),
      source_thread_id: null,
    });
  });

  it('uses SOP plan when intent references SOP name — no LLM call', async () => {
    // Do NOT push any LLM response — SOP should bypass LLM entirely
    const state = makeState();
    const result = await pmPlannerNode(state, config);

    expect(result.taskPlan).not.toBeNull();
    expect(result.taskPlan?.summary).toContain('Content Pipeline');
    expect(result.taskPlan?.steps).toHaveLength(3);

    // Verify role assignments
    expect(result.taskPlan?.steps[0]?.tasks[0]?.employeeId).toBe('e-res-1');
    expect(result.taskPlan?.steps[1]?.tasks[0]?.employeeId).toBe('e-wrt-1');
    expect(result.taskPlan?.steps[2]?.tasks[0]?.employeeId).toBe('e-rev-1');

    // Verify dependsOnStepOutput
    expect(result.taskPlan?.steps[0]?.tasks[0]?.dependsOnStepOutput).toBe(false);
    expect(result.taskPlan?.steps[1]?.tasks[0]?.dependsOnStepOutput).toBe(true);
    expect(result.taskPlan?.steps[2]?.tasks[0]?.dependsOnStepOutput).toBe(true);

    // Verify taskRun records created
    const taskRuns = await repos.taskRuns.findByThread(TEST_THREAD_ID);
    expect(taskRuns).toHaveLength(3);
    for (const tr of taskRuns) {
      expect(tr.status).toBe('planned');
    }

    // Plan summary starts with "SOP:" indicating it came from SOP, not LLM
    expect(result.taskPlan?.summary).toMatch(/^SOP:/);
  });

  it('uses explicit sopTemplateId without needing intent substring match', async () => {
    // Intent does NOT mention the SOP name — but sopTemplateId is set explicitly
    const state = makeState({
      messages: [new HumanMessage('Do something unrelated')],
      managerDirective: {
        intent: 'Do something unrelated',
        recommendedEmployees: ['e-res-1', 'e-wrt-1', 'e-rev-1'],
        sopTemplateId: 'sopt-1',
      },
    });

    const result = await pmPlannerNode(state, config);

    expect(result.taskPlan).not.toBeNull();
    expect(result.taskPlan?.summary).toMatch(/^SOP:/);
    expect(result.taskPlan?.summary).toContain('Content Pipeline');
    expect(result.taskPlan?.steps).toHaveLength(3);

    // Verify role assignments from the SOP
    expect(result.taskPlan?.steps[0]?.tasks[0]?.employeeId).toBe('e-res-1');
    expect(result.taskPlan?.steps[1]?.tasks[0]?.employeeId).toBe('e-wrt-1');
    expect(result.taskPlan?.steps[2]?.tasks[0]?.employeeId).toBe('e-rev-1');
  });

  it('falls back to substring matching when sopTemplateId is invalid', async () => {
    // sopTemplateId points to a nonexistent template, but intent matches by substring
    const state = makeState({
      messages: [new HumanMessage('Run the Content Pipeline')],
      managerDirective: {
        intent: 'Run the Content Pipeline',
        recommendedEmployees: ['e-res-1', 'e-wrt-1', 'e-rev-1'],
        sopTemplateId: 'nonexistent-id',
      },
    });

    const result = await pmPlannerNode(state, config);

    // Should still find the SOP via substring fallback
    expect(result.taskPlan).not.toBeNull();
    expect(result.taskPlan?.summary).toMatch(/^SOP:/);
    expect(result.taskPlan?.summary).toContain('Content Pipeline');
  });

  it('falls through to LLM planning when intent does not reference SOP', async () => {
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
                employeeId: 'e-res-1',
                description: 'Write code',
                dependsOnStepOutput: false,
              },
            ],
          },
        ],
      }),
    });

    const state = makeState({
      messages: [new HumanMessage('Build me a website')],
      managerDirective: {
        intent: 'Build me a website',
        recommendedEmployees: ['e-res-1'],
      },
    });

    const result = await pmPlannerNode(state, config);

    expect(result.taskPlan).not.toBeNull();
    expect(result.taskPlan?.summary).toBe('Build a website');
    // Plan came from LLM, not SOP
    expect(result.taskPlan?.summary).not.toMatch(/^SOP:/);
  });
});
