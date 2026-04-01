/**
 * Operational event factories — error handling, handoffs, memory,
 * rack/slot management, HR assessments, and notifications.
 * Extracted from event-factories.ts for domain separation.
 */
import type {
  ErrorOccurredPayload,
  HandoffCompletedPayload,
  HandoffInitiatedPayload,
  HrAssessmentCompletedPayload,
  HrAssessmentStartedPayload,
  HrRecommendationPayload,
  InteractionModeChangedPayload,
  InteractionRequestedPayload,
  InteractionResolvedPayload,
  MemoryCreatedPayload,
  NotificationDismissedPayload,
  NotificationPayload,
  RackBoundPayload,
  RackUnboundPayload,
  RuntimeEvent,
  SlotAssignedPayload,
  SlotRemovedPayload,
} from '@offisim/shared-types';
import type {
  InteractionMode,
  InteractionRequest,
  InteractionResponse,
} from '@offisim/shared-types';

export function errorOccurred(
  companyId: string,
  errorCode: string,
  message: string,
  recoverable: boolean,
  nodeName: string,
  opts?: {
    employeeId?: string;
    taskRunId?: string;
    provider?: string;
    model?: string;
    threadId?: string;
  },
): RuntimeEvent<ErrorOccurredPayload> {
  return {
    type: 'error.occurred',
    entityId: opts?.employeeId ?? nodeName,
    entityType: 'employee',
    companyId,
    threadId: opts?.threadId,
    timestamp: Date.now(),
    payload: {
      errorCode,
      message,
      recoverable,
      nodeName,
      employeeId: opts?.employeeId,
      taskRunId: opts?.taskRunId,
      provider: opts?.provider,
      model: opts?.model,
    },
  };
}

export function handoffInitiated(
  companyId: string,
  handoffId: string,
  threadId: string,
  fromEmployeeId: string,
  toEmployeeId: string,
  reason: string,
  taskRunId: string,
): RuntimeEvent<HandoffInitiatedPayload> {
  return {
    type: 'handoff.initiated',
    entityId: handoffId,
    entityType: 'employee',
    companyId,
    threadId,
    timestamp: Date.now(),
    payload: { handoffId, threadId, fromEmployeeId, toEmployeeId, reason, taskRunId },
  };
}

export function handoffCompleted(
  companyId: string,
  handoffId: string,
  toEmployeeId: string,
  taskRunId: string,
  threadId: string,
): RuntimeEvent<HandoffCompletedPayload> {
  return {
    type: 'handoff.completed',
    entityId: handoffId,
    entityType: 'employee',
    companyId,
    threadId,
    timestamp: Date.now(),
    payload: { handoffId, toEmployeeId, taskRunId },
  };
}

export function memoryCreated(
  companyId: string,
  memoryId: string,
  employeeId: string,
  scope: MemoryCreatedPayload['scope'],
  category: MemoryCreatedPayload['category'],
  contentPreview: string,
  threadId: string,
): RuntimeEvent<MemoryCreatedPayload> {
  return {
    type: 'memory.created',
    entityId: memoryId,
    entityType: 'employee',
    companyId,
    threadId,
    timestamp: Date.now(),
    payload: { memoryId, employeeId, scope, category, contentPreview },
  };
}

export function rackBound(
  companyId: string,
  rackId: string,
  providerType: string,
  label: string,
): RuntimeEvent<RackBoundPayload> {
  return {
    type: 'rack.bound',
    entityId: rackId,
    entityType: 'company',
    companyId,
    timestamp: Date.now(),
    payload: { rackId, providerType, label },
  };
}

export function rackUnbound(companyId: string, rackId: string): RuntimeEvent<RackUnboundPayload> {
  return {
    type: 'rack.unbound',
    entityId: rackId,
    entityType: 'company',
    companyId,
    timestamp: Date.now(),
    payload: { rackId },
  };
}

