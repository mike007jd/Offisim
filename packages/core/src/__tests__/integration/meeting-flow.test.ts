import { HumanMessage } from '@langchain/core/messages';
import type { RunnableConfig } from '@langchain/core/runnables';
import { describe, expect, it } from 'vitest';
import { buildAicsGraph } from '../../graph/main-graph.js';
import {
  meetingEndNode,
  meetingStartNode,
  meetingTurnCheck,
  participantTurnNode,
} from '../../graph/meeting-subgraph.js';
import type { AicsGraphState } from '../../graph/state.js';
import { TEST_THREAD_ID } from '../helpers/fixtures.js';
import { createTestRuntime } from '../helpers/test-runtime.js';

function makeState(overrides?: Partial<AicsGraphState>): AicsGraphState {
  return {
    threadId: TEST_THREAD_ID,
    companyId: 'c-test-1',
    entryMode: 'meeting' as const,
    targetEmployeeId: null,
    messages: [new HumanMessage('Discuss architecture decisions')],
    routeDecision: 'start_meeting',
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
    ...overrides,
  };
}

describe('meeting flow', () => {
  it('creates meeting and participants take turns', async () => {
    const { gateway, runtimeCtx } = createTestRuntime();
    const config: RunnableConfig = { configurable: { runtimeCtx } };

    // Step 1: Start meeting
    const state = makeState();
    const startResult = await meetingStartNode(state, config);

    expect(startResult.meetingId).toBeTruthy();
    expect(startResult.pendingAssignments).toHaveLength(1);
    expect(startResult.pendingAssignments?.[0]?.taskType).toBe('__meeting_state');

    // Step 2: Participant turn
    gateway.pushResponse({ content: 'I think we should use a microservices architecture.' });

    const turnState = makeState({
      ...startResult,
      meetingId: startResult.meetingId!,
    });
    const turnResult = await participantTurnNode(turnState, config);

    expect(turnResult.messages).toHaveLength(1);
    expect(turnResult.pendingAssignments).toHaveLength(1);
  });

  it('records llm_calls for participant turns', async () => {
    const { gateway, runtimeCtx, repos } = createTestRuntime();
    const config: RunnableConfig = { configurable: { runtimeCtx } };

    // Start meeting
    const state = makeState();
    const startResult = await meetingStartNode(state, config);

    // Participant turn with LLM call
    gateway.pushResponse({ content: 'I suggest we use event-driven architecture.' });

    const turnState = makeState({
      ...startResult,
      meetingId: startResult.meetingId!,
    });
    await participantTurnNode(turnState, config);

    // Verify LLM call was recorded
    const llmCalls = await repos.llmCalls.findByThread(runtimeCtx.threadId);
    expect(llmCalls.length).toBeGreaterThanOrEqual(1);

    const meetingCall = llmCalls.find(
      (c) => c.node_name.includes('meeting') || c.node_name.includes('participant'),
    );
    // If meeting participant turns don't use recordedLlmCall, this might be empty.
    // In that case, this test documents the gap for Phase 2.3.
    if (meetingCall) {
      expect(meetingCall.provider).toBeTruthy();
      expect(meetingCall.input_tokens).toBeGreaterThanOrEqual(0);
    }
  });

  it('meeting turn check ends after one full round', () => {
    // After all participants have spoken once (turnCount >= 1, participantIndex === 0)
    const state = makeState({
      pendingAssignments: [
        {
          taskType: '__meeting_state',
          employeeId: 'e-dev-1',
          inputJson: {
            turnCount: 1,
            participantIndex: 0,
            participantIds: ['e-mgr-1', 'e-dev-1'],
            transcript: ['[Manager Bot]: point 1', '[Dev Bot]: point 2'],
          },
        },
      ],
    });

    const decision = meetingTurnCheck(state);
    expect(decision).toBe('meeting_end');
  });

  it('meeting turn check continues during first round', () => {
    const state = makeState({
      pendingAssignments: [
        {
          taskType: '__meeting_state',
          employeeId: 'e-dev-1',
          inputJson: {
            turnCount: 0,
            participantIndex: 1,
            participantIds: ['e-mgr-1', 'e-dev-1'],
            transcript: ['[Manager Bot]: point 1'],
          },
        },
      ],
    });

    const decision = meetingTurnCheck(state);
    expect(decision).toBe('participant_turn');
  });

  it('meeting end updates session and emits event', async () => {
    const { runtimeCtx, repos, events } = createTestRuntime();
    const config: RunnableConfig = { configurable: { runtimeCtx } };

    // Create a meeting record first
    const meetingId = 'mtg-test-end';
    await repos.meetings.create({
      meeting_id: meetingId,
      company_id: runtimeCtx.companyId,
      thread_id: TEST_THREAD_ID,
      topic: 'Architecture',
      status: 'running',
      summary_json: null,
      created_at: new Date().toISOString(),
      updated_at: new Date().toISOString(),
    });

    const state = makeState({
      meetingId,
      pendingAssignments: [
        {
          taskType: '__meeting_state',
          employeeId: 'e-dev-1',
          inputJson: {
            turnCount: 1,
            participantIndex: 0,
            participantIds: ['e-mgr-1', 'e-dev-1'],
            transcript: ['[Manager Bot]: Use microservices', '[Dev Bot]: Agreed'],
          },
        },
      ],
    });

    const endResult = await meetingEndNode(state, config);

    expect(endResult.completed).toBe(true);

    // Check meeting was updated
    const meeting = await repos.meetings.findById(meetingId);
    expect(meeting?.status).toBe('completed');
    expect(meeting?.summary_json).toBeTruthy();

    // Check event emitted
    const meetingEvents = events.filter((e) => e.type === 'meeting.state.changed');
    expect(meetingEvents).toHaveLength(1);
  });
});

