import { HumanMessage } from '@langchain/core/messages';
import type { RunnableConfig } from '@langchain/core/runnables';
import { describe, expect, it } from 'vitest';
import { employeeNode } from '../../agents/employee-node.js';
import type { AicsGraphState } from '../../graph/state.js';
import { TEST_COMPANY_ID, TEST_THREAD_ID } from '../helpers/fixtures.js';
import { createTestRuntime } from '../helpers/test-runtime.js';

function makeState(overrides?: Partial<AicsGraphState>): AicsGraphState {
  return {
    threadId: TEST_THREAD_ID,
    companyId: TEST_COMPANY_ID,
    entryMode: 'boss_chat' as const,
    targetEmployeeId: null,
    messages: [new HumanMessage('Work request')],
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
    handoffCount: 0,
    meetingActionItems: [],
    hrAssessment: null,
    projectId: null,
    meetingInterrupt: null,
    ...overrides,
  };
}

describe('memory flow (integration)', () => {
  it('employee remembers in task 1, memory is injected in task 2 prompt', async () => {
    const { repos, gateway, runtimeCtx, events } = createTestRuntime();

    const config: RunnableConfig = { configurable: { runtimeCtx } };

    // --- Task 1: Employee uses "remember" tool to store a memory ---
    await repos.taskRuns.create({
      task_run_id: 'tr-task-1',
      thread_id: TEST_THREAD_ID,
      employee_id: 'e-dev-1',
      parent_task_run_id: null,
      task_type: 'code',
      status: 'pending',
      input_json: JSON.stringify({ description: 'Set up project structure' }),
      output_json: null,
      started_at: new Date().toISOString(),
    });

    // LLM calls remember tool
    gateway.pushResponse({
      content: '',
      toolCalls: [
        {
          id: 'tc-rem-1',
          name: 'remember',
          arguments: {
            content: 'Project uses set up project monorepo with pnpm workspaces',
            category: 'knowledge',
            scope: 'employee',
            importance: 0.8,
          },
        },
      ],
    });
    // Follow-up: final content
    gateway.pushResponse({ content: 'Project structure is ready.' });
    // reflectAndRemember for task 1 (boss_chat mode)
    gateway.pushResponse({ content: '{ "memories": [] }' });

    const state1 = makeState({
      pendingAssignments: [
        {
          taskType: 'code',
          employeeId: 'e-dev-1',
          inputJson: { description: 'Set up project structure', taskRunId: 'tr-task-1' },
        },
      ],
    });

    await employeeNode(state1, config);

    // Verify memory was stored
    const memories = await repos.memories.findByOwner('e-dev-1');
    expect(memories).toHaveLength(1);
    expect(memories[0]!.content).toContain('monorepo with pnpm workspaces');

    // --- Task 2: Employee gets a new task — memory should be injected into prompt ---
    await repos.taskRuns.create({
      task_run_id: 'tr-task-2',
      thread_id: TEST_THREAD_ID,
      employee_id: 'e-dev-1',
      parent_task_run_id: null,
      task_type: 'code',
      status: 'pending',
      input_json: JSON.stringify({ description: 'Set up project CI/CD pipeline' }),
      output_json: null,
      started_at: new Date().toISOString(),
    });

    // Capture the system prompt from the second task's LLM call
    let task2SystemPrompt = '';
    let callIdx = 0;
    const originalChat = gateway.chat.bind(gateway);
    gateway.chat = async (request) => {
      if (callIdx === 0) {
        const systemMsg = request.messages.find((m) => m.role === 'system');
        task2SystemPrompt = systemMsg?.content ?? '';
      }
      callIdx++;
      return originalChat(request);
    };

    // Task 2 main response
    gateway.pushResponse({ content: 'CI/CD pipeline configured.' });
    // reflectAndRemember for task 2
    gateway.pushResponse({ content: '{ "memories": [] }' });

    const state2 = makeState({
      pendingAssignments: [
        {
          taskType: 'code',
          employeeId: 'e-dev-1',
          inputJson: { description: 'Set up project CI/CD pipeline', taskRunId: 'tr-task-2' },
        },
      ],
    });

    await employeeNode(state2, config);

    // The system prompt for task 2 should contain the memory from task 1
    expect(task2SystemPrompt).toContain('## Your memories');
    expect(task2SystemPrompt).toContain('monorepo with pnpm workspaces');

    // Verify memory.created events
    const memCreatedEvents = events.filter((e) => e.type === 'memory.created');
    expect(memCreatedEvents.length).toBeGreaterThanOrEqual(1);
  });

  it('reflection after task stores LLM-extracted memories that persist to next task', async () => {
    const { repos, gateway, runtimeCtx } = createTestRuntime();
    const config: RunnableConfig = { configurable: { runtimeCtx } };

    // --- Task 1: Employee completes task, reflection extracts a memory ---
    await repos.taskRuns.create({
      task_run_id: 'tr-reflect-1',
      thread_id: TEST_THREAD_ID,
      employee_id: 'e-dev-1',
      parent_task_run_id: null,
      task_type: 'code',
      status: 'pending',
      input_json: JSON.stringify({ description: 'Debug the auth module' }),
      output_json: null,
      started_at: new Date().toISOString(),
    });

    // Main response
    gateway.pushResponse({ content: 'Found and fixed the auth bug.' });
    // Reflection extracts a memory
    gateway.pushResponse({
      content: JSON.stringify({
        memories: [
          {
            content: 'The auth module debug requires checking token expiry first',
            category: 'experience',
            scope: 'employee',
            importance: 0.7,
          },
        ],
      }),
    });

    const state1 = makeState({
      pendingAssignments: [
        {
          taskType: 'code',
          employeeId: 'e-dev-1',
          inputJson: { description: 'Debug the auth module', taskRunId: 'tr-reflect-1' },
        },
      ],
    });

    await employeeNode(state1, config);

    // Memory should be stored from reflection
    const memories = await repos.memories.findByOwner('e-dev-1');
    expect(memories).toHaveLength(1);
    expect(memories[0]!.content).toContain('auth module debug');

    // --- Task 2: New task that also mentions auth — memory should be injected ---
    await repos.taskRuns.create({
      task_run_id: 'tr-reflect-2',
      thread_id: TEST_THREAD_ID,
      employee_id: 'e-dev-1',
      parent_task_run_id: null,
      task_type: 'code',
      status: 'pending',
      input_json: JSON.stringify({ description: 'Improve the auth module performance' }),
      output_json: null,
      started_at: new Date().toISOString(),
    });

    let task2SystemPrompt = '';
    let callIdx = 0;
    const originalChat = gateway.chat.bind(gateway);
    gateway.chat = async (request) => {
      if (callIdx === 0) {
        const systemMsg = request.messages.find((m) => m.role === 'system');
        task2SystemPrompt = systemMsg?.content ?? '';
      }
      callIdx++;
      return originalChat(request);
    };

    gateway.pushResponse({ content: 'Auth performance improved.' });
    gateway.pushResponse({ content: '{ "memories": [] }' });

    const state2 = makeState({
      pendingAssignments: [
        {
          taskType: 'code',
          employeeId: 'e-dev-1',
          inputJson: {
            description: 'Improve the auth module performance',
            taskRunId: 'tr-reflect-2',
          },
        },
      ],
    });

    await employeeNode(state2, config);

    // Task 2 system prompt should contain the memory from task 1's reflection
    expect(task2SystemPrompt).toContain('## Your memories');
    expect(task2SystemPrompt).toContain('auth module debug');
  });
});