export function slotAssigned(
  companyId: string,
  slotId: string,
  rackId: string,
  capabilityName: string,
  exposureScope: string,
): RuntimeEvent<SlotAssignedPayload> {
  return {
    type: 'slot.assigned',
    entityId: slotId,
    entityType: 'company',
    companyId,
    timestamp: Date.now(),
    payload: { slotId, rackId, capabilityName, exposureScope },
  };
}

export function slotRemoved(
  companyId: string,
  slotId: string,
  rackId: string,
): RuntimeEvent<SlotRemovedPayload> {
  return {
    type: 'slot.removed',
    entityId: slotId,
    entityType: 'company',
    companyId,
    timestamp: Date.now(),
    payload: { slotId, rackId },
  };
}

export function hrAssessmentStarted(
  companyId: string,
  action: 'hire' | 'assess_team',
  threadId: string,
): RuntimeEvent<HrAssessmentStartedPayload> {
  return {
    type: 'hr.assessment.started',
    entityId: companyId,
    entityType: 'company',
    companyId,
    threadId,
    timestamp: Date.now(),
    payload: { action, threadId },
  };
}

export function hrAssessmentCompleted(
  companyId: string,
  action: 'hire' | 'assess_team',
  assessment: string,
  threadId: string,
): RuntimeEvent<HrAssessmentCompletedPayload> {
  return {
    type: 'hr.assessment.completed',
    entityId: companyId,
    entityType: 'company',
    companyId,
    threadId,
    timestamp: Date.now(),
    payload: { action, assessment, threadId },
  };
}

export function hrRecommendation(
  companyId: string,
  recommendation: string,
  suggestedRoles: string[],
  threadId: string,
): RuntimeEvent<HrRecommendationPayload> {
  return {
    type: 'hr.recommendation',
    entityId: companyId,
    entityType: 'company',
    companyId,
    threadId,
    timestamp: Date.now(),
    payload: { recommendation, suggestedRoles, threadId },
  };
}

export function notificationCreated(
  companyId: string,
  notificationId: string,
  level: NotificationPayload['level'],
  title: string,
  message: string,
  source: NotificationPayload['source'],
  opts?: {
    actionUrl?: string;
    employeeId?: string;
    dismissable?: boolean;
  },
): RuntimeEvent<NotificationPayload> {
  const now = Date.now();
  return {
    type: 'notification.created',
    entityId: notificationId,
    entityType: 'company',
    companyId,
    timestamp: now,
    payload: {
      notificationId,
      level,
      title,
      message,
      source,
      actionUrl: opts?.actionUrl,
      employeeId: opts?.employeeId,
      dismissable: opts?.dismissable ?? true,
      timestamp: now,
    },
  };
}

export function notificationDismissed(
  companyId: string,
  notificationId: string,
): RuntimeEvent<NotificationDismissedPayload> {
  return {
    type: 'notification.dismissed',
    entityId: notificationId,
    entityType: 'company',
    companyId,
    timestamp: Date.now(),
    payload: { notificationId },
  };
}

export function interactionRequested(
  companyId: string,
  threadId: string,
  request: InteractionRequest,
): RuntimeEvent<InteractionRequestedPayload> {
  return {
    type: 'interaction.requested',
    entityId: request.interactionId,
    entityType: 'runtime',
    companyId,
    threadId,
    timestamp: Date.now(),
    payload: { request },
  };
}

export function interactionResolved(
  companyId: string,
  threadId: string,
  request: InteractionRequest,
  response: InteractionResponse,
): RuntimeEvent<InteractionResolvedPayload> {
  return {
    type: 'interaction.resolved',
    entityId: request.interactionId,
    entityType: 'runtime',
    companyId,
    threadId,
    timestamp: Date.now(),
    payload: { request, response },
  };
}

export function interactionModeChanged(
  companyId: string,
  threadId: string,
  previousMode: InteractionMode,
  nextMode: InteractionMode,
): RuntimeEvent<InteractionModeChangedPayload> {
  return {
    type: 'interaction.mode.changed',
    entityId: threadId,
    entityType: 'runtime',
    companyId,
    threadId,
    timestamp: Date.now(),
    payload: { previousMode, nextMode },
  };
}
