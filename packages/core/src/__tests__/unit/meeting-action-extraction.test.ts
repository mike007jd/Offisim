import { AIMessage, HumanMessage } from '@langchain/core/messages';
import type { RunnableConfig } from '@langchain/core/runnables';
import type { RuntimeEvent } from '@offisim/shared-types';
import { beforeEach, describe, expect, it } from 'vitest';
import { bossSummaryNode } from '../../agents/boss-summary-node.js';
import { InMemoryEventBus } from '../../events/event-bus.js';
import { meetingEndNode } from '../../graph/meeting-subgraph.js';
import type { MeetingActionItem, OffisimGraphState } from '../../graph/state.js';
import { ModelResolver } from '../../llm/model-resolver.js';
import { createMemoryRepositories } from '../../runtime/memory-repositories.js';
import type { EmployeeRow } from '../../runtime/repositories.js';
import { createRuntimeContext } from '../../runtime/runtime-context.js';
import { MockToolExecutor } from '../../runtime/tool-executor.js';
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

// --- Helpers ---

function makeState(overrides?: Partial<OffisimGraphState>): OffisimGraphState {
  return {
    threadId: TEST_THREAD_ID,
    companyId: TEST_COMPANY_ID,
    entryMode: 'meeting' as const,
    targetEmployeeId: null,
    messages: [new HumanMessage('Discuss the architecture')],
    routeDecision: null,
    currentTaskRunId: null,
    currentEmployeeId: null,
    pendingAssignments: [],
    completed: false,
    interruptReason: null,
    meetingId: 'mtg-test-1',
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

function makeMeetingTurnState(participantIds: string[], transcript: string[]) {
  return [
    {
      taskType: '__meeting_state',
      employeeId: assertDefined(participantIds[0]),
      inputJson: {
        turnCount: 1,
        participantIndex: 0,
        participantIds,
        transcript,
      },
    },
  ];
}

const DEV_EMPLOYEE: EmployeeRow = makeEmployee({
  employee_id: 'e-dev-1',
  name: 'Dev Bot',
  role_slug: 'developer',
});

const DESIGNER_EMPLOYEE: EmployeeRow = makeEmployee({
  employee_id: 'e-des-1',
  name: 'Design Bot',
  role_slug: 'ux_designer',
});

// --- Tests ---

describe('meetingEndNode — action-item extraction', () => {
  let gateway: MockLlmGateway;
  let config: RunnableConfig;
  let events: RuntimeEvent[];
  let repos: ReturnType<typeof createMemoryRepositories>;

  beforeEach(async () => {
    gateway = new MockLlmGateway();
    repos = createMemoryRepositories();
    repos.seed.companies([TEST_COMPANY]);
    repos.seed.employees([makeManager(), DEV_EMPLOYEE, DESIGNER_EMPLOYEE]);

    const eventBus = new InMemoryEventBus();
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

    // Pre-create the meeting record so meetingEndNode can update it
    await repos.meetings.create({
      meeting_id: 'mtg-test-1',
      company_id: TEST_COMPANY_ID,
      thread_id: TEST_THREAD_ID,
      topic: 'Architecture discussion',
      status: 'running',
      summary_json: null,
      created_at: new Date().toISOString(),
      updated_at: new Date().toISOString(),
    });
  });

  it('extracts structured action items from valid LLM JSON response', async () => {
    const validResponse = JSON.stringify({
      summary: 'Meeting discussed architecture choices.',
      actionItems: [
        {
          description: 'Implement auth module',
          assigneeId: 'e-dev-1',
          priority: 'high',
          dependsOnIndex: [],
        },
        {
          description: 'Design login page',
          assigneeId: 'e-des-1',
          priority: 'medium',
          dependsOnIndex: [0],
        },
      ],
      decisions: ['Use JWT for auth', 'Adopt Material Design'],
    });

    gateway.pushResponse({ content: validResponse });

    const state = makeState({
      pendingAssignments: makeMeetingTurnState(
        ['e-dev-1', 'e-des-1'],
        ['[Dev Bot]: We need auth.', '[Design Bot]: I can help with UI.'],
      ),
    });

    const result = await meetingEndNode(state, config);

    // Should populate meetingActionItems
    expect(result.meetingActionItems).toBeDefined();
    expect(result.meetingActionItems).toHaveLength(2);

    const items = assertDefined(result.meetingActionItems);
    expect(items[0]?.description).toBe('Implement auth module');
    expect(items[0]?.assigneeEmployeeId).toBe('e-dev-1');
    expect(items[0]?.assigneeName).toBe('Dev Bot');
    expect(items[0]?.priority).toBe('high');
    expect(items[0]?.dependsOn).toEqual([]);

    expect(items[1]?.description).toBe('Design login page');
    expect(items[1]?.assigneeEmployeeId).toBe('e-des-1');
    expect(items[1]?.assigneeName).toBe('Design Bot');
    expect(items[1]?.priority).toBe('medium');
    // dependsOnIndex [0] should map to first item's taskRunId
    expect(items[1]?.dependsOn).toEqual([items[0]?.taskRunId]);

    // Should have created TaskRuns
    const taskRuns = await repos.taskRuns.findByThread(TEST_THREAD_ID);
    const actionTaskRuns = taskRuns.filter((t) => t.task_type === 'meeting_action');
    expect(actionTaskRuns).toHaveLength(2);
    expect(actionTaskRuns[0]?.status).toBe('queued');
    expect(actionTaskRuns[0]?.employee_id).toBe('e-dev-1');
    expect(actionTaskRuns[1]?.employee_id).toBe('e-des-1');

    // Should have emitted meeting.action.created events
    const actionEvents = events.filter((e) => e.type === 'meeting.action.created');
    expect(actionEvents).toHaveLength(2);

    // Meeting should still be completed
    expect(result.completed).toBe(true);
    const meeting = await repos.meetings.findById('mtg-test-1');
    expect(meeting?.status).toBe('completed');
  });

  it('falls back to empty action items on invalid JSON', async () => {
    // Return non-JSON response
    gateway.pushResponse({ content: 'This is not valid JSON at all.' });

    const state = makeState({
      pendingAssignments: makeMeetingTurnState(['e-dev-1'], ['[Dev Bot]: We discussed things.']),
    });

    const result = await meetingEndNode(state, config);

    // Should gracefully fall back to empty action items
    expect(result.meetingActionItems).toBeDefined();
    expect(result.meetingActionItems).toHaveLength(0);

    // Meeting should still be completed
    expect(result.completed).toBe(true);
    const meeting = await repos.meetings.findById('mtg-test-1');
    expect(meeting?.status).toBe('completed');

    // No action events should have been emitted
    const actionEvents = events.filter((e) => e.type === 'meeting.action.created');
    expect(actionEvents).toHaveLength(0);
  });

  it('falls back to empty action items when Zod validation fails', async () => {
    // Return JSON with invalid assigneeId (not a valid employee)
    const invalidResponse = JSON.stringify({
      summary: 'Meeting summary.',
      actionItems: [
        {
          description: 'Do something',
          assigneeId: 'e-nonexistent',
          priority: 'critical', // invalid priority
          dependsOnIndex: [],
        },
      ],
      decisions: [],
    });

    gateway.pushResponse({ content: invalidResponse });

    const state = makeState({
      pendingAssignments: makeMeetingTurnState(['e-dev-1'], ['[Dev Bot]: Discussion.']),
    });

    const result = await meetingEndNode(state, config);

    // Should fall back to empty
    expect(result.meetingActionItems).toBeDefined();
    expect(result.meetingActionItems).toHaveLength(0);

    // Meeting should still be completed
    expect(result.completed).toBe(true);
  });
});

describe('bossSummaryNode — meetingActionItems formatting', () => {
  let gateway: MockLlmGateway;
  let config: RunnableConfig;

  beforeEach(() => {
    gateway = new MockLlmGateway();
    const repos = createMemoryRepositories();
    repos.seed.companies([TEST_COMPANY]);
    repos.seed.employees([makeManager(), DEV_EMPLOYEE, DESIGNER_EMPLOYEE]);

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
  });

  it('appends formatted action items to meeting summary output', async () => {
    const meetingActionItems: MeetingActionItem[] = [
      {
        taskRunId: 'tr-1',
        description: 'Implement auth module',
        assigneeEmployeeId: 'e-dev-1',
        assigneeName: 'Dev Bot',
        priority: 'high',
        dependsOn: [],
      },
      {
        taskRunId: 'tr-2',
        description: 'Design login page',
        assigneeEmployeeId: 'e-des-1',
        assigneeName: 'Design Bot',
        priority: 'medium',
        dependsOn: ['tr-1'],
      },
    ];

    const state = makeState({
      entryMode: 'meeting',
      meetingActionItems,
      messages: [
        new HumanMessage('Discuss architecture'),
        new AIMessage({ content: '[Meeting] Started: "Architecture" with 2 participants.' }),
        new AIMessage({ content: '[Dev Bot]: We need auth.' }),
        new AIMessage({ content: '[Design Bot]: I can design it.' }),
        new AIMessage({
          content: '[Meeting] Concluded after 2 contributions from 2 participants.',
        }),
      ],
    });

    // The bossSummaryNode will call LLM for multi-result summary
    // Use stream response for the streaming path
    gateway.pushStreamResponse({
      content: 'The team discussed architecture and decided on auth approach.',
    });

    const result = await bossSummaryNode(state, config);

    expect(result.completed).toBe(true);
    const content = result.messages?.[0];
    expect(content).toBeDefined();
    const text = typeof content?.content === 'string' ? content.content : '';

    // Should contain action items section
    expect(text).toContain('Action items');
    expect(text).toContain('[high] Dev Bot');
    expect(text).toContain('Implement auth module');
    expect(text).toContain('[medium] Design Bot');
    expect(text).toContain('Design login page');
  });

  it('does not append action items section when meetingActionItems is empty', async () => {
    const state = makeState({
      entryMode: 'meeting',
      meetingActionItems: [],
      messages: [
        new HumanMessage('Discuss architecture'),
        new AIMessage({
          content: '[Meeting] Concluded after 2 contributions from 2 participants.',
        }),
      ],
    });

    const result = await bossSummaryNode(state, config);

    expect(result.completed).toBe(true);
    // Single meeting message → no LLM call needed → direct pass-through
    const content = result.messages?.[0];
    if (content) {
      const text = typeof content.content === 'string' ? content.content : '';
      expect(text).not.toContain('Action items');
    }
  });
});
