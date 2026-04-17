import {
  type RoleSlug,
  UNASSIGNED_ZONE_ID,
  type Zone,
  resolveZoneForRole,
} from '@offisim/shared-types';
import type { MutableRefObject } from 'react';
import {
  computeMtgPositions,
  getObstacleFootprints,
  getWorkstationApproachPos,
  getWorkstationPos,
  getZoneCenter,
  getZoneCenterById,
} from '../../hooks/scene-orchestrator-positions';
import type { CeremonyState } from '../../hooks/useCeremonyState';
import { getMovementHandles } from '../../runtime/movement-handle-registry';
import type { AgentState } from '../../runtime/use-agent-states';
import { getNextSlot, resetSlotCounters } from '../../runtime/zone-slot-counter';
import {
  buildDispatchRoute,
  buildManagerPresenceTarget,
  buildReturnToMeetingRoute,
  moveThroughPoints,
} from '../scene-behavior';
import { buildZoneRouteWaypoints, getMeetingZoneId } from '../scene-nav';
import type { SeatRegistry } from '../seat-registry';
import { moveEmployeeToRest } from './ceremony-movement';

export interface CeremonyPhaseActionsDeps {
  companyIdRef: MutableRefObject<string>;
  agentsRef: MutableRefObject<Map<string, AgentState>>;
  zonesRef: MutableRefObject<readonly Zone[]>;
  ceremonyVersionRef: MutableRefObject<number>;
  registryRef: MutableRefObject<SeatRegistry | null>;
  assignedWorkPositionsRef: MutableRefObject<Map<string, [number, number, number]>>;
  assignedWorkApproachPositionsRef: MutableRefObject<Map<string, [number, number, number]>>;
  assignedWorkZoneIdsRef: MutableRefObject<Map<string, string>>;
  setCeremony: React.Dispatch<React.SetStateAction<CeremonyState>>;
  clearAssignedSceneState: () => void;
  safeTimeout: (fn: () => void, ms: number) => ReturnType<typeof setTimeout>;
  scheduleCeremonyReset: (version: number, delayMs: number) => void;
}

export function createGatherAll(deps: CeremonyPhaseActionsDeps): (version: number) => void {
  const { agentsRef, zonesRef, companyIdRef, setCeremony, clearAssignedSceneState } = deps;
  return (_version: number) => {
    const allIds = [...agentsRef.current.keys()];
    if (allIds.length === 0) return;
    const participantIds = new Set(allIds);
    resetSlotCounters();

    setCeremony({
      phase: 'gathering',
      bubbleText: 'Gathering team...',
      participantIds,
      dispatchedIds: new Set(),
      managerVisible: false,
      managerPosition: null,
      waitingRelationships: [],
    });
    clearAssignedSceneState();

    const mtgCenter = getZoneCenter(zonesRef.current, 'meeting');
    const mtgPositions = computeMtgPositions(mtgCenter, allIds.length);

    allIds.forEach((id, idx) => {
      const handle = getMovementHandles(companyIdRef.current).get(id);
      if (!handle) return;
      const resolvedSeat = mtgPositions[idx] ?? mtgPositions[0] ?? mtgCenter;
      const jittered: [number, number, number] = [
        resolvedSeat[0] + (Math.random() - 0.5) * 0.3,
        0,
        resolvedSeat[2] + (Math.random() - 0.5) * 0.3,
      ];
      handle.moveTo(jittered, 5);
    });
  };
}

export function createDispatchEmployee(
  deps: CeremonyPhaseActionsDeps,
): (employeeId: string, role: string, version: number) => void {
  const {
    companyIdRef,
    zonesRef,
    registryRef,
    assignedWorkPositionsRef,
    assignedWorkApproachPositionsRef,
    assignedWorkZoneIdsRef,
    ceremonyVersionRef,
    safeTimeout,
    setCeremony,
  } = deps;
  return (employeeId, role, version) => {
    const handle = getMovementHandles(companyIdRef.current).get(employeeId);
    if (!handle) return;

    const resolvedZone = resolveZoneForRole(role as RoleSlug, zonesRef.current);
    const zoneId = resolvedZone?.zoneId ?? UNASSIGNED_ZONE_ID;
    const slot = getNextSlot(zoneId);
    const targetPos = getWorkstationPos(registryRef.current, zonesRef.current, zoneId, slot);
    const targetApproachPos = getWorkstationApproachPos(
      registryRef.current,
      zonesRef.current,
      zoneId,
      slot,
    );
    assignedWorkPositionsRef.current.set(employeeId, targetPos);
    assignedWorkApproachPositionsRef.current.set(employeeId, targetApproachPos);
    assignedWorkZoneIdsRef.current.set(employeeId, zoneId);
    const mtgCenter = getZoneCenter(zonesRef.current, 'meeting');
    const targetZoneCenter = getZoneCenterById(zonesRef.current, zoneId);
    const meetingZoneId = getMeetingZoneId(zonesRef.current);
    const currentPosition = handle.getPosition() ?? mtgCenter;
    const route = buildDispatchRoute(currentPosition, targetZoneCenter, targetPos, {
      zoneWaypoints: buildZoneRouteWaypoints(zonesRef.current, meetingZoneId, zoneId),
      obstacleFootprints: getObstacleFootprints(registryRef.current),
      terminalApproach: targetApproachPos,
    });

    safeTimeout(() => {
      if (ceremonyVersionRef.current !== version) return;
      moveThroughPoints(handle, route, 4);
    }, 500);

    setCeremony((prev) => ({
      ...prev,
      dispatchedIds: new Set([...prev.dispatchedIds, employeeId]),
    }));
  };
}

