import type {
  InteractionRequest,
  InteractionResolvedPayload,
  ToolExecutionTelemetryPayload,
} from '@offisim/shared-types';
import { categorizeTool } from './tool-category';

export function describeWorkingToolActivity(
  payload: Pick<ToolExecutionTelemetryPayload, 'toolName' | 'serverName' | 'status' | 'errorType'>,
): string | null {
  const category = categorizeTool(payload);
  if (payload.status === 'started') {
    switch (category) {
      case 'search':
        return 'Searching code...';
      case 'read':
        return 'Reading files...';
      case 'edit':
        return 'Editing workspace...';
      case 'shell':
        return 'Running shell task...';
      default:
        return 'Using tools...';
    }
  }
  if (payload.status === 'completed') {
    switch (category) {
      case 'search':
        return 'Search complete';
      case 'read':
        return 'Files reviewed';
      case 'edit':
        return 'Edits applied';
      case 'shell':
        return 'Shell task complete';
      default:
        return 'Tool step complete';
    }
  }
  if (payload.status === 'denied') {
    return payload.errorType === 'TOOL_PERMISSION_REQUIRED'
      ? 'Waiting on approval...'
      : 'Tool access blocked';
  }
  if (payload.status === 'error') {
    return 'Tool step failed';
  }
  return null;
}

export function describeInteractionSceneRequest(
  request: Pick<InteractionRequest, 'kind'>,
  restored = false,
): string {
  switch (request.kind) {
    case 'permission_request':
      return restored ? 'Approval wait restored' : 'Waiting for approval...';
    case 'plan_review':
      return restored ? 'Plan review restored' : 'Waiting for plan review...';
    case 'agent_question':
      return restored ? 'Clarification restored' : 'Waiting for clarification...';
  }
}

export function describeInteractionSceneResolution(payload: {
  request: Pick<InteractionRequest, 'kind'>;
  response: Pick<InteractionResolvedPayload['response'], 'selectedOptionId'>;
}): string {
  const { request, response } = payload;
  if (request.kind === 'permission_request') {
    return response.selectedOptionId.startsWith('approve')
      ? 'Approval received'
      : 'Approval denied';
  }
  if (request.kind === 'plan_review') {
    return response.selectedOptionId === 'revise_plan' ? 'Revising the plan...' : 'Plan approved';
  }
  return 'Clarification received';
}

export function describeEmployeeEscalation(
  employeeName: string,
  state: 'blocked' | 'failed',
): string {
  return state === 'failed' ? `${employeeName} hit a failure` : `${employeeName} is blocked`;
}
