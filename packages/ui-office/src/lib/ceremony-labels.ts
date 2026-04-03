import type { CeremonyPhase } from '../hooks/useSceneOrchestrator';
import { getPhaseColor } from './ceremony-visuals';

export const CEREMONY_LABELS: Record<CeremonyPhase, { label: string; color: string } | null> = {
  idle: null,
  gathering: { label: 'Team gathering', color: getPhaseColor('gathering') },
  analyzing: { label: 'Boss analyzing', color: getPhaseColor('analyzing') },
  planning: { label: 'PM planning', color: getPhaseColor('planning') },
  dispatching: { label: 'Dispatching tasks', color: getPhaseColor('dispatching') },
  working: { label: 'Employees working', color: getPhaseColor('working') },
  reporting: { label: 'Reporting', color: getPhaseColor('reporting') },
  dismissing: { label: 'Wrapping up', color: getPhaseColor('dismissing') },
};
