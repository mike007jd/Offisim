import { describe, it, expect } from 'vitest';
import { HumanMessage } from '@langchain/core/messages';
import { createTestRuntime } from '../helpers/test-runtime.js';
import { TEST_THREAD_ID } from '../helpers/fixtures.js';
import {
  meetingStartNode,
  participantTurnNode,
  meetingTurnCheck,
  meetingEndNode,
} from '../../graph/meeting-subgraph.js';
import type { AicsGraphState } from '../../graph/state.js';
import type { RunnableConfig } from '@langchain/core/runnables';

function makeState(overrides?: Partial<AicsGraphState>): AicsGraphState {
  return {
    threadId: TEST_THREAD_ID,
    companyId: 'c-test-1',
    entryMode: 'meeting' as const,
    messages: [new HumanMessage('Discuss architecture decisions')],
    routeDecision: 'start_meeting',
    currentTaskRunId: null,
    currentEmployeeId: null,
    pendingAssignments: [],
    completed: false,
    interruptReason: null,
    meetingId: null,
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
    expect(startResult.pendingAssignments![0]!.taskType).toBe('__meeting_state');

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

  it('meeting turn check ends after one full round', () => {
    // After all participants have spoken once (turnCount >= 1, participantIndex === 0)
    const state = makeState({
      pendingAssignments: [{
        taskType: '__meeting_state',
        employeeId: 'e-dev-1',
        inputJson: {
          turnCount: 1,
          participantIndex: 0,
          participantIds: ['e-mgr-1', 'e-dev-1'],
          transcript: ['[Manager Bot]: point 1', '[Dev Bot]: point 2'],
        },
      }],
    });

    const decision = meetingTurnCheck(state);
    expect(decision).toBe('meeting_end');
  });

  it('meeting turn check continues during first round', () => {
    const state = makeState({
      pendingAssignments: [{
        taskType: '__meeting_state',
        employeeId: 'e-dev-1',
        inputJson: {
          turnCount: 0,
          participantIndex: 1,
          participantIds: ['e-mgr-1', 'e-dev-1'],
          transcript: ['[Manager Bot]: point 1'],
        },
      }],
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
      status: 'active',
      summary_json: null,
      created_at: new Date().toISOString(),
      updated_at: new Date().toISOString(),
    });

    const state = makeState({
      meetingId,
      pendingAssignments: [{
        taskType: '__meeting_state',
        employeeId: 'e-dev-1',
        inputJson: {
          turnCount: 1,
          participantIndex: 0,
          participantIds: ['e-mgr-1', 'e-dev-1'],
          transcript: ['[Manager Bot]: Use microservices', '[Dev Bot]: Agreed'],
        },
      }],
    });

    const endResult = await meetingEndNode(state, config);

    expect(endResult.completed).toBe(true);

    // Check meeting was updated
    const meeting = await repos.meetings.findById(meetingId);
    expect(meeting?.status).toBe('ended');
    expect(meeting?.summary_json).toBeTruthy();

    // Check event emitted
    const meetingEvents = events.filter((e) => e.type === 'meeting.state.changed');
    expect(meetingEvents).toHaveLength(1);
  });
});