export function createStartDismissPhase(
  deps: CeremonyPhaseActionsDeps,
): (employeeIds: readonly string[], version: number) => void {
  const {
    ceremonyVersionRef,
    safeTimeout,
    setCeremony,
    scheduleCeremonyReset,
    companyIdRef,
    zonesRef,
    registryRef,
    assignedWorkPositionsRef,
    assignedWorkZoneIdsRef,
  } = deps;
  const movementRefs = {
    companyIdRef,
    zonesRef,
    registryRef,
    assignedWorkPositionsRef,
    assignedWorkZoneIdsRef,
  };
  return (employeeIds, version) => {
    safeTimeout(() => {
      if (ceremonyVersionRef.current !== version) return;
      setCeremony((prev) => ({
        ...prev,
        phase: 'dismissing',
        bubbleText: '',
        managerVisible: false,
        managerPosition: null,
      }));
      for (const employeeId of employeeIds) {
        moveEmployeeToRest(employeeId, 4, movementRefs);
      }
      scheduleCeremonyReset(version, 3000);
    }, 1500);
  };
}

export function createStartEndCeremony(
  deps: CeremonyPhaseActionsDeps,
  startDismissPhase: (employeeIds: readonly string[], version: number) => void,
): (summaryText: string, version: number) => void {
  const {
    agentsRef,
    zonesRef,
    companyIdRef,
    registryRef,
    assignedWorkPositionsRef,
    assignedWorkApproachPositionsRef,
    assignedWorkZoneIdsRef,
    ceremonyVersionRef,
    setCeremony,
    scheduleCeremonyReset,
  } = deps;
  return (summaryText, version) => {
    const meetingCenter = getZoneCenter(zonesRef.current, 'meeting');
    let capturedDispatchedIds: string[] = [];
    setCeremony((prev) => {
      capturedDispatchedIds = [...prev.dispatchedIds];
      return {
        ...prev,
        phase: 'reporting',
        bubbleText: summaryText || 'Summarizing results...',
        managerVisible: true,
        managerPosition: buildManagerPresenceTarget(meetingCenter, 'reporting'),
      };
    });

    const dispatchedIds =
      capturedDispatchedIds.length > 0 ? capturedDispatchedIds : [...agentsRef.current.keys()];

    if (dispatchedIds.length === 0) {
      scheduleCeremonyReset(version, 1500);
      return;
    }

    let arrivedCount = 0;
    let expectedArrivals = 0;
    const mtgCenter = getZoneCenter(zonesRef.current, 'meeting');
    const mtgPositions = computeMtgPositions(mtgCenter, dispatchedIds.length);

    dispatchedIds.forEach((id, idx) => {
      const handle = getMovementHandles(companyIdRef.current).get(id);
      if (!handle) return;
      expectedArrivals += 1;
      const seat = mtgPositions[idx] ?? mtgPositions[0] ?? mtgCenter;
      const reportSeat: [number, number, number] = [
        seat[0] + (Math.random() - 0.5) * 0.3,
        0,
        seat[2] + (Math.random() - 0.5) * 0.3,
      ];
      const basePosition = assignedWorkPositionsRef.current.get(id) ?? reportSeat;
      const departureApproach = assignedWorkApproachPositionsRef.current.get(id) ?? basePosition;
      const meetingZoneId = getMeetingZoneId(zonesRef.current);
      const workZoneId = assignedWorkZoneIdsRef.current.get(id);
      const route = buildReturnToMeetingRoute(basePosition, mtgCenter, reportSeat, {
        departureApproach,
        zoneWaypoints: workZoneId
          ? buildZoneRouteWaypoints(zonesRef.current, workZoneId, meetingZoneId).reverse()
          : [],
        obstacleFootprints: getObstacleFootprints(registryRef.current),
      });

      moveThroughPoints(handle, route, 5, () => {
        arrivedCount++;
        if (arrivedCount >= expectedArrivals && ceremonyVersionRef.current === version) {
          startDismissPhase(dispatchedIds, version);
        }
      });
    });

    if (expectedArrivals === 0) {
      scheduleCeremonyReset(version, 1500);
    }
  };
}
