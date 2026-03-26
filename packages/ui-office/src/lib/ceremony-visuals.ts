/** Shared ceremony phase → visual mapping. Used by MeetingBubble3D and MeetingBubble2D. */

import type { CeremonyPhase } from '../hooks/useSceneOrchestrator';

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
