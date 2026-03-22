import { HumanMessage } from '@langchain/core/messages';
import type { RunnableConfig } from '@langchain/core/runnables';
import { describe, expect, it } from 'vitest';
import {
  meetingInjectNode,
  meetingPausedNode,
  meetingResumeNode,
  meetingTurnCheck,
  meetingStartNode,
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
    hrAssessment: null,
    projectId: null,
    meetingInterrupt: null,
    dispatchedStepIndices: [],
    completedStepIndices: [],
    ...overrides,
  };
}

describe('meeting interrupt — meetingTurnCheck routing', () => {
  it('routes to meeting_paused when interrupt type is pause', () => {
    const state = makeState({
      meetingInterrupt: { type: 'pause' },
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

    expect(meetingTurnCheck(state)).toBe('meeting_paused');
  });

  it('routes to meeting_end when interrupt type is end', () => {
    const state = makeState({
      meetingInterrupt: { type: 'end' },
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

    expect(meetingTurnCheck(state)).toBe('meeting_end');
  });

  it('routes to meeting_inject when interrupt type is inject', () => {
    const state = makeState({
      meetingInterrupt: { type: 'inject', bossComment: 'Focus on security' },
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

    expect(meetingTurnCheck(state)).toBe('meeting_inject');
  });

  it('routes normally when meetingInterrupt is null', () => {
    const state = makeState({
      meetingInterrupt: null,
    dispatchedStepIndices: [],
    completedStepIndices: [],
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

    expect(meetingTurnCheck(state)).toBe('participant_turn');
  });

  it('routes normally when meetingInterrupt type is null', () => {
    const state = makeState({
      meetingInterrupt: { type: null },
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

    expect(meetingTurnCheck(state)).toBe('participant_turn');
  });
});

describe('meeting interrupt — meetingPausedNode', () => {
  it('updates meeting status to paused and emits event', async () => {
    const { runtimeCtx, repos, events } = createTestRuntime();
    const config: RunnableConfig = { configurable: { runtimeCtx } };

    const meetingId = 'mtg-pause-test';
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
      meetingInterrupt: { type: 'pause' },
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

    const result = await meetingPausedNode(state, config);

    // Should clear the interrupt
    expect(result.meetingInterrupt).toBeNull();

    // Should have a paused message
    expect(result.messages).toHaveLength(1);
    const msgContent = result.messages![0]!.content as string;
    expect(msgContent).toContain('Paused');

    // Meeting status should be updated
    const meeting = await repos.meetings.findById(meetingId);
    expect(meeting?.status).toBe('paused');

    // Event should be emitted
    const meetingEvents = events.filter((e) => e.type === 'meeting.state.changed');
    expect(meetingEvents).toHaveLength(1);
    expect(meetingEvents[0]?.payload.next).toBe('paused');
  });
});

describe('meeting interrupt — meetingResumeNode', () => {
  it('updates meeting status to running and emits event', async () => {
    const { runtimeCtx, repos, events } = createTestRuntime();
    const config: RunnableConfig = { configurable: { runtimeCtx } };

    const meetingId = 'mtg-resume-test';
    await repos.meetings.create({
      meeting_id: meetingId,
      company_id: runtimeCtx.companyId,
      thread_id: TEST_THREAD_ID,
      topic: 'Architecture',
      status: 'paused',
      summary_json: null,
      created_at: new Date().toISOString(),
      updated_at: new Date().toISOString(),
    });

    const state = makeState({
      meetingId,
      meetingInterrupt: { type: null }, // null = resume
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

    const result = await meetingResumeNode(state, config);

    // Should clear the interrupt
    expect(result.meetingInterrupt).toBeNull();

    // Should have a resumed message
    expect(result.messages).toHaveLength(1);
    const msgContent = result.messages![0]!.content as string;
    expect(msgContent).toContain('Resumed');

    // Meeting status should be updated
    const meeting = await repos.meetings.findById(meetingId);
    expect(meeting?.status).toBe('running');

    // Event should be emitted
    const meetingEvents = events.filter((e) => e.type === 'meeting.state.changed');
    expect(meetingEvents).toHaveLength(1);
    expect(meetingEvents[0]?.payload.prev).toBe('paused');
    expect(meetingEvents[0]?.payload.next).toBe('running');
  });
});

describe('meeting interrupt — meetingInjectNode', () => {
  it('injects boss comment into transcript and continues', async () => {
    const { runtimeCtx } = createTestRuntime();
    const config: RunnableConfig = { configurable: { runtimeCtx } };

    const state = makeState({
      meetingId: 'mtg-inject-test',
      meetingInterrupt: { type: 'inject', bossComment: 'Focus on security!' },
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

    const result = await meetingInjectNode(state, config);

    // Should clear the interrupt
    expect(result.meetingInterrupt).toBeNull();

    // Should have injected boss comment as a message
    expect(result.messages).toHaveLength(1);
    const msgContent = result.messages![0]!.content as string;
    expect(msgContent).toContain('[Boss]: Focus on security!');

    // Should have updated the turn state transcript with boss comment
    const turnStateAssignment = result.pendingAssignments?.[0];
    expect(turnStateAssignment).toBeDefined();
    const turnState = turnStateAssignment!.inputJson as { transcript: string[] };
    expect(turnState.transcript).toContain('[Boss]: Focus on security!');
    expect(turnState.transcript).toHaveLength(2); // original + injected
  });
});

describe('meeting interrupt — participantTurnNode consumes interrupt box', () => {
  it('picks up interrupt from meetingInterruptBox after LLM call', async () => {
    const { gateway, runtimeCtx } = createTestRuntime();
    const config: RunnableConfig = { configurable: { runtimeCtx } };

    // Start meeting first
    const startState = makeState();
    const startResult = await meetingStartNode(startState, config);

    // Set a pending interrupt before the participant turn
    runtimeCtx.meetingInterruptBox.pending = { type: 'pause' };

    // Run participant turn
    gateway.pushResponse({ content: 'I think we should use microservices.' });
    const turnState = makeState({
      ...startResult,
      meetingId: startResult.meetingId!,
    });
    const turnResult = await participantTurnNode(turnState, config);

    // The interrupt should be consumed from the box
    expect(runtimeCtx.meetingInterruptBox.pending).toBeNull();

    // The result should carry the interrupt for meetingTurnCheck
    expect(turnResult.meetingInterrupt).toBeDefined();
    expect(turnResult.meetingInterrupt?.type).toBe('pause');
  });

  it('does not set interrupt when box is empty', async () => {
    const { gateway, runtimeCtx } = createTestRuntime();
    const config: RunnableConfig = { configurable: { runtimeCtx } };

    const startState = makeState();
    const startResult = await meetingStartNode(startState, config);

    // No interrupt set
    gateway.pushResponse({ content: 'I think we should use microservices.' });
    const turnState = makeState({
      ...startResult,
      meetingId: startResult.meetingId!,
    });
    const turnResult = await participantTurnNode(turnState, config);

    // meetingInterrupt should be null
    expect(turnResult.meetingInterrupt).toBeNull();
  });
});

describe('meeting interrupt — OrchestrationService.interruptMeeting', () => {
  it('sets interrupt on the meetingInterruptBox', () => {
    const { orchestrationService, runtimeCtx } = createTestRuntime();

    orchestrationService.interruptMeeting('pause');

    expect(runtimeCtx.meetingInterruptBox.pending).toEqual({ type: 'pause' });
    expect(orchestrationService.hasPendingInterrupt).toBe(true);
  });

  it('sets inject interrupt with boss comment', () => {
    const { orchestrationService, runtimeCtx } = createTestRuntime();

    orchestrationService.interruptMeeting('inject', 'Focus on security');

    expect(runtimeCtx.meetingInterruptBox.pending).toEqual({
      type: 'inject',
      bossComment: 'Focus on security',
    });
  });

  it('clears interrupt when type is null', () => {
    const { orchestrationService, runtimeCtx } = createTestRuntime();

    // Set then clear
    orchestrationService.interruptMeeting('pause');
    expect(orchestrationService.hasPendingInterrupt).toBe(true);

    orchestrationService.interruptMeeting(null);
    expect(runtimeCtx.meetingInterruptBox.pending).toBeNull();
    expect(orchestrationService.hasPendingInterrupt).toBe(false);
  });
});
