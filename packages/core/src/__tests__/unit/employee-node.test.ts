import type { RuntimeEvent } from '@aics/shared-types';
import { HumanMessage } from '@langchain/core/messages';
import type { RunnableConfig } from '@langchain/core/runnables';
import { beforeEach, describe, expect, it } from 'vitest';
import { employeeNode } from '../../agents/employee-node.js';
import { errorHandlerNode } from '../../agents/error-handler-node.js';
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
    entryMode: 'boss_chat' as const,
    targetEmployeeId: null,
    messages: [new HumanMessage('Build me a website')],
    routeDecision: 'delegate_manager',
    currentTaskRunId: null,
    currentEmployeeId: null,
    pendingAssignments: [
      {
        taskType: 'code',
        employeeId: 'e-dev-1',
        inputJson: { description: 'Build landing page', taskRunId: 'tr-test-1' },
      },
    ],
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
    projectId: null,
    meetingInterrupt: null,
    dispatchedStepIndices: [],
    completedStepIndices: [],
    ...overrides,
  };
}

describe('employeeNode', () => {
  let gateway: MockLlmGateway;
  let config: RunnableConfig;
  let events: RuntimeEvent[];
  let repos: ReturnType<typeof createMemoryRepositories>;

  beforeEach(async () => {
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

    // Seed a task run for the employee to pick up
    await repos.taskRuns.create({
      task_run_id: 'tr-test-1',
      thread_id: TEST_THREAD_ID,
      employee_id: 'e-dev-1',
      parent_task_run_id: null,
      task_type: 'code',
      status: 'pending',
      input_json: JSON.stringify({ description: 'Build landing page' }),
      output_json: null,
      started_at: new Date().toISOString(),
    });
  });

  it('processes the first pending assignment and returns result', async () => {
    gateway.pushResponse({
      content: 'Here is the landing page code:\n```html\n<h1>Hello</h1>\n```',
    });

    const state = makeState();
    const result = (await employeeNode(state, config)) as Partial<AicsGraphState>;

    expect(result.currentEmployeeId).toBe('e-dev-1');
    expect(result.pendingAssignments).toHaveLength(0);
    expect(result.messages).toHaveLength(1);
  });

  it('emits employee state changed events', async () => {
    gateway.pushResponse({
      content: 'Done with the task.',
    });

    const state = makeState();
    await employeeNode(state, config);

    const employeeEvents = events.filter((e) => e.type === 'employee.state.changed');
    expect(employeeEvents.length).toBeGreaterThanOrEqual(1);
  });

  it('updates task run status to completed', async () => {
    gateway.pushResponse({
      content: 'Task completed successfully.',
    });

    const state = makeState();
    await employeeNode(state, config);

    const taskRun = await repos.taskRuns.findById('tr-test-1');
    expect(taskRun?.status).toBe('completed');
    expect(taskRun?.output_json).toBeTruthy();
  });

  it('handles tool calls from LLM', async () => {
    gateway.pushResponse({
      content: '',
      toolCalls: [{ id: 'tc-1', name: 'readFile', arguments: { path: '/src/index.ts' } }],
    });
    // Second call after tool execution
    gateway.pushResponse({
      content: 'I read the file and here is my analysis.',
    });

    const state = makeState();
    const result = (await employeeNode(state, config)) as Partial<AicsGraphState>;

    expect(result.messages).toHaveLength(1);
  });

  it('sets completed when no more pending assignments', async () => {
    gateway.pushResponse({ content: 'Done.' });

    const state = makeState();
    const result = (await employeeNode(state, config)) as Partial<AicsGraphState>;

    expect(result.pendingAssignments).toHaveLength(0);
  });

  it('handles multi-round tool calling (2 rounds then content)', async () => {
    // Round 1: LLM requests tool call
    gateway.pushResponse({
      content: '',
      toolCalls: [{ id: 'tc-1', name: 'readFile', arguments: { path: '/src/index.ts' } }],
    });
    // Round 2: LLM requests another tool call based on first result
    gateway.pushResponse({
      content: '',
      toolCalls: [{ id: 'tc-2', name: 'searchCode', arguments: { query: 'export function' } }],
    });
    // Round 3: LLM produces final content (no tool calls)
    gateway.pushResponse({
      content: 'After reading the file and searching the code, here is my analysis.',
    });

    const state = makeState();
    const result = (await employeeNode(state, config)) as Partial<AicsGraphState>;

    // Should have the final content from round 3
    expect(result.messages).toHaveLength(1);
    expect(result.messages?.[0]?.content).toContain(
      'After reading the file and searching the code',
    );

    // LLM was called 3 times: initial + 2 follow-up rounds
    const llmCalls = await repos.llmCalls.findByThread(TEST_THREAD_ID);
    expect(llmCalls.filter((c) => c.node_name === 'employee')).toHaveLength(3);
  });

  it('stops after MAX_TOOL_ROUNDS (5) even if LLM keeps requesting tools', async () => {
    // Push 6 responses that all request tool calls
    for (let i = 0; i < 6; i++) {
      gateway.pushResponse({
        content: `Round ${i + 1} content`,
        toolCalls: [{ id: `tc-${i}`, name: 'neverStop', arguments: { round: i } }],
      });
    }
    // This 7th response should never be reached (MAX_TOOL_ROUNDS = 5, so initial + 5 follow-ups = 6 calls)
    gateway.pushResponse({
      content: 'Should not reach here.',
    });

    const state = makeState();
    const result = (await employeeNode(state, config)) as Partial<AicsGraphState>;

    // The loop should have stopped after 5 rounds of tool calls
    // Initial call (1) + 5 follow-up rounds = 6 total LLM calls
    const llmCalls = await repos.llmCalls.findByThread(TEST_THREAD_ID);
    const employeeCalls = llmCalls.filter((c) => c.node_name === 'employee');
    expect(employeeCalls).toHaveLength(6); // initial + 5 rounds

    // Result should still include content from the last response (round 6 = index 5)
    expect(result.messages).toHaveLength(1);
    expect(result.currentEmployeeId).toBe('e-dev-1');
  });
});

describe('errorHandlerNode', () => {
  let config: RunnableConfig;

  beforeEach(() => {
    const repos = createMemoryRepositories();
    repos.seed.companies([TEST_COMPANY]);

    const eventBus = new InMemoryEventBus();
    const gateway = new MockLlmGateway();
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

  it('returns error message and marks completed', async () => {
    const state = makeState({
      interruptReason: 'LLM call failed: rate limit exceeded',
    });

    const result = await errorHandlerNode(state, config);

    expect(result.completed).toBe(true);
    expect(result.messages).toHaveLength(1);
  });

  it('handles null interrupt reason gracefully', async () => {
    const state = makeState({ interruptReason: null });

    const result = await errorHandlerNode(state, config);

    expect(result.completed).toBe(true);
    expect(result.messages).toHaveLength(1);
  });
});
