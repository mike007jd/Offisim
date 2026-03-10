import { StateGraph, END } from '@langchain/langgraph';
import type { BaseCheckpointSaver } from '@langchain/langgraph';
import type { RunnableConfig } from '@langchain/core/runnables';
import { AicsGraphAnnotation, type AicsGraphState, type StepResult } from './state.js';
import { createMemoryCheckpointSaver } from './checkpoint-saver.js';
import { bossNode } from '../agents/boss-node.js';
import { managerNode } from '../agents/manager-node.js';
import { pmPlannerNode } from '../agents/pm-planner-node.js';
import { stepDispatcherNode } from '../agents/step-dispatcher-node.js';
import { employeeNode } from '../agents/employee-node.js';
import { errorHandlerNode } from '../agents/error-handler-node.js';
import { bossSummaryNode } from '../agents/boss-summary-node.js';
import { graphNodeEntered, planStepCompleted } from '../events/event-factories.js';
import type { RuntimeContext } from '../runtime/runtime-context.js';
import {
  meetingStartNode,
  participantTurnNode,
  meetingTurnCheck,
  meetingEndNode,
} from './meeting-subgraph.js';

function routeFromBoss(state: AicsGraphState): string {
  if (state.interruptReason) return 'error_handler';
  switch (state.routeDecision) {
    case 'delegate_manager':
      return 'manager';
    case 'direct_reply':
      return 'boss_summary';
    case 'start_meeting':
      return 'meeting_start';
    default:
      return 'manager';
  }
}

function routeFromPm(state: AicsGraphState): string {
  if (!state.taskPlan || state.taskPlan.steps.length === 0) {
    return 'boss_summary';
  }
  return 'step_dispatcher';
}

function routeFromEmployee(state: AicsGraphState): string {
  if (state.interruptReason) return 'error_handler';

  // Still have pending assignments in this step — loop back
  if (state.pendingAssignments.length > 0) {
    return 'employee';
  }

  // All assignments for current step are done.
  // Check if there are more steps in the plan.
  if (state.taskPlan && state.currentStepIndex < state.taskPlan.steps.length - 1) {
    return 'step_advance';
  }

  return 'boss_summary';
}

/**
 * Step advance — inline node that:
 * 1. Saves current step outputs to stepResults
 * 2. Increments currentStepIndex
 * 3. Clears currentStepOutputs
 * 4. Emits planStepCompleted event
 */
async function stepAdvanceNode(
  state: AicsGraphState,
  config: RunnableConfig,
): Promise<Partial<AicsGraphState>> {
  const runtimeCtx = (config.configurable as { runtimeCtx?: RuntimeContext }).runtimeCtx;

  if (runtimeCtx) {
    runtimeCtx.eventBus.emit(
      graphNodeEntered(runtimeCtx.companyId, state.threadId, 'step_advance'),
    );
  }

  const currentStepResult: StepResult = {
    stepIndex: state.currentStepIndex,
    outputs: [...state.currentStepOutputs],
  };

  const newStepResults = [...state.stepResults, currentStepResult];
  const newStepIndex = state.currentStepIndex + 1;

  // Emit planStepCompleted for the step we just finished
  if (runtimeCtx && state.taskPlan) {
    runtimeCtx.eventBus.emit(
      planStepCompleted(
        runtimeCtx.companyId,
        state.taskPlan.planId,
        state.currentStepIndex,
        state.currentStepOutputs.length,
        state.threadId,
      ),
    );
  }

  return {
    stepResults: newStepResults,
    currentStepIndex: newStepIndex,
    currentStepOutputs: [],
  };
}

export interface BuildGraphOptions {
  checkpointer?: BaseCheckpointSaver;
}

/**
 * Build and compile the AICS main StateGraph.
 *
 * Flow: Boss → Manager → PM Planner → Step Dispatcher → Employee (loop)
 *       → Step Advance (loop) → Boss Summary
 *
 * The `runtimeCtx` is NOT baked into the graph. Callers pass it via
 * `config.configurable.runtimeCtx` at invoke time, so the same
 * compiled graph can serve multiple threads/companies.
 */
export function buildAicsGraph(options?: BuildGraphOptions) {
  const checkpointer = options?.checkpointer ?? createMemoryCheckpointSaver();

  const graph = new StateGraph(AicsGraphAnnotation)
    .addNode('boss', (state, config) => bossNode(state, config))
    .addNode('manager', (state, config) => managerNode(state, config))
    .addNode('pm_planner', (state, config) => pmPlannerNode(state, config))
    .addNode('step_dispatcher', (state, config) => stepDispatcherNode(state, config))
    .addNode('employee', (state, config) => employeeNode(state, config))
    .addNode('step_advance', (state, config) => stepAdvanceNode(state, config))
    .addNode('error_handler', (state, config) => errorHandlerNode(state, config))
    .addNode('boss_summary', (state, config) => bossSummaryNode(state, config))
    .addNode('meeting_start', (state, config) => meetingStartNode(state, config))
    .addNode('participant_turn', (state, config) => participantTurnNode(state, config))
    .addNode('meeting_end', (state, config) => meetingEndNode(state, config))
    .addEdge('__start__', 'boss')
    .addConditionalEdges('boss', routeFromBoss, ['manager', 'boss_summary', 'error_handler', 'meeting_start'])
    .addEdge('manager', 'pm_planner')
    .addConditionalEdges('pm_planner', routeFromPm, ['step_dispatcher', 'boss_summary'])
    .addEdge('step_dispatcher', 'employee')
    .addConditionalEdges('employee', routeFromEmployee, ['employee', 'step_advance', 'boss_summary', 'error_handler'])
    .addEdge('step_advance', 'step_dispatcher')
    .addEdge('meeting_start', 'participant_turn')
    .addConditionalEdges('participant_turn', meetingTurnCheck, ['participant_turn', 'meeting_end'])
    .addEdge('meeting_end', 'boss_summary')
    .addEdge('error_handler', 'boss_summary')
    .addEdge('boss_summary', END);

  return graph.compile({
    checkpointer,
  });
}
