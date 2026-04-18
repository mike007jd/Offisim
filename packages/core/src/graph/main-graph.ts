import type { RunnableConfig } from '@langchain/core/runnables';
import { END, StateGraph } from '@langchain/langgraph';
import type { BaseCheckpointSaver } from '@langchain/langgraph';
import { bossNode } from '../agents/boss-node.js';
import { bossSummaryNode } from '../agents/boss-summary-node.js';
import { employeeDirectSetupNode } from '../agents/employee-direct-setup-node.js';
import { employeeNode } from '../agents/employee-node.js';
import { errorHandlerNode } from '../agents/error-handler-node.js';
import { hrNode } from '../agents/hr-node.js';
import { managerNode } from '../agents/manager-node.js';
import { pmHeartbeatNode } from '../agents/pm-heartbeat-node.js';
import { pmPlannerNode } from '../agents/pm-planner-node.js';
import { pmReplanNode } from '../agents/pm-replan-node.js';
import { stepDispatcherNode } from '../agents/step-dispatcher-node.js';
import { graphNodeEntered, planStepCompleted } from '../events/event-factories.js';
import { appendAgentEvent } from '../utils/append-agent-event.js';
import { getRuntime } from '../utils/get-runtime.js';
import { createMemoryCheckpointSaver } from './checkpoint-saver.js';
import {
  meetingEndNode,
  meetingInjectNode,
  meetingPausedNode,
  meetingResumeNode,
  meetingStartNode,
  meetingTurnCheck,
  participantTurnNode,
} from './meeting-subgraph.js';
import { OffisimGraphAnnotation, type OffisimGraphState } from './state.js';

/** Max replans before escalating to user */
const MAX_REPLAN_COUNT = 3;

function withNodeHooks<TResult>(
  nodeName: string,
  handler: (state: OffisimGraphState, config: RunnableConfig) => Promise<TResult> | TResult,
) {
  return async (state: OffisimGraphState, config: RunnableConfig): Promise<TResult> => {
    const runtimeCtx = getRuntime(config, nodeName, { optional: true });
    await runtimeCtx?.hookRegistry.emit('graph.node.before', {
      nodeName,
      threadId: state.threadId,
      companyId: state.companyId,
      entryMode: state.entryMode,
    });
    try {
      const result = await handler(state, config);
      await runtimeCtx?.hookRegistry.emit('graph.node.after', {
        nodeName,
        threadId: state.threadId,
        companyId: state.companyId,
        entryMode: state.entryMode,
      });
      return result;
    } catch (error) {
      await runtimeCtx?.hookRegistry.emit('graph.node.after', {
        nodeName,
        threadId: state.threadId,
        companyId: state.companyId,
        entryMode: state.entryMode,
        error: error instanceof Error ? error.message : String(error),
      });
      throw error;
    }
  };
}

/**
 * Detect if employee outputs signal a need to replan.
 *
 * Uses explicit marker format `[SIGNAL:X]` to avoid false positives from
 * common English words like "blocked" appearing in normal task output.
 * The `REPLAN_NEEDED` literal is also accepted (backward compat).
 */
const REPLAN_SIGNAL_RE = /\[SIGNAL:REPLAN_NEEDED\]|\bREPLAN_NEEDED\b/i;

/** @internal — exported for testing */
export function routeFromStart(state: OffisimGraphState): string {
  if (state.entryMode === 'direct_chat' && state.targetEmployeeId) {
    return 'employee_direct_setup';
  }
  if (state.entryMode === 'meeting' && !state.meetingId) {
    return 'meeting_start';
  }
  // Resume a paused meeting — meetingId present + meetingInterrupt indicates resume/end
  if (state.entryMode === 'meeting' && state.meetingId && state.meetingInterrupt) {
    if (state.meetingInterrupt.type === 'end') {
      return 'meeting_end';
    }
    return 'meeting_resume';
  }
  // Heartbeat — proactive progress check (no-op if nothing changed)
  if (state.entryMode === 'heartbeat') {
    return 'pm_heartbeat';
  }
  // background_sync — periodic or auto-resume runs go through the boss for re-evaluation
  if (state.entryMode === 'background_sync') {
    return 'boss';
  }
  return 'boss';
}

