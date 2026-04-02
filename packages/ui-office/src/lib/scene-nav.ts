import type { Zone } from '@offisim/shared-types';

type Vec3 = [number, number, number];

const MAX_NAV_GAP = 4.5;

function getBounds(zone: Zone) {
  return {
    left: zone.cx - zone.w / 2,
    right: zone.cx + zone.w / 2,
    top: zone.cz - zone.d / 2,
    bottom: zone.cz + zone.d / 2,
  };
}

function getAxisGap(aStart: number, aEnd: number, bStart: number, bEnd: number): number {
  if (aEnd < bStart) return bStart - aEnd;
  if (bEnd < aStart) return aStart - bEnd;
  return 0;
}

function getCenterDistance(a: Zone, b: Zone): number {
  const dx = a.cx - b.cx;
  const dz = a.cz - b.cz;
  return Math.sqrt(dx * dx + dz * dz);
}

export function zonesAreNavAdjacent(a: Zone, b: Zone, maxGap = MAX_NAV_GAP): boolean {
  const aBounds = getBounds(a);
  const bBounds = getBounds(b);

  const horizontalGap = getAxisGap(aBounds.left, aBounds.right, bBounds.left, bBounds.right);
  const verticalGap = getAxisGap(aBounds.top, aBounds.bottom, bBounds.top, bBounds.bottom);

  const overlapsX = horizontalGap === 0;
  const overlapsZ = verticalGap === 0;

  return (overlapsX && verticalGap <= maxGap) || (overlapsZ && horizontalGap <= maxGap);
}

function buildAdjacency(zones: readonly Zone[]): Map<string, Set<string>> {
  const adjacency = new Map<string, Set<string>>();

  for (const zone of zones) {
    adjacency.set(zone.zoneId, new Set());
  }

  for (let i = 0; i < zones.length; i += 1) {
    const a = zones[i];
    if (!a) continue;
    for (let j = i + 1; j < zones.length; j += 1) {
      const b = zones[j];
      if (!b) continue;
      if (!zonesAreNavAdjacent(a, b)) continue;
      adjacency.get(a.zoneId)?.add(b.zoneId);
      adjacency.get(b.zoneId)?.add(a.zoneId);
    }
  }

  for (const zone of zones) {
    const neighbors = adjacency.get(zone.zoneId);
    if (neighbors && neighbors.size > 0) continue;

    const nearest = zones
      .filter((candidate) => candidate.zoneId !== zone.zoneId)
      .sort((left, right) => getCenterDistance(zone, left) - getCenterDistance(zone, right))[0];
    if (!nearest) continue;

    adjacency.get(zone.zoneId)?.add(nearest.zoneId);
    adjacency.get(nearest.zoneId)?.add(zone.zoneId);
  }

  return adjacency;
}

export function findZoneNavPath(
  zones: readonly Zone[],
  startZoneId: string,
  endZoneId: string,
): string[] {
  if (startZoneId === endZoneId) {
    return [startZoneId];
  }

  const zoneMap = new Map(zones.map((z) => [z.zoneId, z]));
  const startZone = zoneMap.get(startZoneId);
  const endZone = zoneMap.get(endZoneId);
  if (!startZone || !endZone) {
    return [startZoneId, endZoneId];
  }

  const adjacency = buildAdjacency(zones);
  const open = new Set([startZoneId]);
  const cameFrom = new Map<string, string>();
  const gScore = new Map<string, number>([[startZoneId, 0]]);
  const fScore = new Map<string, number>([[startZoneId, getCenterDistance(startZone, endZone)]]);

  while (open.size > 0) {
    const current =
      [...open].sort(
        (left, right) =>
          (fScore.get(left) ?? Number.POSITIVE_INFINITY) -
          (fScore.get(right) ?? Number.POSITIVE_INFINITY),
      )[0] ?? endZoneId;

    if (current === endZoneId) {
      const path = [current];
      let cursor = current;
      while (cameFrom.has(cursor)) {
        cursor = cameFrom.get(cursor) ?? cursor;
        path.unshift(cursor);
      }
      return path;
    }

    open.delete(current);
    const neighbors = adjacency.get(current);
    if (!neighbors) continue;
    const currentZone = zoneMap.get(current);
    if (!currentZone) continue;

    for (const neighborId of neighbors) {
      const neighborZone = zoneMap.get(neighborId);
      if (!neighborZone) continue;

      const tentativeScore =
        (gScore.get(current) ?? Number.POSITIVE_INFINITY) +
        getCenterDistance(currentZone, neighborZone);

      if (tentativeScore >= (gScore.get(neighborId) ?? Number.POSITIVE_INFINITY)) {
        continue;
      }

      cameFrom.set(neighborId, current);
      gScore.set(neighborId, tentativeScore);
      fScore.set(neighborId, tentativeScore + getCenterDistance(neighborZone, endZone));
      open.add(neighborId);
    }
  }

  return [startZoneId, endZoneId];
}

export function getMeetingZoneId(zones: readonly Zone[]): string {
  return zones.find((zone) => zone.archetype === 'meeting')?.zoneId ?? 'meeting';
}

export function buildZoneRouteWaypoints(
  zones: readonly Zone[],
  startZoneId: string,
  endZoneId: string,
): Vec3[] {
  const path = findZoneNavPath(zones, startZoneId, endZoneId);
  return path
    .slice(1, -1)
    .map((zoneId) => zones.find((zone) => zone.zoneId === zoneId))
    .filter((zone): zone is Zone => zone != null)
    .map((zone) => [zone.cx, 0, zone.cz] as Vec3);
}

const FLOW_LINE_HEIGHT = 0.5;

export function elevateWaypoints(points: Vec3[]): Vec3[] {
  return points.map((p) => [p[0], FLOW_LINE_HEIGHT, p[2]] as Vec3);
}
