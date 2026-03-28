/**
 * Tests for the pure routing functions exported from main-graph.ts.
 * These functions are deterministic given a state object — no LLM calls needed.
 */
import { describe, expect, it } from 'vitest';
import {
  routeFromBoss,
  routeFromEmployee,
  routeFromManager,
  routeFromPm,
  routeFromStart,
} from '../../graph/main-graph.js';
import type { OffisimGraphState, PlanStep, PlanTask } from '../../graph/state.js';

/** Build a minimal state, overriding only the fields under test. */
function makeState(overrides: Partial<OffisimGraphState> = {}): OffisimGraphState {
  return {
    threadId: 't-1',
    companyId: 'c-1',
    entryMode: 'boss_chat',
    projectId: null,
    targetEmployeeId: null,
    messages: [],
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
    dispatchedStepIndices: [],
    completedStepIndices: [],
    handoffCount: 0,
    meetingActionItems: [],
    meetingInterrupt: null,
    hrAssessment: null,
    replanCount: 0,
    ...overrides,
  };
}

// ── Helper to build a minimal TaskPlan ─────────────────────────────

function makeTask(): PlanTask {
  return {
    taskType: 'code',
    employeeId: 'e-1',
    description: 'write code',
    dependsOnStepOutput: false,
  };
}

function makePlan(stepCount: number): OffisimGraphState['taskPlan'] {
  const steps: PlanStep[] = Array.from({ length: stepCount }, (_, i) => ({
    stepIndex: i,
    description: `step ${i}`,
    tasks: [makeTask()],
  }));
  return {
    planId: 'plan-1',
    threadId: 't-1',
    companyId: 'c-1',
    steps,
    summary: 'test plan',
  };
}

// ── routeFromStart ──────────────────────────────────────────────────

describe('routeFromStart', () => {
  it('boss_chat → boss', () => {
    expect(routeFromStart(makeState({ entryMode: 'boss_chat' }))).toBe('boss');
  });

  it('background_sync → boss', () => {
    expect(routeFromStart(makeState({ entryMode: 'background_sync' }))).toBe('boss');
  });

  it('install_flow → boss (default branch)', () => {
    expect(routeFromStart(makeState({ entryMode: 'install_flow' }))).toBe('boss');
  });

  it('direct_chat with targetEmployeeId → employee_direct_setup', () => {
    expect(routeFromStart(makeState({ entryMode: 'direct_chat', targetEmployeeId: 'e-1' }))).toBe(
      'employee_direct_setup',
    );
  });

  it('direct_chat without targetEmployeeId → boss (falls through)', () => {
    // No targetEmployeeId — condition not met, falls to default boss
    expect(routeFromStart(makeState({ entryMode: 'direct_chat', targetEmployeeId: null }))).toBe(
      'boss',
    );
  });

  it('meeting with meetingId + meetingInterrupt type=end → meeting_end', () => {
    expect(
      routeFromStart(
        makeState({
          entryMode: 'meeting',
          meetingId: 'mtg-1',
          meetingInterrupt: { type: 'end' },
        }),
      ),
    ).toBe('meeting_end');
  });

  it('meeting with meetingId + meetingInterrupt type=pause → meeting_resume', () => {
    expect(
      routeFromStart(
        makeState({
          entryMode: 'meeting',
          meetingId: 'mtg-1',
          meetingInterrupt: { type: 'pause' },
        }),
      ),
    ).toBe('meeting_resume');
  });

  it('meeting without meetingId → boss (condition not met)', () => {
    expect(
      routeFromStart(makeState({ entryMode: 'meeting', meetingId: null, meetingInterrupt: null })),
    ).toBe('boss');
  });
});

// ── routeFromBoss ───────────────────────────────────────────────────

describe('routeFromBoss', () => {
  it('interruptReason set → error_handler (regardless of routeDecision)', () => {
    expect(
      routeFromBoss(makeState({ interruptReason: 'some error', routeDecision: 'direct_reply' })),
    ).toBe('error_handler');
  });

  it('delegate_manager → manager', () => {
    expect(routeFromBoss(makeState({ routeDecision: 'delegate_manager' }))).toBe('manager');
  });

  it('direct_reply → boss_summary', () => {
    expect(routeFromBoss(makeState({ routeDecision: 'direct_reply' }))).toBe('boss_summary');
  });

  it('start_meeting → meeting_start', () => {
    expect(routeFromBoss(makeState({ routeDecision: 'start_meeting' }))).toBe('meeting_start');
  });

  it('direct_delegate → employee_direct_setup', () => {
    expect(routeFromBoss(makeState({ routeDecision: 'direct_delegate' }))).toBe(
      'employee_direct_setup',
    );
  });

  it('null routeDecision → manager (default branch)', () => {
    expect(routeFromBoss(makeState({ routeDecision: null }))).toBe('manager');
  });
});