/** @internal — exported for testing */
export function routeFromBoss(state: OffisimGraphState): string {
  if (state.interruptReason) return 'error_handler';
  switch (state.routeDecision) {
    case 'delegate_manager':
      return 'manager';
    case 'direct_reply':
      return 'boss_summary';
    case 'start_meeting':
      return 'meeting_start';
    case 'direct_delegate':
      return 'employee_direct_setup';
    default:
      return 'manager';
  }
}

/** @internal — exported for testing */
export function routeFromManager(state: OffisimGraphState): string {
  // If the manager directive indicates a hiring or team assessment intent, route to HR
  if (
    state.managerDirective?.constraints === 'hire' ||
    state.managerDirective?.constraints === 'assess_team'
  ) {
    return 'hr';
  }
  return 'pm_planner';
}

/** @internal — exported for testing */
export function routeFromPm(state: OffisimGraphState): string {
  if (!state.taskPlan || state.taskPlan.steps.length === 0) {
    return 'boss_summary';
  }
  return 'step_dispatcher';
}

/** @internal — exported for testing */
export function routeFromStepDispatcher(state: OffisimGraphState): string {
  return state.pendingAssignments.length > 0 ? 'employee' : 'step_advance';
}

/** @internal — exported for testing */
export function routeFromEmployee(state: OffisimGraphState): string {
  if (state.interruptReason) return 'error_handler';

  // Still have pending assignments in the queue — loop back to process them.
  if (state.pendingAssignments.length > 0) {
    return 'employee';
  }

  // No pending assignments. Check if all steps are done.
  const plan = state.taskPlan;
  if (!plan) return 'boss_summary';

  const completedCount = (state.completedStepIndices ?? []).length;
  const totalSteps = plan.steps.length;

  // All steps completed → summarise.
  if (completedCount >= totalSteps) {
    return 'boss_summary';
  }

  // Some steps remain — step_advance will record this batch and loop back
  // to step_dispatcher which will find newly unblocked steps.
  return 'step_advance';
}

/**
 * Step advance — inline node that:
 * 1. Marks all dispatched-but-not-yet-completed steps as completed in one batch.
 *    (When employee drains pendingAssignments, ALL dispatched steps' tasks are done.)
 * 2. Saves current step outputs to stepResults — grouped by step via stepIndex tag
 *    on assignment inputJson (falls back to currentStepIndex for legacy plans).
 * 3. Updates completedStepIndices.
 * 4. Clears currentStepOutputs.
 * 5. Emits planStepCompleted for each newly completed step.
 * 6. Updates currentStepIndex for display/backward-compat.
 *
 * After this, step_dispatcher is called and will find newly unblocked steps.
 */
