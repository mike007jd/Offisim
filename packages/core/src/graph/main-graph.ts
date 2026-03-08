import { StateGraph, END } from '@langchain/langgraph';
import type { BaseCheckpointSaver } from '@langchain/langgraph';
import { AicsGraphAnnotation, type AicsGraphState } from './state.js';
import { createMemoryCheckpointSaver } from './checkpoint-saver.js';
import { bossNode } from '../agents/boss-node.js';
import { managerNode } from '../agents/manager-node.js';
import { employeeNode } from '../agents/employee-node.js';
import { errorHandlerNode } from '../agents/error-handler-node.js';
import { bossSummaryNode } from '../agents/boss-summary-node.js';

function routeFromBoss(state: AicsGraphState): string {
  if (state.interruptReason) return 'error_handler';
  switch (state.routeDecision) {
    case 'delegate_manager':
      return 'manager';
    case 'direct_reply':
      return 'boss_summary';
    case 'start_meeting':
      return 'boss_summary'; // Will route to meeting subgraph when integrated
    default:
      return 'manager';
  }
}

function routeFromEmployee(state: AicsGraphState): string {
  if (state.interruptReason) return 'error_handler';
  if (state.pendingAssignments.length > 0) {
    return 'employee'; // Loop back for next assignment
  }
  return 'boss_summary';
}

export interface BuildGraphOptions {
  checkpointer?: BaseCheckpointSaver;
}

/**
 * Build and compile the AICS main StateGraph.
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
    .addNode('employee', (state, config) => employeeNode(state, config))
    .addNode('error_handler', (state, config) => errorHandlerNode(state, config))
    .addNode('boss_summary', (state, config) => bossSummaryNode(state, config))
    .addEdge('__start__', 'boss')
    .addConditionalEdges('boss', routeFromBoss, ['manager', 'boss_summary', 'error_handler'])
    .addEdge('manager', 'employee')
    .addConditionalEdges('employee', routeFromEmployee, ['employee', 'boss_summary', 'error_handler'])
    .addEdge('error_handler', 'boss_summary')
    .addEdge('boss_summary', END);

  return graph.compile({
    checkpointer,
  });
}
