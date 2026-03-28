import { HumanMessage } from '@langchain/core/messages';
import type { RunnableConfig } from '@langchain/core/runnables';
import { beforeEach, describe, expect, it } from 'vitest';
import { bossNode } from '../../agents/boss-node.js';
import { InMemoryEventBus } from '../../events/event-bus.js';
import type { OffisimGraphState } from '../../graph/state.js';
import { ModelResolver } from '../../llm/model-resolver.js';
import { createMemoryRepositories } from '../../runtime/memory-repositories.js';
import { createRuntimeContext } from '../../runtime/runtime-context.js';
import { MockToolExecutor } from '../../runtime/tool-executor.js';
import { ProjectService } from '../../services/project-service.js';
import { projectThreadId } from '../../utils/generate-id.js';
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

function makeState(overrides?: Partial<OffisimGraphState>): OffisimGraphState {
  return {
    threadId: TEST_THREAD_ID,
    companyId: TEST_COMPANY_ID,
    entryMode: 'boss_chat' as const,
    targetEmployeeId: null,
    messages: [new HumanMessage('Build me a full e-commerce platform')],
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
    handoffCount: 0,
    meetingActionItems: [],
    hrAssessment: null,
    replanCount: 0,
    meetingInterrupt: null,
    dispatchedStepIndices: [],
    completedStepIndices: [],
    projectId: null,
    ...overrides,
  };
}

// ---------------------------------------------------------------------------
// projectThreadId utility
// ---------------------------------------------------------------------------

describe('projectThreadId', () => {
  it('generates correct format', () => {
    const tid = projectThreadId('proj-abc-123');
    expect(tid).toBe('project-proj-abc-123');
  });

  it('is deterministic for same projectId', () => {
    const id = 'proj-xyz';
    expect(projectThreadId(id)).toBe(projectThreadId(id));
  });

  it('differs for different projectIds', () => {
    expect(projectThreadId('proj-a')).not.toBe(projectThreadId('proj-b'));
  });
});

// ---------------------------------------------------------------------------
// ProjectService
// ---------------------------------------------------------------------------

describe('ProjectService', () => {
  let repos: ReturnType<typeof createMemoryRepositories>;
  let runtimeCtx: ReturnType<typeof createRuntimeContext>;

  beforeEach(async () => {
    repos = createMemoryRepositories();
    repos.seed.companies([TEST_COMPANY]);

    runtimeCtx = createRuntimeContext({
      repos,
      eventBus: new InMemoryEventBus(),
      llmGateway: new MockLlmGateway(),
      modelResolver: new ModelResolver(JSON.parse(TEST_COMPANY.default_model_policy_json)),
      toolExecutor: new MockToolExecutor(),
      companyId: TEST_COMPANY_ID,
      threadId: TEST_THREAD_ID,
    });
  });

  it('creates project and backing thread with correct fields', async () => {
    const service = new ProjectService(runtimeCtx);
    const project = await service.createProject('E-Commerce Platform', 'Full stack store');

    expect(project.project_id).toMatch(/^proj-/);
    expect(project.name).toBe('E-Commerce Platform');
    expect(project.description).toBe('Full stack store');
    expect(project.status).toBe('planning');
    expect(project.company_id).toBe(TEST_COMPANY_ID);

    // Thread must exist and have the deterministic ID
    const expectedThreadId = projectThreadId(project.project_id);
    expect(project.thread_id).toBe(expectedThreadId);

    const thread = await repos.threads.findById(expectedThreadId);
    expect(thread).not.toBeNull();
    expect(thread?.company_id).toBe(TEST_COMPANY_ID);
    expect(thread?.entry_mode).toBe('boss_chat');
    expect(thread?.status).toBe('queued');
  });

  it('creates project with null description when omitted', async () => {
    const service = new ProjectService(runtimeCtx);
    const project = await service.createProject('Quick Project');

    expect(project.description).toBeNull();
  });

  it('activateProject updates status to active', async () => {
    const service = new ProjectService(runtimeCtx);
    const project = await service.createProject('My Project');

    await service.activateProject(project.project_id);

    const updated = await repos.projects.findById(project.project_id);
    expect(updated?.status).toBe('active');
  });

  it('thread_id follows projectThreadId convention', async () => {
    const service = new ProjectService(runtimeCtx);
    const project = await service.createProject('Naming Test');

    expect(project.thread_id).toBe(`project-${project.project_id}`);
  });
});