async function stepAdvanceNode(
  state: OffisimGraphState,
  config: RunnableConfig,
): Promise<Partial<OffisimGraphState>> {
  const runtimeCtx = getRuntime(config, 'step_advance', { optional: true });

  if (runtimeCtx) {
    runtimeCtx.eventBus.emit(
      graphNodeEntered(runtimeCtx.companyId, state.threadId, 'step_advance'),
    );
  }

  // Determine which steps were dispatched and are now complete.
  // When pendingAssignments reaches zero, ALL tasks from ALL dispatched steps are done.
  const alreadyCompleted = new Set(state.completedStepIndices ?? []);
  const dispatched = state.dispatchedStepIndices ?? [];
  // Steps dispatched in this batch = dispatched but not yet in completedStepIndices
  const newlyCompletedIndices = dispatched.filter((i) => !alreadyCompleted.has(i));

  // If no dispatched steps to advance (edge case), use currentStepIndex as fallback
  const stepsToComplete =
    newlyCompletedIndices.length > 0 ? newlyCompletedIndices : [state.currentStepIndex];

  // Group currentStepOutputs by step: each assignment.inputJson carries stepIndex.
  // For legacy plans, all outputs belong to currentStepIndex.
  const outputsByStep = new Map<number, typeof state.currentStepOutputs>();
  for (const stepIdx of stepsToComplete) {
    outputsByStep.set(stepIdx, []);
  }
  // Distribute outputs — all go to the batch since they're from the same dispatch round
  // For the single-step case (legacy), all go to stepsToComplete[0].
  if (stepsToComplete.length === 1) {
    const onlyStep = stepsToComplete[0];
    if (onlyStep === undefined) {
      throw new Error('Expected one step to complete when distributing outputs');
    }
    outputsByStep.set(onlyStep, [...state.currentStepOutputs]);
  } else {
    // Multi-step batch: split outputs by looking at task run IDs across the plan
    // For now, assign all outputs to a combined list (outputs are ordered by task completion)
    // Each step gets a proportional slice — or we can store all outputs under the primary step.
    // Simple approach: accumulate all outputs under each completed step (they share context).
    for (const stepIdx of stepsToComplete) {
      outputsByStep.set(stepIdx, [...state.currentStepOutputs]);
    }
  }

  const newStepResults = [...state.stepResults];
  const newCompletedIndices = [...(state.completedStepIndices ?? [])];

  for (const stepIdx of stepsToComplete) {
    const outputs = outputsByStep.get(stepIdx) ?? [];
    newStepResults.push({ stepIndex: stepIdx, outputs });
    newCompletedIndices.push(stepIdx);

    if (runtimeCtx && state.taskPlan) {
      runtimeCtx.eventBus.emit(
        planStepCompleted(
          runtimeCtx.companyId,
          state.taskPlan.planId,
          stepIdx,
          outputs.length,
          state.threadId,
        ),
      );
      await runtimeCtx.hookRegistry.emit('task.completed', {
        threadId: state.threadId,
        companyId: runtimeCtx.companyId,
        stepIndex: stepIdx,
        outputCount: outputs.length,
      });
    }
  }

  // Compute next display index: lowest step not yet completed
  const completedSet = new Set(newCompletedIndices);
  const plan = state.taskPlan;
  const nextPending = plan
    ? plan.steps.map((s) => s.stepIndex).find((i) => !completedSet.has(i))
    : undefined;
  const nextDisplayIndex = nextPending ?? state.currentStepIndex + stepsToComplete.length;

  if (runtimeCtx) {
    await runtimeCtx.repos.threads.updateStatus(state.threadId, 'running');

    // Event sourcing: record step advance
    await appendAgentEvent(runtimeCtx, {
      projectId: state.projectId,
      threadId: state.threadId,
      agentName: 'pm',
      eventType: 'action',
      payload: {
        action: 'step_advance',
        completedSteps: stepsToComplete,
        totalCompleted: newCompletedIndices.length,
      },
    });
  }

  return {
    stepResults: newStepResults,
    currentStepIndex: nextDisplayIndex,
    currentStepOutputs: [],
    completedStepIndices: newCompletedIndices,
  };
}

/**
 * Route from step_advance: either continue to step_dispatcher or trigger re-plan.
 *
 * REPLAN_NEEDED is detected when employee output contains replan signals
 * AND replanCount hasn't exceeded the maximum (prevents infinite loops).
 */
/** @internal — exported for testing */
export function routeFromStepAdvance(state: OffisimGraphState): string {
  // Check if any recent employee output signals a replan need
  const outputs =
    state.currentStepOutputs.length > 0
      ? state.currentStepOutputs
      : (state.stepResults.at(-1)?.outputs ?? []);

  const hasReplanSignal = outputs.some((o) => REPLAN_SIGNAL_RE.test(o.content));

  if (hasReplanSignal && (state.replanCount ?? 0) < MAX_REPLAN_COUNT) {
    return 'pm_replan';
  }

  return 'step_dispatcher';
}

export interface BuildGraphOptions {
  checkpointer?: BaseCheckpointSaver;
}

/**
 * Build and compile the Offisim main StateGraph.
 *
 * Flow: Boss → Manager → PM Planner → Step Dispatcher → Employee (loop)
 *       → Step Advance (loop) → Boss Summary
 *
 * The `runtimeCtx` is NOT baked into the graph. Callers pass it via
 * `config.configurable.runtimeCtx` at invoke time, so the same
 * compiled graph can serve multiple threads/companies.
 */
