import type { PrefabInstanceRow, Zone } from '@offisim/shared-types';
import { type MutableRefObject, useCallback, useEffect, useRef } from 'react';
import { SeatRegistry } from '../seat-registry';

export interface CeremonySceneStateDeps {
  prefabInstances?: readonly PrefabInstanceRow[];
  zones: readonly Zone[];
}

export interface CeremonySceneState {
  assignedWorkPositionsRef: MutableRefObject<Map<string, [number, number, number]>>;
  assignedWorkApproachPositionsRef: MutableRefObject<Map<string, [number, number, number]>>;
  assignedWorkZoneIdsRef: MutableRefObject<Map<string, string>>;
  approvalHoldPositionsRef: MutableRefObject<Map<string, [number, number, number]>>;
  clarificationHoldPositionsRef: MutableRefObject<Map<string, [number, number, number]>>;
  registryRef: MutableRefObject<SeatRegistry | null>;
  clearAssignedSceneState: () => void;
}

export function useCeremonySceneState({
  prefabInstances,
  zones,
}: CeremonySceneStateDeps): CeremonySceneState {
  const registryRef = useRef<SeatRegistry | null>(null);
  const assignedWorkPositionsRef = useRef<Map<string, [number, number, number]>>(new Map());
  const assignedWorkApproachPositionsRef = useRef<Map<string, [number, number, number]>>(new Map());
  const assignedWorkZoneIdsRef = useRef<Map<string, string>>(new Map());
  const approvalHoldPositionsRef = useRef<Map<string, [number, number, number]>>(new Map());
  const clarificationHoldPositionsRef = useRef<Map<string, [number, number, number]>>(new Map());

  useEffect(() => {
    registryRef.current = SeatRegistry.build(prefabInstances ?? [], zones);
  }, [prefabInstances, zones]);

  const clearAssignedSceneState = useCallback(() => {
    assignedWorkPositionsRef.current.clear();
    assignedWorkApproachPositionsRef.current.clear();
    assignedWorkZoneIdsRef.current.clear();
    approvalHoldPositionsRef.current.clear();
    clarificationHoldPositionsRef.current.clear();
  }, []);

  return {
    assignedWorkPositionsRef,
    assignedWorkApproachPositionsRef,
    assignedWorkZoneIdsRef,
    approvalHoldPositionsRef,
    clarificationHoldPositionsRef,
    registryRef,
    clearAssignedSceneState,
  };
}
