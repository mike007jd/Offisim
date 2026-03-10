import { describe, it, expect, beforeEach } from 'vitest';
import { HumanMessage } from '@langchain/core/messages';
import { employeeNode } from '../../agents/employee-node.js';
import { errorHandlerNode } from '../../agents/error-handler-node.js';
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
    const result = await employeeNode(state, config);

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
    const result = await employeeNode(state, config);

    expect(result.messages).toHaveLength(1);
  });

  it('sets completed when no more pending assignments', async () => {
    gateway.pushResponse({ content: 'Done.' });

    const state = makeState();
    const result = await employeeNode(state, config);

    expect(result.pendingAssignments).toHaveLength(0);
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
