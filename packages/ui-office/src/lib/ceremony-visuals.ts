/** Shared ceremony phase → visual mapping. Used by MeetingBubble3D and MeetingBubble2D. */

import type { InteractionKind } from '@offisim/shared-types';
import type { CeremonyPhase } from '../hooks/useSceneOrchestrator';
import type { WaitingRelationship } from '../hooks/useSceneOrchestrator';

export function getPhaseIcon(phase: CeremonyPhase): string {
  switch (phase) {
    case 'gathering':
      return '📍';
    case 'analyzing':
      return '🔍';
    case 'planning':
      return '📋';
    case 'dispatching':
      return '→';
    case 'working':
      return '⚙️';
    case 'reporting':
      return '📊';
    case 'dismissing':
      return '👋';
    default:
      return '';
  }
}

export function getPhaseColor(phase: CeremonyPhase): string {
  switch (phase) {
    case 'gathering':
      return '#f59e0b';
    case 'analyzing':
      return '#818cf8';
    case 'planning':
      return '#3b82f6';
    case 'dispatching':
      return '#22c55e';
    case 'working':
      return '#10b981';
    case 'reporting':
      return '#06b6d4';
    case 'dismissing':
      return '#94a3b8';
    default:
      return '#64748b';
  }
}

export function getInteractionKindLabel(kind: InteractionKind | 'handoff'): string {
  switch (kind) {
    case 'permission_request':
      return '等待审批';
    case 'plan_review':
      return '等待审阅';
    case 'agent_question':
      return '等待澄清';
    case 'handoff':
      return '等待交接';
  }
}

export function describeWaitingRelationship(
  rel: WaitingRelationship,
  employeeNames: ReadonlyMap<string, string>,
): string {
  if (rel.kind === 'handoff' && rel.waitingFor !== 'user') {
    const fromName = rel.waitingForName ?? employeeNames.get(rel.waitingFor) ?? 'teammate';
    return `${rel.waiterName} → 等待 ${fromName}`;
  }
  return `${rel.waiterName} → ${getInteractionKindLabel(rel.kind)}`;
}

export function addWaitingRelationship(
  prev: readonly WaitingRelationship[],
  rel: WaitingRelationship,
): WaitingRelationship[] {
  return [...prev.filter((existing) => existing.waiterId !== rel.waiterId), rel];
}

export function removeWaitingRelationship(
  prev: readonly WaitingRelationship[],
  waiterId: string,
): WaitingRelationship[] {
  return prev.filter((existing) => existing.waiterId !== waiterId);
}