// ---------------------------------------------------------------------------
// bossNode — project intent detection
// ---------------------------------------------------------------------------

describe('bossNode project intent detection', () => {
  let gateway: MockLlmGateway;
  let config: RunnableConfig;
  let repos: ReturnType<typeof createMemoryRepositories>;

  beforeEach(() => {
    gateway = new MockLlmGateway();
    repos = createMemoryRepositories();
    repos.seed.companies([TEST_COMPANY]);
    repos.seed.employees([makeManager(), makeEmployee()]);

    const runtimeCtx = createRuntimeContext({
      repos,
      eventBus: new InMemoryEventBus(),
      llmGateway: gateway,
      modelResolver: new ModelResolver(JSON.parse(TEST_COMPANY.default_model_policy_json)),
      toolExecutor: new MockToolExecutor(),
      companyId: TEST_COMPANY_ID,
      threadId: TEST_THREAD_ID,
    });

    config = { configurable: { runtimeCtx } };
  });

  it('creates a project and returns projectId when isNewProject is true', async () => {
    gateway.pushResponse({
      content: JSON.stringify({
        action: 'delegate',
        reason: 'substantial multi-phase project',
        isNewProject: true,
        projectName: 'E-Commerce Platform',
      }),
    });

    const state = makeState();
    const result = await bossNode(state, config);

    expect(result.routeDecision).toBe('delegate_manager');
    expect(result.projectId).toBeTruthy();
    expect(typeof result.projectId).toBe('string');
    expect(result.projectId as string).toMatch(/^proj-/);

    // Verify project was persisted
    const projects = await repos.projects.findByCompany(TEST_COMPANY_ID);
    expect(projects).toHaveLength(1);
    expect(projects[0]?.name).toBe('E-Commerce Platform');
    expect(projects[0]?.project_id).toBe(result.projectId);
  });

  it('does not create a project when isNewProject is false', async () => {
    gateway.pushResponse({
      content: JSON.stringify({
        action: 'delegate',
        reason: 'simple task',
        isNewProject: false,
      }),
    });

    const state = makeState({
      messages: [new HumanMessage('Fix the login button color')],
    });
    const result = await bossNode(state, config);

    expect(result.projectId).toBeUndefined();

    const projects = await repos.projects.findByCompany(TEST_COMPANY_ID);
    expect(projects).toHaveLength(0);
  });

  it('does not create a duplicate project when projectId already set in state', async () => {
    gateway.pushResponse({
      content: JSON.stringify({
        action: 'delegate',
        reason: 'continuing project',
        isNewProject: true,
        projectName: 'Should Not Create',
      }),
    });

    const state = makeState({ projectId: 'proj-existing-123' });
    const result = await bossNode(state, config);

    // projectId should remain unchanged — no new project created
    expect(result.projectId).toBeUndefined();

    const projects = await repos.projects.findByCompany(TEST_COMPANY_ID);
    expect(projects).toHaveLength(0);
  });

  it('handles LLM response without isNewProject field gracefully', async () => {
    gateway.pushResponse({
      content: JSON.stringify({
        action: 'direct_reply',
        reply: 'Hello there!',
      }),
    });

    const state = makeState({ messages: [new HumanMessage('Hi!')] });
    const result = await bossNode(state, config);

    expect(result.routeDecision).toBe('direct_reply');
    expect(result.projectId).toBeUndefined();
  });
});
