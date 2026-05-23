import type { InteractionRequest } from '@offisim/shared-types';
import type { CompanyStartupSource } from '@offisim/shared-types';

export type CeremonyPhase =
  | 'idle'
  | 'gathering' // employees walking to MTG
  | 'analyzing' // manager LLM running
  | 'planning' // PM creating plan
  | 'dispatching' // step_dispatcher assigning
  | 'working' // employees at workstations
  | 'reporting' // boss_summary, employees returning to MTG
  | 'dismissing'; // everyone walking back to rest

export interface WaitingRelationship {
  waiterId: string;
  waiterName: string;
  waitingFor: 'user' | string;
  waitingForName?: string | null;
  kind: InteractionRequest['kind'] | 'handoff';
}

export interface CeremonyState {
  phase: CeremonyPhase;
  /** Text to show in the meeting bubble. */
  bubbleText: string;
  /** Employee IDs participating in current ceremony. */
  participantIds: Set<string>;
  /** Employees dispatched to workstations (won't return to MTG at end). */
  dispatchedIds: Set<string>;
  managerVisible: boolean;
  managerPosition: [number, number, number] | null;
  waitingRelationships: WaitingRelationship[];
  startup: {
    active: boolean;
    startupId: string | null;
    source: CompanyStartupSource | null;
    replay: boolean;
  };
}

export function createIdleCeremonyState(): CeremonyState {
  return {
    phase: 'idle',
    bubbleText: '',
    participantIds: new Set(),
    dispatchedIds: new Set(),
    managerVisible: false,
    managerPosition: null,
    waitingRelationships: [],
    startup: {
      active: false,
      startupId: null,
      source: null,
      replay: false,
    },
  };
}

export const IDLE_CEREMONY: CeremonyState = createIdleCeremonyState();