export function buildOffisimGraph(options?: BuildGraphOptions) {
  const checkpointer = options?.checkpointer ?? createMemoryCheckpointSaver();

  const graph = new StateGraph(OffisimGraphAnnotation)
    .addNode(
      'boss',
      withNodeHooks('boss', (state, config) => bossNode(state, config)),
    )
    .addNode(
      'manager',
      withNodeHooks('manager', (state, config) => managerNode(state, config)),
    )
    .addNode(
      'pm_planner',
      withNodeHooks('pm_planner', (state, config) => pmPlannerNode(state, config)),
    )
    .addNode(
      'step_dispatcher',
      withNodeHooks('step_dispatcher', (state, config) => stepDispatcherNode(state, config)),
    )
    .addNode(
      'employee',
      withNodeHooks('employee', (state: OffisimGraphState, config: RunnableConfig) =>
        employeeNode(state, config),
      ),
      {
        // employee node may return Command (handoff) targeting itself
        ends: ['employee'],
      } as Record<string, unknown>,
    )
    .addNode(
      'step_advance',
      withNodeHooks('step_advance', (state, config) => stepAdvanceNode(state, config)),
    )
    .addNode(
      'employee_direct_setup',
      withNodeHooks('employee_direct_setup', (state, config) =>
        employeeDirectSetupNode(state, config),
      ),
    )
    .addNode(
      'error_handler',
      withNodeHooks('error_handler', (state, config) => errorHandlerNode(state, config)),
    )
    .addNode(
      'hr',
      withNodeHooks('hr', (state, config) => hrNode(state, config)),
    )
    .addNode(
      'pm_heartbeat',
      withNodeHooks('pm_heartbeat', (state, config) => pmHeartbeatNode(state, config)),
    )
    .addNode(
      'pm_replan',
      withNodeHooks('pm_replan', (state, config) => pmReplanNode(state, config)),
    )
    .addNode(
      'boss_summary',
      withNodeHooks('boss_summary', (state, config) => bossSummaryNode(state, config)),
    )
    .addNode(
      'meeting_start',
      withNodeHooks('meeting_start', (state, config) => meetingStartNode(state, config)),
    )
    .addNode(
      'participant_turn',
      withNodeHooks('participant_turn', (state, config) => participantTurnNode(state, config)),
    )
    .addNode(
      'meeting_end',
      withNodeHooks('meeting_end', (state, config) => meetingEndNode(state, config)),
    )
    .addNode(
      'meeting_paused',
      withNodeHooks('meeting_paused', (state, config) => meetingPausedNode(state, config)),
    )
    .addNode(
      'meeting_resume',
      withNodeHooks('meeting_resume', (state, config) => meetingResumeNode(state, config)),
    )
    .addNode(
      'meeting_inject',
      withNodeHooks('meeting_inject', (state, config) => meetingInjectNode(state, config)),
    )
    .addConditionalEdges('__start__', routeFromStart, [
      'boss',
      'employee_direct_setup',
      'meeting_start',
      'meeting_resume',
      'meeting_end',
      'pm_heartbeat',
    ])
    .addConditionalEdges('boss', routeFromBoss, [
      'manager',
      'boss_summary',
      'error_handler',
      'meeting_start',
      'employee_direct_setup',
    ])
    .addConditionalEdges('manager', routeFromManager, ['pm_planner', 'hr'])
    .addConditionalEdges('pm_planner', routeFromPm, ['step_dispatcher', 'boss_summary'])
    .addConditionalEdges('step_dispatcher', routeFromStepDispatcher, ['employee', 'step_advance'])
    .addConditionalEdges('employee', routeFromEmployee, [
      'employee',
      'step_advance',
      'boss_summary',
      'error_handler',
    ])
    .addConditionalEdges('step_advance', routeFromStepAdvance, ['step_dispatcher', 'pm_replan'])
    .addEdge('pm_replan', 'step_dispatcher')
    .addEdge('pm_heartbeat', END)
    .addEdge('employee_direct_setup', 'employee')
    .addEdge('meeting_start', 'participant_turn')
    .addConditionalEdges('participant_turn', meetingTurnCheck, [
      'participant_turn',
      'meeting_end',
      'meeting_paused',
      'meeting_inject',
    ])
    .addEdge('meeting_paused', END)
    .addEdge('meeting_resume', 'participant_turn')
    .addEdge('meeting_inject', 'participant_turn')
    .addEdge('meeting_end', 'boss_summary')
    .addEdge('hr', 'boss_summary')
    .addEdge('error_handler', 'boss_summary')
    .addEdge('boss_summary', END);

  return graph.compile({
    checkpointer,
  });
}
