import type { RuntimeEvent } from '@aics/shared-types';
import { HumanMessage } from '@langchain/core/messages';
import type { RunnableConfig } from '@langchain/core/runnables';
import { beforeEach, describe, expect, it } from 'vitest';
import { employeeDirectSetupNode } from '../../agents/employee-direct-setup-node.js';
import { InMemoryEventBus } from '../../events/event-bus.js';
import type { AicsGraphState } from '../../graph/state.js';
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

function makeState(overrides?: Partial<AicsGraphState>): AicsGraphState {
  return {
    threadId: TEST_THREAD_ID,
    companyId: TEST_COMPANY_ID,
    entryMode: 'direct_chat' as const,
    targetEmployeeId: 'e-dev-1',
    messages: [new HumanMessage('Help me write a function')],
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
    projectId: null,
    meetingInterrupt: null,
    ...overrides,
  };
}

describe('employeeDirectSetupNode', () => {
  let config: RunnableConfig;
  // biome-ignore lint/suspicious/noExplicitAny: event collector captures all payload types
  let events: RuntimeEvent<any>[];
  let repos: ReturnType<typeof createMemoryRepositories>;

  beforeEach(() => {
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
  });

  it('returns PendingAssignment for existing employee and emits events', async () => {
    const state = makeState();
    const result = await employeeDirectSetupNode(state, config);

    // Should return one pending assignment
    expect(result.pendingAssignments).toHaveLength(1);
    expect(result.pendingAssignments![0]!.taskType).toBe('direct_chat');
    expect(result.pendingAssignments![0]!.employeeId).toBe('e-dev-1');

    // Should have empty currentStepOutputs
    expect(result.currentStepOutputs).toEqual([]);

    // Should NOT set interruptReason
    expect(result.interruptReason).toBeUndefined();

    // Should emit graphNodeEntered
    const enteredEvents = events.filter((e) => e.type === 'graph.node.entered');
    expect(enteredEvents).toHaveLength(1);
    expect(enteredEvents[0]!.payload.nodeName).toBe('employee_direct_setup');

    // Should emit directChatStarted
    const chatStartedEvents = events.filter((e) => e.type === 'direct.chat.started');
    expect(chatStartedEvents).toHaveLength(1);
    expect(chatStartedEvents[0]!.payload.employeeId).toBe('e-dev-1');
    expect(chatStartedEvents[0]!.payload.employeeName).toBe('Dev Bot');

    // Should emit employeeStateChanged (idle → assigned)
    const stateEvents = events.filter((e) => e.type === 'employee.state.changed');
    expect(stateEvents).toHaveLength(1);
    expect(stateEvents[0]!.payload.prev).toBe('idle');
    expect(stateEvents[0]!.payload.next).toBe('assigned');
  });

  it('returns interruptReason when targetEmployeeId is missing', async () => {
    const state = makeState({ targetEmployeeId: null });
    const result = await employeeDirectSetupNode(state, config);

    expect(result.interruptReason).toBe(
      'Direct chat requires a targetEmployeeId but none was provided',
    );
    expect(result.pendingAssignments).toBeUndefined();
    expect(result.currentStepOutputs).toEqual([]);
  });

  it('returns interruptReason when employee does not exist', async () => {
    const state = makeState({ targetEmployeeId: 'e-nonexistent' });
    const result = await employeeDirectSetupNode(state, config);

    expect(result.interruptReason).toBe('Employee e-nonexistent not found');
    expect(result.pendingAssignments).toBeUndefined();
    expect(result.currentStepOutputs).toEqual([]);
  });

  it('includes user message as task description in assignment inputJson', async () => {
    const state = makeState({
      messages: [new HumanMessage('Write unit tests for the auth module')],
    });
    const result = await employeeDirectSetupNode(state, config);

    const inputJson = result.pendingAssignments![0]!.inputJson as Record<string, unknown>;
    expect(inputJson.description).toBe('Write unit tests for the auth module');
    expect(inputJson.taskRunId).toBeDefined();
  });
});
