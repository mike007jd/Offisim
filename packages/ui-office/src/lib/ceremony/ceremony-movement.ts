import type { Zone } from '@offisim/shared-types';
import type { MutableRefObject } from 'react';
import {
  getObstacleFootprints,
  resolveZoneIdForPosition,
} from '../../hooks/scene-orchestrator-positions';
import { getMovementHandles } from '../../runtime/movement-handle-registry';
import { getRestPos } from '../../runtime/zone-slot-counter';
import { buildTransitRoute, moveThroughPoints } from '../scene-behavior';
import { buildZoneRouteWaypoints } from '../scene-nav';
import type { SeatRegistry } from '../seat-registry';

export interface CeremonyMovementRefs {
  companyIdRef: MutableRefObject<string>;
  zonesRef: MutableRefObject<readonly Zone[]>;
  registryRef: MutableRefObject<SeatRegistry | null>;
  assignedWorkPositionsRef: MutableRefObject<Map<string, [number, number, number]>>;
  assignedWorkZoneIdsRef: MutableRefObject<Map<string, string>>;
}

export interface TransitOptions {
  startZoneId?: string | null;
  endZoneId?: string | null;
  onComplete?: () => void;
}

export function moveEmployeeAlongTransit(
  employeeId: string,
  targetPosition: [number, number, number],
  speed: number,
  refs: CeremonyMovementRefs,
  options?: TransitOptions,
): void {
  const handle = getMovementHandles(refs.companyIdRef.current).get(employeeId);
  if (!handle) return;

  const currentPosition =
    handle.getPosition() ?? refs.assignedWorkPositionsRef.current.get(employeeId) ?? targetPosition;
  const startZoneId =
    options?.startZoneId ??
    refs.assignedWorkZoneIdsRef.current.get(employeeId) ??
    resolveZoneIdForPosition(currentPosition, refs.zonesRef.current);
  const endZoneId =
    options?.endZoneId ?? resolveZoneIdForPosition(targetPosition, refs.zonesRef.current);
  const zoneWaypoints =
    startZoneId && endZoneId && startZoneId !== endZoneId
      ? buildZoneRouteWaypoints(refs.zonesRef.current, startZoneId, endZoneId)
      : [];
  const route = buildTransitRoute(currentPosition, targetPosition, {
    zoneWaypoints,
    obstacleFootprints: getObstacleFootprints(refs.registryRef.current),
  }).slice(1);

  moveThroughPoints(handle, route, speed, options?.onComplete);
}

export function moveEmployeeToRest(
  employeeId: string,
  speed: number,
  refs: CeremonyMovementRefs,
  onComplete?: () => void,
): void {
  const restZoneId =
    refs.zonesRef.current.find((zone) => zone.archetype === 'rest')?.zoneId ?? null;
  const targetPos = getRestPos(
    refs.companyIdRef.current,
    refs.registryRef.current,
    refs.zonesRef.current,
  );
  moveEmployeeAlongTransit(employeeId, targetPos, speed, refs, {
    endZoneId: restZoneId,
    onComplete,
  });
}