// ── routeFromManager ────────────────────────────────────────────────

describe('routeFromManager', () => {
  it('no managerDirective → pm_planner', () => {
    expect(routeFromManager(makeState({ managerDirective: null }))).toBe('pm_planner');
  });

  it('managerDirective with constraints=hire → hr', () => {
    expect(
      routeFromManager(
        makeState({
          managerDirective: {
            intent: 'hire a developer',
            recommendedEmployees: [],
            constraints: 'hire',
          },
        }),
      ),
    ).toBe('hr');
  });

  it('managerDirective with constraints=assess_team → hr', () => {
    expect(
      routeFromManager(
        makeState({
          managerDirective: {
            intent: 'review team',
            recommendedEmployees: [],
            constraints: 'assess_team',
          },
        }),
      ),
    ).toBe('hr');
  });

  it('managerDirective with sopTemplateId but no hire/assess_team → pm_planner', () => {
    expect(
      routeFromManager(
        makeState({
          managerDirective: {
            intent: 'build feature',
            recommendedEmployees: ['e-1'],
            sopTemplateId: 'sop-1',
          },
        }),
      ),
    ).toBe('pm_planner');
  });

  it('managerDirective with other constraints → pm_planner', () => {
    expect(
      routeFromManager(
        makeState({
          managerDirective: {
            intent: 'refactor',
            recommendedEmployees: [],
            constraints: 'budget_limit',
          },
        }),
      ),
    ).toBe('pm_planner');
  });
});

// ── routeFromPm ─────────────────────────────────────────────────────

describe('routeFromPm', () => {
  it('no taskPlan → boss_summary', () => {
    expect(routeFromPm(makeState({ taskPlan: null }))).toBe('boss_summary');
  });

  it('taskPlan with 0 steps → boss_summary', () => {
    const plan = makePlan(0);
    expect(routeFromPm(makeState({ taskPlan: plan }))).toBe('boss_summary');
  });

  it('taskPlan with steps → step_dispatcher', () => {
    const plan = makePlan(2);
    expect(routeFromPm(makeState({ taskPlan: plan }))).toBe('step_dispatcher');
  });
});

// ── routeFromEmployee ───────────────────────────────────────────────

describe('routeFromEmployee', () => {
  it('interruptReason set → error_handler', () => {
    expect(
      routeFromEmployee(makeState({ interruptReason: 'timeout', pendingAssignments: [] })),
    ).toBe('error_handler');
  });

  it('pendingAssignments not empty → employee (loop back)', () => {
    expect(
      routeFromEmployee(
        makeState({
          pendingAssignments: [{ taskType: 'code', employeeId: 'e-1', inputJson: {} }],
        }),
      ),
    ).toBe('employee');
  });

  it('no pending, no plan → boss_summary', () => {
    expect(routeFromEmployee(makeState({ pendingAssignments: [], taskPlan: null }))).toBe(
      'boss_summary',
    );
  });

  it('all steps completed → boss_summary', () => {
    const plan = makePlan(2); // stepIndex 0 and 1
    expect(
      routeFromEmployee(
        makeState({
          pendingAssignments: [],
          taskPlan: plan,
          completedStepIndices: [0, 1], // both done
        }),
      ),
    ).toBe('boss_summary');
  });

  it('some steps remaining → step_advance', () => {
    const plan = makePlan(3); // steps 0, 1, 2
    expect(
      routeFromEmployee(
        makeState({
          pendingAssignments: [],
          taskPlan: plan,
          completedStepIndices: [0], // step 1 and 2 remain
        }),
      ),
    ).toBe('step_advance');
  });

  it('completedStepIndices undefined → treated as empty (some remaining) → step_advance', () => {
    const plan = makePlan(1);
    expect(
      routeFromEmployee(
        makeState({
          pendingAssignments: [],
          taskPlan: plan,
          completedStepIndices: undefined as unknown as number[],
        }),
      ),
    ).toBe('step_advance');
  });
});
