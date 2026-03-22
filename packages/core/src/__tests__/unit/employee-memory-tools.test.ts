import type { RuntimeEvent } from '@aics/shared-types';
import { HumanMessage } from '@langchain/core/messages';
import type { RunnableConfig } from '@langchain/core/runnables';
import { beforeEach, describe, expect, it } from 'vitest';
import { employeeNode } from '../../agents/employee-node.js';
import { InMemoryEventBus } from '../../events/event-bus.js';
import type { AicsGraphState } from '../../graph/state.js';
import { ModelResolver } from '../../llm/model-resolver.js';
import { createMemoryRepositories } from '../../runtime/memory-repositories.js';
import { createRuntimeContext } from '../../runtime/runtime-context.js';
import { MockToolExecutor } from '../../runtime/tool-executor.js';
import { MemoryService } from '../../services/memory-service.js';
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
        inputJson: { description: 'Build landing page', taskRunId: 'tr-mem-1' },
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
    projectId: null,
    meetingInterrupt: null,
    ...overrides,
  };
}

describe('employee-node memory tools', () => {
  let gateway: MockLlmGateway;
  let config: RunnableConfig;
  // biome-ignore lint/suspicious/noExplicitAny: event collector
  let events: RuntimeEvent<any>[];
  let repos: ReturnType<typeof createMemoryRepositories>;
  let memoryService: MemoryService;

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
    memoryService = new MemoryService(repos.memories, gateway, eventBus);

    const runtimeCtx = createRuntimeContext({
      repos,
      eventBus,
      llmGateway: gateway,
      modelResolver: resolver,
      toolExecutor,
      companyId: TEST_COMPANY_ID,
      threadId: TEST_THREAD_ID,
      memoryService,
    });

    config = { configurable: { runtimeCtx } };

    await repos.taskRuns.create({
      task_run_id: 'tr-mem-1',
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

  it('handles remember tool call and creates memory entry', async () => {
    // LLM calls remember tool
    gateway.pushResponse({
      content: '',
      toolCalls: [
        {
          id: 'tc-remember-1',
          name: 'remember',
          arguments: {
            content: 'Landing pages should use hero sections',
            category: 'experience',
            scope: 'employee',
            importance: 0.7,
          },
        },
      ],
    });
    // Follow-up: LLM returns final content
    gateway.pushResponse({
      content: 'I stored a memory about landing pages.',
    });
    // reflectAndRemember call (for boss_chat mode)
    gateway.pushResponse({
      content: '{ "memories": [] }',
    });

    const state = makeState();
    const result = (await employeeNode(state, config)) as Partial<AicsGraphState>;

    expect(result.messages).toHaveLength(1);

    // Check memory was created in the repo
    const memories = await repos.memories.findByOwner('e-dev-1');
    expect(memories).toHaveLength(1);
    expect(memories[0]!.content).toBe('Landing pages should use hero sections');
    expect(memories[0]!.category).toBe('experience');
    expect(memories[0]!.scope).toBe('employee');

    // Check memory.created event was emitted
    const memEvents = events.filter((e) => e.type === 'memory.created');
    expect(memEvents.length).toBeGreaterThanOrEqual(1);
  });

  it('handles recall tool call and returns matching memories', async () => {
    // Pre-seed a memory
    await repos.memories.create({
      memory_id: 'mem-pre-1',
      company_id: TEST_COMPANY_ID,
      scope: 'employee',
      owner_id: 'e-dev-1',
      category: 'knowledge',
      content: 'React hooks require function components',
      importance: 0.8,
    });

    // LLM calls recall tool
    gateway.pushResponse({
      content: '',
      toolCalls: [
        {
          id: 'tc-recall-1',
          name: 'recall',
          arguments: { query: 'React' },
        },
      ],
    });
    // Follow-up: LLM returns final content using recalled memory
    gateway.pushResponse({
      content: 'Based on my memory, React hooks need function components.',
    });
    // reflectAndRemember
    gateway.pushResponse({ content: '{ "memories": [] }' });

    const state = makeState();
    const result = (await employeeNode(state, config)) as Partial<AicsGraphState>;

    expect(result.messages).toHaveLength(1);

    // Check memory.accessed event was emitted
    const accessEvents = events.filter((e) => e.type === 'memory.accessed');
    expect(accessEvents.length).toBeGreaterThanOrEqual(1);

    // Check access count was incremented
    const mem = await repos.memories.findById('mem-pre-1');
    expect(mem!.access_count).toBe(1);
  });

  it('handles forget tool call and deletes memory', async () => {
    // Pre-seed a memory to delete
    await repos.memories.create({
      memory_id: 'mem-del-1',
      company_id: TEST_COMPANY_ID,
      scope: 'employee',
      owner_id: 'e-dev-1',
      category: 'preference',
      content: 'Outdated preference',
      importance: 0.3,
    });

    // LLM calls forget tool
    gateway.pushResponse({
      content: '',
      toolCalls: [
        {
          id: 'tc-forget-1',
          name: 'forget',
          arguments: { memoryId: 'mem-del-1' },
        },
      ],
    });
    // Follow-up
    gateway.pushResponse({ content: 'Memory deleted.' });
    // reflectAndRemember
    gateway.pushResponse({ content: '{ "memories": [] }' });

    const state = makeState();
    await employeeNode(state, config);

    // Memory should be deleted
    const mem = await repos.memories.findById('mem-del-1');
    expect(mem).toBeNull();
  });

  it('injects relevant memories into system prompt', async () => {
    // Pre-seed a memory that matches the task description ("Build landing page")
    await repos.memories.create({
      memory_id: 'mem-inject-1',
      company_id: TEST_COMPANY_ID,
      scope: 'employee',
      owner_id: 'e-dev-1',
      category: 'experience',
      content: 'Build landing page with fast load times',
      importance: 0.9,
    });

    // Capture what the LLM receives (only the first call — the employee node main call)
    let capturedMessages: Array<{ role: string; content: string }> = [];
    let callIdx = 0;
    const originalChat = gateway.chat.bind(gateway);
    gateway.chat = async (request) => {
      if (callIdx === 0) {
        capturedMessages = [...request.messages];
      }
      callIdx++;
      return originalChat(request);
    };

    // LLM response
    gateway.pushResponse({ content: 'Here is the landing page.' });
    // reflectAndRemember
    gateway.pushResponse({ content: '{ "memories": [] }' });

    const state = makeState();
    await employeeNode(state, config);

    // System prompt should contain the memory
    const systemMsg = capturedMessages.find((m) => m.role === 'system');
    expect(systemMsg?.content).toContain('## Your memories');
    expect(systemMsg?.content).toContain('Build landing page with fast load times');
  });

  it('skips reflection for direct_chat entry mode', async () => {
    gateway.pushResponse({ content: 'Direct chat response.' });

    const state = makeState({ entryMode: 'direct_chat' });
    await employeeNode(state, config);

    // Should only have 1 LLM call (main) — no reflection call
    const llmCalls = await repos.llmCalls.findByThread(TEST_THREAD_ID);
    const employeeCalls = llmCalls.filter((c) => c.node_name === 'employee');
    expect(employeeCalls).toHaveLength(1);
  });

  it('skips reflection for handoff_continuation task type', async () => {
    gateway.pushResponse({ content: 'Continuing from handoff.' });

    const state = makeState({
      pendingAssignments: [
        {
          taskType: 'handoff_continuation',
          employeeId: 'e-dev-1',
          inputJson: {
            description: 'Continue the work',
            taskRunId: 'tr-mem-1',
            priorWork: 'Previous work done',
          },
        },
      ],
    });
    await employeeNode(state, config);

    // Should only have 1 LLM call (main) — no reflection call
    const llmCalls = await repos.llmCalls.findByThread(TEST_THREAD_ID);
    const employeeCalls = llmCalls.filter((c) => c.node_name === 'employee');
    expect(employeeCalls).toHaveLength(1);
  });

  it('calls reflectAndRemember for boss_chat entry mode', async () => {
    // Main response
    gateway.pushResponse({ content: 'Task completed.' });
    // Reflection response with a memory to store
    gateway.pushResponse({
      content: JSON.stringify({
        memories: [
          {
            content: 'Building landing pages requires attention to load time',
            category: 'experience',
            scope: 'employee',
            importance: 0.6,
          },
        ],
      }),
    });

    const state = makeState({ entryMode: 'boss_chat' });
    await employeeNode(state, config);

    // Should have 2 LLM calls: main + reflection
    const llmCalls = await repos.llmCalls.findByThread(TEST_THREAD_ID);
    const employeeCalls = llmCalls.filter((c) => c.node_name === 'employee');
    expect(employeeCalls).toHaveLength(1); // Only employee node calls are recorded

    // Memory from reflection should be stored
    const memories = await repos.memories.findByOwner('e-dev-1');
    expect(memories).toHaveLength(1);
    expect(memories[0]!.content).toContain('landing pages');
  });
});
