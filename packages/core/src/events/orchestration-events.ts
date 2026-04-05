/**
 * Orchestration event factories — meeting, graph node, and plan lifecycle events.
 */
import type {
  ExecutionResumedPayload,
  GraphNodeEnteredPayload,
  GraphNodeExitedPayload,
  MeetingActionCreatedPayload,
  MeetingState,
  MeetingStatePayload,
  PlanCompletedPayload,
  PlanCreatedPayload,
  PlanStepCompletedPayload,
  PlanStepStartedPayload,
  RuntimeEvent,
  WorkspaceStalenessDetectedPayload,
} from '@offisim/shared-types';

export function meetingStateChanged(
  companyId: string,
  meetingId: string,
  prev: MeetingState,
  next: MeetingState,
  participantIds: string[],
  threadId?: string,
): RuntimeEvent<MeetingStatePayload> {
  return {
    type: 'meeting.state.changed',
    entityId: meetingId,
    entityType: 'meeting',
    companyId,
    threadId,
    timestamp: Date.now(),
    payload: { meetingId, prev, next, participantIds },
  };
}

export function meetingActionCreated(
  companyId: string,
  meetingId: string,
  actionItemId: string,
  description: string,
  assigneeEmployeeId: string,
  priority: MeetingActionCreatedPayload['priority'],
  dependsOn: string[],
): RuntimeEvent<MeetingActionCreatedPayload> {
  return {
    type: 'meeting.action.created',
    entityId: actionItemId,
    entityType: 'task',
    companyId,
    timestamp: Date.now(),
    payload: { meetingId, actionItemId, description, assigneeEmployeeId, priority, dependsOn },
  };
}

export function graphNodeEntered(
  companyId: string,
  threadId: string,
  nodeName: string,
): RuntimeEvent<GraphNodeEnteredPayload> {
  return {
    type: 'graph.node.entered',
    entityId: nodeName,
    entityType: 'graph',
    companyId,
    threadId,
    timestamp: Date.now(),
    payload: { nodeName },
  };
}

export function graphNodeExited(
  companyId: string,
  threadId: string,
  nodeName: string,
): RuntimeEvent<GraphNodeExitedPayload> {
  return {
    type: 'graph.node.exited',
    entityId: nodeName,
    entityType: 'graph',
    companyId,
    threadId,
    timestamp: Date.now(),
    payload: { nodeName },
  };
}

export function planCreated(
  companyId: string,
  planId: string,
  threadId: string,
  summary: string,
  steps: PlanCreatedPayload['steps'],
  sopTemplateId?: string,
): RuntimeEvent<PlanCreatedPayload> {
  return {
    type: 'plan.created',
    entityId: planId,
    entityType: 'plan',
    companyId,
    threadId,
    timestamp: Date.now(),
    payload: { planId, threadId, summary, steps, sopTemplateId },
  };
}

export function planStepStarted(
  companyId: string,
  planId: string,
  stepIndex: number,
  taskCount: number,
  threadId?: string,
): RuntimeEvent<PlanStepStartedPayload> {
  return {
    type: 'plan.step.started',
    entityId: planId,
    entityType: 'plan',
    companyId,
    threadId,
    timestamp: Date.now(),
    payload: { planId, stepIndex, taskCount },
  };
}

export function planStepCompleted(
  companyId: string,
  planId: string,
  stepIndex: number,
  outputCount: number,
  threadId?: string,
): RuntimeEvent<PlanStepCompletedPayload> {
  return {
    type: 'plan.step.completed',
    entityId: planId,
    entityType: 'plan',
    companyId,
    threadId,
    timestamp: Date.now(),
    payload: { planId, stepIndex, outputCount },
  };
}

export function planCompleted(
  companyId: string,
  planId: string,
  totalSteps: number,
  threadId?: string,
): RuntimeEvent<PlanCompletedPayload> {
  return {
    type: 'plan.completed',
    entityId: planId,
    entityType: 'plan',
    companyId,
    threadId,
    timestamp: Date.now(),
    payload: { planId, totalSteps },
  };
}

export function workspaceStalenessDetected(
  companyId: string,
  threadId: string,
  payload: WorkspaceStalenessDetectedPayload,
): RuntimeEvent<WorkspaceStalenessDetectedPayload> {
  return {
    type: 'workspace.staleness.detected',
    entityId: threadId,
    entityType: 'runtime',
    companyId,
    threadId,
    timestamp: Date.now(),
    payload,
  };
}

export function executionResumed(
  companyId: string,
  threadId: string,
  payload: ExecutionResumedPayload,
): RuntimeEvent<ExecutionResumedPayload> {
  return {
    type: 'execution.resumed',
    entityId: threadId,
    entityType: 'runtime',
    companyId,
    threadId,
    timestamp: Date.now(),
    payload,
  };
}
