import {
  type TaskWorkspaceBindingClaim,
  type TaskWorkspaceBindingProjection,
  parseTaskWorkspaceBindingProjection,
} from '@/lib/tauri-commands.js';
import type { WorkspaceUnavailableEvent } from './pi-runtime-driver.js';
import type {
  CompetitiveDraftContext,
  DesktopAgentRunInput,
  WorkspaceRequirement,
} from './desktop-agent-runtime.js';

export function projectWorkspaceBinding(
  claim: TaskWorkspaceBindingClaim,
): TaskWorkspaceBindingProjection {
  const projection = parseTaskWorkspaceBindingProjection(claim);
  if (!projection) throw new Error('Backend returned an invalid workspace binding projection.');
  return projection;
}

export function bindingMatchesRun(
  claim: TaskWorkspaceBindingClaim,
  expected: {
    companyId: string;
    projectId: string;
    threadId: string;
    turnId: string;
    requestId: string;
    access: 'read' | 'write';
  },
): boolean {
  return (
    parseTaskWorkspaceBindingProjection(claim) !== null &&
    typeof claim.workspaceRef === 'string' &&
    claim.workspaceRef.trim().length > 0 &&
    claim.historyId.trim().length > 0 &&
    claim.companyId === expected.companyId &&
    claim.projectId === expected.projectId &&
    claim.threadId === expected.threadId &&
    claim.turnId === expected.turnId &&
    claim.requestId === expected.requestId &&
    claim.access === expected.access
  );
}

export function isSameWorkspaceBindingClaim(
  first: TaskWorkspaceBindingClaim,
  next: TaskWorkspaceBindingClaim,
): boolean {
  return (
    first.workspaceRef === next.workspaceRef &&
    first.historyId === next.historyId &&
    first.companyId === next.companyId &&
    first.projectId === next.projectId &&
    first.threadId === next.threadId &&
    first.turnId === next.turnId &&
    first.requestId === next.requestId &&
    first.access === next.access
  );
}

export function workspaceUnavailableMatchesRun(
  event: WorkspaceUnavailableEvent,
  expected: {
    projectId: string;
    threadId: string;
    turnId: string;
    requestId: string;
  },
): boolean {
  return (
    event.projectId === expected.projectId &&
    event.threadId === expected.threadId &&
    event.turnId === expected.turnId &&
    event.requestId === expected.requestId &&
    event.source === 'workspace_recovery' &&
    (event.reasonCode === 'none' || event.reasonCode === 'ambiguous')
  );
}

export function isSameWorkspaceUnavailable(
  first: WorkspaceUnavailableEvent,
  next: WorkspaceUnavailableEvent,
): boolean {
  return (
    first.projectId === next.projectId &&
    first.threadId === next.threadId &&
    first.turnId === next.turnId &&
    first.requestId === next.requestId &&
    first.source === next.source &&
    first.reasonCode === next.reasonCode
  );
}

export function resolveWorkspaceRequirement(
  input: DesktopAgentRunInput,
  commandName: 'agent_runtime_execute' | 'agent_runtime_resume',
): WorkspaceRequirement {
  if (
    commandName === 'agent_runtime_resume' ||
    input.missionId?.trim() ||
    input.missionContextJson?.trim() ||
    input.directDelegation ||
    input.competitiveDraft
  ) {
    return 'required';
  }
  return input.workspaceRequirement === 'required' ? 'required' : 'optional';
}

export function validateCompetitiveDraftContext(
  input: DesktopAgentRunInput,
): CompetitiveDraftContext | undefined {
  const context = input.competitiveDraft;
  if (!context) return undefined;
  if (!context.groupId.trim() || !context.sourceRunId.trim() || !context.attemptId.trim()) {
    throw new Error('Competitive draft requires durable group, attempt, and source run ids.');
  }
  if (
    !Number.isInteger(context.attemptIndex) ||
    !Number.isInteger(context.totalAttempts) ||
    context.totalAttempts < 2 ||
    context.totalAttempts > 4 ||
    context.attemptIndex < 1 ||
    context.attemptIndex > context.totalAttempts
  ) {
    throw new Error('Competitive draft attempt index must address a group of 2 to 4 attempts.');
  }
  if (!input.runId?.trim() || !input.employeeId?.trim()) {
    throw new Error('Competitive draft requires an explicit attempt run and employee.');
  }
  if (input.directDelegation) {
    throw new Error('Competitive draft owns delegation routing for this run.');
  }
  return context;
}
