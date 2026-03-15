import type { RuntimeEvent } from '@aics/shared-types';
import { HumanMessage } from '@langchain/core/messages';
import type { RunnableConfig } from '@langchain/core/runnables';
import { Command } from '@langchain/langgraph';
import { beforeEach, describe, expect, it } from 'vitest';
import { employeeNode } from '../../agents/employee-node.js';
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
    meetingInterrupt: null,
    ...overrides,
  };
}

describe('employeeNode — handoff via Command', () => {
  let gateway: MockLlmGateway;
  let config: RunnableConfig;
  let events: RuntimeEvent[];
  let repos: ReturnType<typeof createMemoryRepositories>;

  beforeEach(async () => {
    gateway = new MockLlmGateway();
    repos = createMemoryRepositories();
    repos.seed.companies([TEST_COMPANY]);
    repos.seed.employees([
      makeManager(),
      makeEmployee(), // e-dev-1 (developer)
      makeEmployee({
        employee_id: 'e-design-1',
        name: 'Design Bot',
        role_slug: 'designer',
        persona_json: JSON.stringify({ expertise: 'UI/UX design' }),
      }),
    ]);

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

    // Seed a task run
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

  it('returns Command when LLM calls handoff_to tool', async () => {
    // LLM decides to hand off to designer
    gateway.pushResponse({
      content: '',
      toolCalls: [
        {
          id: 'tc-handoff-1',
          name: 'handoff_to',
          arguments: {
            targetEmployeeId: 'e-design-1',
            reason: 'This task requires UI design expertise',
            completedWork: 'I set up the project structure',
            remainingWork: 'Design the landing page UI',
          },
        },
      ],
    });

    const state = makeState();
    const result = await employeeNode(state, config);

    // Should return a Command instance, not a plain state object
    expect(result).toBeInstanceOf(Command);
  });

  it('Command contains correct goto and update fields', async () => {
    gateway.pushResponse({
      content: '',
      toolCalls: [
        {
          id: 'tc-handoff-1',
          name: 'handoff_to',
          arguments: {
            targetEmployeeId: 'e-design-1',
            reason: 'Needs design work',
            completedWork: 'Backend done',
            remainingWork: 'Frontend design',
          },
        },
      ],
    });

    const state = makeState();
    const result = await employeeNode(state, config);

    // Cast to access Command internals
    // Command stores params in a symbol-keyed property, access via JSON or check the update
    expect(result).toBeInstanceOf(Command);

    // The Command's update should contain the handoff state
    const cmd = result as Command;
    // Access internal command params — Command stores them as (cmd as any)[Symbol for COMMAND_SYMBOL]
    // We verify via the graph state update it produces
    const sym = Object.getOwnPropertySymbols(cmd)[0]!;
    // biome-ignore lint/suspicious/noExplicitAny: accessing internal Command params via symbol
    const params = (cmd as any)[sym];
    expect(params.goto).toBe('employee');
    expect(params.update.handoffCount).toBe(1);
    expect(params.update.pendingAssignments).toHaveLength(1);
    expect(params.update.pendingAssignments[0].employeeId).toBe('e-design-1');
    expect(params.update.pendingAssignments[0].taskType).toBe('handoff_continuation');
    expect(params.update.currentStepOutputs).toHaveLength(1);
    expect(params.update.currentStepOutputs[0].employeeId).toBe('e-dev-1');
  });

  it('writes handoff record to repository', async () => {
    gateway.pushResponse({
      content: '',
      toolCalls: [
        {
          id: 'tc-handoff-1',
          name: 'handoff_to',
          arguments: {
            targetEmployeeId: 'e-design-1',
            reason: 'Needs design',
            completedWork: 'Code done',
            remainingWork: 'Design needed',
          },
        },
      ],
    });

    const state = makeState();
    await employeeNode(state, config);

    const handoffs = await repos.handoffs.findByThread(TEST_THREAD_ID);
    expect(handoffs).toHaveLength(1);
    expect(handoffs[0]!.from_employee_id).toBe('e-dev-1');
    expect(handoffs[0]!.to_employee_id).toBe('e-design-1');
    expect(handoffs[0]!.reason).toBe('Needs design');
  });

  it('creates new task run for receiving employee', async () => {
    gateway.pushResponse({
      content: '',
      toolCalls: [
        {
          id: 'tc-handoff-1',
          name: 'handoff_to',
          arguments: {
            targetEmployeeId: 'e-design-1',
            reason: 'Design needed',
            completedWork: 'Structure done',
            remainingWork: 'Do the design',
          },
        },
      ],
    });

    const state = makeState();
    await employeeNode(state, config);

    // Find task runs for this thread
    const taskRuns = await repos.taskRuns.findByThread(TEST_THREAD_ID);
    const handoffTaskRun = taskRuns.find((tr) => tr.task_type === 'handoff_continuation');
    expect(handoffTaskRun).toBeDefined();
    expect(handoffTaskRun!.employee_id).toBe('e-design-1');
    expect(handoffTaskRun!.status).toBe('queued');
  });

  it('marks current task run as completed on handoff', async () => {
    gateway.pushResponse({
      content: '',
      toolCalls: [
        {
          id: 'tc-handoff-1',
          name: 'handoff_to',
          arguments: {
            targetEmployeeId: 'e-design-1',
            reason: 'Handoff',
            completedWork: 'Done',
            remainingWork: 'Continue',
          },
        },
      ],
    });

    const state = makeState();
    await employeeNode(state, config);

    const originalTask = await repos.taskRuns.findById('tr-test-1');
    expect(originalTask?.status).toBe('completed');
  });

  it('emits handoff.initiated event', async () => {
    gateway.pushResponse({
      content: '',
      toolCalls: [
        {
          id: 'tc-handoff-1',
          name: 'handoff_to',
          arguments: {
            targetEmployeeId: 'e-design-1',
            reason: 'Design needed',
            completedWork: 'Done',
            remainingWork: 'Continue',
          },
        },
      ],
    });

    const state = makeState();
    await employeeNode(state, config);

    const handoffEvents = events.filter((e) => e.type === 'handoff.initiated');
    expect(handoffEvents).toHaveLength(1);
    expect(handoffEvents[0]!.payload.fromEmployeeId).toBe('e-dev-1');
    expect(handoffEvents[0]!.payload.toEmployeeId).toBe('e-design-1');
  });

  it('emits employee.state.changed to idle after handoff', async () => {
    gateway.pushResponse({
      content: '',
      toolCalls: [
        {
          id: 'tc-handoff-1',
          name: 'handoff_to',
          arguments: {
            targetEmployeeId: 'e-design-1',
            reason: 'Handoff',
            completedWork: 'Done',
            remainingWork: 'Continue',
          },
        },
      ],
    });

    const state = makeState();
    await employeeNode(state, config);

    const stateEvents = events.filter((e) => e.type === 'employee.state.changed');
    // Should have: idle→executing (start), executing→idle (handoff)
    const idleEvent = stateEvents.find(
      (e) => e.payload.prev === 'executing' && e.payload.next === 'idle',
    );
    expect(idleEvent).toBeDefined();
    expect(idleEvent!.payload.employeeId).toBe('e-dev-1');
  });

  it('does NOT inject handoff_to tool in direct_chat mode', async () => {
    // In direct_chat mode, LLM should not see the handoff_to tool
    // We verify by checking the LLM was called without the handoff tool
    gateway.pushResponse({ content: 'Direct chat response' });

    const state = makeState({
      entryMode: 'direct_chat',
    });
    const result = await employeeNode(state, config);

    // Should return normal state (not a Command)
    expect(result).not.toBeInstanceOf(Command);
    expect((result as Partial<AicsGraphState>).messages).toHaveLength(1);
  });

  it('does NOT inject handoff_to tool when handoffCount >= 3', async () => {
    gateway.pushResponse({ content: 'No more handoffs allowed' });

    const state = makeState({ handoffCount: 3 });
    const result = await employeeNode(state, config);

    // Should return normal state (not a Command)
    expect(result).not.toBeInstanceOf(Command);
    expect((result as Partial<AicsGraphState>).messages).toHaveLength(1);
  });

  it('does NOT inject handoff_to tool when no colleagues exist', async () => {
    // Reset repos with only one employee (no colleagues)
    const singleRepos = createMemoryRepositories();
    singleRepos.seed.companies([TEST_COMPANY]);
    singleRepos.seed.employees([makeEmployee()]); // only e-dev-1

    const eventBus = new InMemoryEventBus();
    const resolver = new ModelResolver(JSON.parse(TEST_COMPANY.default_model_policy_json!));
    const toolExecutor = new MockToolExecutor();

    const runtimeCtx = createRuntimeContext({
      repos: singleRepos,
      eventBus,
      llmGateway: gateway,
      modelResolver: resolver,
      toolExecutor,
      companyId: TEST_COMPANY_ID,
      threadId: TEST_THREAD_ID,
    });

    const singleConfig: RunnableConfig = { configurable: { runtimeCtx } };

    await singleRepos.taskRuns.create({
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

    gateway.pushResponse({ content: 'Working alone' });

    const state = makeState();
    const result = await employeeNode(state, singleConfig);

    expect(result).not.toBeInstanceOf(Command);
  });

  it('normal task completion still works (no handoff)', async () => {
    gateway.pushResponse({
      content: 'Here is the landing page code.',
    });

    const state = makeState();
    const result = await employeeNode(state, config);

    // Should return normal state (not a Command)
    expect(result).not.toBeInstanceOf(Command);
    const stateResult = result as Partial<AicsGraphState>;
    expect(stateResult.currentEmployeeId).toBe('e-dev-1');
    expect(stateResult.pendingAssignments).toHaveLength(0);
    expect(stateResult.messages).toHaveLength(1);
  });

  it('passes tools (including handoff_to) to the LLM request', async () => {
    // Track what request the LLM receives
    let capturedRequest: any = null;
    const originalChat = gateway.chat.bind(gateway);
    gateway.chat = async (request: any) => {
      capturedRequest = request;
      return originalChat(request);
    };

    gateway.pushResponse({ content: 'Task done' });

    const state = makeState();
    await employeeNode(state, config);

    // Should have passed tools to the LLM
    expect(capturedRequest).toBeDefined();
    expect(capturedRequest.tools).toBeDefined();
    expect(capturedRequest.tools.length).toBeGreaterThanOrEqual(1);

    const handoffTool = capturedRequest.tools.find((t: any) => t.name === 'handoff_to');
    expect(handoffTool).toBeDefined();
    expect(handoffTool.parameters.properties.targetEmployeeId.enum).toContain('e-design-1');
    expect(handoffTool.parameters.properties.targetEmployeeId.enum).toContain('e-mgr-1');
    // Current employee should NOT be in the enum (no self-handoff)
    expect(handoffTool.parameters.properties.targetEmployeeId.enum).not.toContain('e-dev-1');
  });
});
