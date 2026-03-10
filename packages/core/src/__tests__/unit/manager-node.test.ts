import { describe, it, expect, beforeEach } from 'vitest';
import { HumanMessage } from '@langchain/core/messages';
import { managerNode } from '../../agents/manager-node.js';
import { MockLlmGateway } from '../helpers/mock-gateway.js';
import { TEST_COMPANY, TEST_COMPANY_ID, TEST_THREAD_ID, makeEmployee, makeManager } from '../helpers/fixtures.js';
import { createMemoryRepositories } from '../../runtime/memory-repositories.js';
import { InMemoryEventBus } from '../../events/event-bus.js';
import { ModelResolver } from '../../llm/model-resolver.js';
import { MockToolExecutor } from '../../runtime/tool-executor.js';
import { createRuntimeContext } from '../../runtime/runtime-context.js';
import type { AicsGraphState } from '../../graph/state.js';
import type { RunnableConfig } from '@langchain/core/runnables';
import type { RuntimeEvent } from '@aics/shared-types';

function makeState(overrides?: Partial<AicsGraphState>): AicsGraphState {
  return {
    threadId: TEST_THREAD_ID,
    companyId: TEST_COMPANY_ID,
    entryMode: 'boss_chat' as const,
    messages: [new HumanMessage('Build me a website')],
    routeDecision: 'delegate_manager',
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
    ...overrides,
  };
}

describe('managerNode', () => {
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
  });

  it('creates task_runs and pending assignments for employees', async () => {
    gateway.pushResponse({
      content: JSON.stringify({
        assignments: [
          { taskType: 'code', employeeId: 'e-dev-1', description: 'Build landing page' },
        ],
      }),
    });

    const state = makeState();
    const result = await managerNode(state, config);

    expect(result.pendingAssignments).toHaveLength(1);
    expect(result.pendingAssignments![0]!.employeeId).toBe('e-dev-1');
    expect(result.pendingAssignments![0]!.taskType).toBe('code');
  });

  it('creates handoff events', async () => {
    gateway.pushResponse({
      content: JSON.stringify({
        assignments: [
          { taskType: 'code', employeeId: 'e-dev-1', description: 'Build landing page' },
        ],
      }),
    });

    const state = makeState();
    await managerNode(state, config);

    const handoffs = await repos.handoffs.findByThread(TEST_THREAD_ID);
    expect(handoffs).toHaveLength(1);
    expect(handoffs[0]!.to_employee_id).toBe('e-dev-1');
  });

  it('emits task assignment events', async () => {
    gateway.pushResponse({
      content: JSON.stringify({
        assignments: [
          { taskType: 'code', employeeId: 'e-dev-1', description: 'Build landing page' },
        ],
      }),
    });

    const state = makeState();
    await managerNode(state, config);

    const assignmentEvents = events.filter((e) => e.type === 'task.assignment.changed');
    expect(assignmentEvents).toHaveLength(1);
  });

  it('falls back to first available employee on unparseable response', async () => {
    gateway.pushResponse({
      content: 'I think we should assign the developer to work on this.',
    });

    const state = makeState();
    const result = await managerNode(state, config);

    // Should still produce at least one assignment (fallback)
    expect(result.pendingAssignments!.length).toBeGreaterThanOrEqual(1);
  });

  it('handles multiple assignments', async () => {
    const designer = makeEmployee({
      employee_id: 'e-design-1',
      name: 'Designer Bot',
      role_slug: 'designer',
    });
    repos.seed.employees([designer]);

    gateway.pushResponse({
      content: JSON.stringify({
        assignments: [
          { taskType: 'code', employeeId: 'e-dev-1', description: 'Build backend' },
          { taskType: 'design', employeeId: 'e-design-1', description: 'Design UI' },
        ],
      }),
    });

    const state = makeState();
    const result = await managerNode(state, config);

    expect(result.pendingAssignments).toHaveLength(2);
  });
});
