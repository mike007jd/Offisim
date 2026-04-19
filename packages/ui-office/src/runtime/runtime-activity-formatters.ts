import type {
  InteractionKind,
  ToolExecutionTelemetryPayload,
  WorkspaceStalenessDetectedPayload,
} from '@offisim/shared-types';
import { humanizeNodeName } from '../lib/agent-display';
import { type ToolCategory, categorizeTool } from '../lib/tool-category';

export function truncate(text: string, maxLength: number): string {
  return text.length > maxLength ? `${text.slice(0, maxLength - 1)}…` : text;
}

export function activeToolHeadline(category: ToolCategory): string {
  switch (category) {
    case 'search':
      return 'Searching the codebase';
    case 'read':
      return 'Reading relevant files';
    case 'edit':
      return 'Editing the workspace';
    case 'shell':
      return 'Running shell tasks';
    default:
      return 'Running tools';
  }
}

export function formatLlmDuration(durationMs: number): string {
  if (durationMs < 1000) return '<1s';
  return `${(durationMs / 1000).toFixed(durationMs < 10_000 ? 1 : 0)}s`;
}

export function llmStartedHeadline(nodeName: string, model: string): string {
  return `${humanizeNodeName(nodeName)} is calling ${model}`;
}

export function activeToolGroupLabel(category: ToolCategory, count: number): string {
  const suffix = count > 1 ? ` (${count})` : '';
  switch (category) {
    case 'search':
      return `Searching codebase${suffix}`;
    case 'read':
      return `Reading files${suffix}`;
    case 'edit':
      return `Editing workspace${suffix}`;
    case 'shell':
      return `Shell tasks${suffix}`;
    default:
      return `Live tools${suffix}`;
  }
}

export function toolBurstLabel(
  category: ToolCategory,
  status: ToolExecutionTelemetryPayload['status'],
  count: number,
): string {
  if (status === 'started') {
    switch (category) {
      case 'search':
        return count > 1 ? `Searching codebase with ${count} tools` : 'Started code search';
      case 'read':
        return count > 1 ? `Reading files with ${count} tools` : 'Started reading files';
      case 'edit':
        return count > 1 ? `Editing workspace with ${count} tools` : 'Started editing workspace';
      case 'shell':
        return count > 1 ? `Running ${count} shell tasks` : 'Started shell task';
      default:
        return count > 1 ? `Started ${count} tools` : 'Started tool';
    }
  }

  if (status === 'completed') {
    switch (category) {
      case 'search':
        return count > 1 ? `Searched codebase with ${count} tools` : 'Completed code search';
      case 'read':
        return count > 1 ? `Read files with ${count} tools` : 'Completed file read';
      case 'edit':
        return count > 1 ? `Applied ${count} workspace edits` : 'Completed workspace edit';
      case 'shell':
        return count > 1 ? `Completed ${count} shell tasks` : 'Completed shell task';
      default:
        return count > 1 ? `Completed ${count} tool calls` : 'Completed tool call';
    }
  }

  if (status === 'denied') {
    return count > 1 ? `Blocked ${count} tool requests` : 'Blocked tool request';
  }

  return count > 1 ? `Failed ${count} tool calls` : 'Failed tool call';
}

export function enteredHeadline(nodeName: string): string {
  switch (nodeName) {
    case 'boss':
      return 'Boss is analyzing the request';
    case 'manager':
      return 'Manager is routing work';
    case 'pm_planner':
      return 'PM is building an execution plan';
    case 'pm_replan':
      return 'PM is re-planning around new conditions';
    case 'step_dispatcher':
      return 'Dispatching work to specialists';
    case 'employee':
      return 'Employees are executing the current step';
    case 'boss_summary':
      return 'Boss is drafting the final response';
    case 'hr':
      return 'HR is evaluating the request';
    case 'error_handler':
      return 'Recovery flow is handling a fault';
    default:
      return `${humanizeNodeName(nodeName)} is working`;
  }
}

export function interactionRequestedLabel(kind: InteractionKind): string {
  switch (kind) {
    case 'permission_request':
      return 'Approval needed';
    case 'plan_review':
      return 'Plan review needed';
    case 'agent_question':
      return 'Interrupt & steer';
    case 'skill_install_confirm':
      return 'Skill install preview';
    default:
      return 'Input needed';
  }
}

export function interactionResolvedLabel(
  kind: InteractionKind,
  selectedOptionId: string,
): string {
  const action = selectedOptionId.replaceAll('_', ' ');
  switch (kind) {
    case 'permission_request':
      return `Approval decision: ${action}`;
    case 'plan_review':
      return `Plan review: ${action}`;
    case 'agent_question':
      return `Clarification received: ${action}`;
    case 'skill_install_confirm':
      return selectedOptionId === 'confirm' ? 'Skill install confirmed' : 'Skill install cancelled';
    default:
      return `Decision received: ${action}`;
  }
}

export function interactionRestoredLabel(kind: InteractionKind): string {
  switch (kind) {
    case 'permission_request':
      return 'Approval restored';
    case 'plan_review':
      return 'Plan review restored';
    case 'agent_question':
      return 'Interrupt & steer restored';
    case 'skill_install_confirm':
      return 'Skill install preview restored';
    default:
      return 'Pending input restored';
  }
}

export function telemetryLabel(payload: ToolExecutionTelemetryPayload): string {
  const base = payload.serverName ? `${payload.serverName}/${payload.toolName}` : payload.toolName;
  return truncate(base.replaceAll('_', ' '), 42);
}

export function formatStalenessReason(payload: WorkspaceStalenessDetectedPayload): string {
  switch (payload.reason) {
    case 'git_head_changed':
      return 'Workspace head changed since the last checkpoint';
    case 'git_worktree_changed':
      return `Workspace changed locally${payload.currentStatusLines ? ` (${payload.currentStatusLines} file${payload.currentStatusLines === 1 ? '' : 's'})` : ''}`;
    case 'missing_baseline':
      return 'No workspace baseline is available yet';
    case 'missing_workspace_root':
      return 'Workspace root is unavailable for resume checks';
    case 'not_git_repository':
      return 'Workspace is not a Git repository';
    case 'capture_failed':
      return 'Workspace snapshot could not be captured';
    default:
      return 'Workspace state changed';
  }
}

export function getToolCategory(payload: ToolExecutionTelemetryPayload): ToolCategory {
  return categorizeTool(payload);
}
