import type { Zone } from '@offisim/shared-types';
import type { MutableRefObject } from 'react';
import type { CeremonyState } from '../../hooks/useCeremonyState';
import type { SceneIntentBus } from '../../runtime/scene-intents';
import type { AgentState } from '../../runtime/use-agent-states';
import type { SeatRegistry } from '../seat-registry';

export interface CeremonyEventBus {
  on: <TPayload = unknown>(
    prefix: string,
    handler: (e: import('@offisim/shared-types').RuntimeEvent<TPayload>) => void,
  ) => () => void;
}

export interface CeremonyHandlerContext {
  sceneIntentBus?: SceneIntentBus;
  companyIdRef: MutableRefObject<string>;
  agentsRef: MutableRefObject<Map<string, AgentState>>;
  zonesRef: MutableRefObject<readonly Zone[]>;
  ceremonyVersionRef: MutableRefObject<number>;
  registryRef: MutableRefObject<SeatRegistry | null>;
  assignedWorkPositionsRef: MutableRefObject<Map<string, [number, number, number]>>;
  assignedWorkApproachPositionsRef: MutableRefObject<Map<string, [number, number, number]>>;
  assignedWorkZoneIdsRef: MutableRefObject<Map<string, string>>;
  approvalHoldPositionsRef: MutableRefObject<Map<string, [number, number, number]>>;
  clarificationHoldPositionsRef: MutableRefObject<Map<string, [number, number, number]>>;
  hasActivePlanRef: MutableRefObject<boolean>;
  lastLlmChunkRef: MutableRefObject<string>;
  timerRefs: MutableRefObject<Set<ReturnType<typeof setTimeout>>>;
  setCeremony: React.Dispatch<React.SetStateAction<CeremonyState>>;
  safeTimeout: (fn: () => void, ms: number) => ReturnType<typeof setTimeout>;
  clearSceneBubbleText: (label: string, delayMs: number) => void;
  scheduleCeremonyReset: (version: number, delayMs: number) => void;
  clearAssignedSceneState: () => void;
  gatherAll: (version: number) => void;
  dispatchEmployee: (employeeId: string, role: string, version: number) => void;
  startEndCeremony: (summaryText: string, version: number) => void;
}