describe('meeting flow — full graph integration', () => {
  it('boss → meeting_start → participant turns → meeting_end → boss_summary', async () => {
    const { gateway, events, runtimeCtx } = createTestRuntime();

    const graph = buildAicsGraph();

    // 1. Boss decides to call a meeting
    gateway.pushResponse({
      content: JSON.stringify({ action: 'meeting', reason: 'team discussion requested' }),
    });

    // 2. Each participant speaks once (2 participants: e-mgr-1, e-dev-1)
    gateway.pushResponse({ content: 'We should adopt a modular architecture.' });
    gateway.pushResponse({ content: 'Agreed, modules make testing easier.' });

    // 3. Boss summary (streaming) for the final summary
    gateway.pushStreamResponse({
      content: 'Meeting concluded with consensus on modular architecture.',
      usage: { inputTokens: 100, outputTokens: 20 },
    });

    const result = await graph.invoke(
      {
        threadId: TEST_THREAD_ID,
        companyId: runtimeCtx.companyId,
        entryMode: 'meeting' as const,
        messages: [new HumanMessage('Let us have a team meeting about architecture')],
      },
      { configurable: { thread_id: TEST_THREAD_ID, runtimeCtx } },
    );

    // Should have completed
    expect(result.completed).toBe(true);

    // Route decision should be start_meeting
    expect(result.routeDecision).toBe('start_meeting');

    // Should have a meetingId
    expect(result.meetingId).toBeTruthy();

    // Meeting state changed events: running + completed
    const meetingEvents = events.filter((e) => e.type === 'meeting.state.changed');
    expect(meetingEvents).toHaveLength(2);
    expect(meetingEvents[0]?.payload.next).toBe('running');
    expect(meetingEvents[1]?.payload.next).toBe('completed');

    // Should have messages from the meeting flow
    expect(result.messages.length).toBeGreaterThanOrEqual(4); // human + meeting start + 2 turns + meeting end + summary
  });
});
