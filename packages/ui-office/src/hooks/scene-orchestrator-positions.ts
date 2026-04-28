import { type Zone, isInsideZone } from '@offisim/shared-types';
import { type SeatRegistry, computeWorkspaceFallbackSeatPosition } from '../lib/seat-registry';

const MTG_RADIUS = 2.5;
const MTG_RING_SPACING = 1.2;
const ORIGIN: [number, number, number] = [0, 0, 0];

export function getZoneCenter(zones: readonly Zone[], archetype: string): [number, number, number] {
  const zone = zones.find((entry) => entry.archetype === archetype);
  return zone ? [zone.cx, 0, zone.cz] : ORIGIN;
}

export function getZoneCenterById(
  zones: readonly Zone[],
  zoneId: string,
): [number, number, number] {
  const zone = zones.find((entry) => entry.zoneId === zoneId);
  return zone ? [zone.cx, 0, zone.cz] : ORIGIN;
}

export function computeMtgPositions(
  mtgCenter: [number, number, number],
  participantCount = 8,
): [number, number, number][] {
  const total = Math.max(participantCount, 0);
  const positions: [number, number, number][] = [];
  let ring = 0;

  while (positions.length < total) {
    const slotsInRing = 8 + ring * 4;
    const radius = MTG_RADIUS + ring * MTG_RING_SPACING;
    for (let index = 0; index < slotsInRing && positions.length < total; index++) {
      const angle = (Math.PI * (index + 1)) / (slotsInRing + 1);
      positions.push([
        mtgCenter[0] + Math.cos(angle) * radius,
        0,
        mtgCenter[2] + Math.sin(angle) * radius,
      ]);
    }
    ring++;
  }

  return positions;
}

export function getWorkstationPos(
  registry: SeatRegistry | null,
  zones: readonly Zone[],
  zoneId: string,
  slotIdx: number,
): [number, number, number] {
  if (registry) {
    const seat = registry.getSeat(zoneId, slotIdx);
    if (seat) return [...seat.position];
  }
  const center = getZoneCenterById(zones, zoneId);
  return computeWorkspaceFallbackSeatPosition(center[0], center[2], slotIdx);
}

export function getWorkstationApproachPos(
  registry: SeatRegistry | null,
  zones: readonly Zone[],
  zoneId: string,
  slotIdx: number,
): [number, number, number] {
  if (registry) {
    const seat = registry.getSeat(zoneId, slotIdx);
    if (seat) return [...seat.approachPosition];
  }
  return getWorkstationPos(registry, zones, zoneId, slotIdx);
}

export function getObstacleFootprints(registry: SeatRegistry | null) {
  return registry?.getObstacleFootprints() ?? [];
}

export function resolveZoneIdForPosition(
  position: readonly [number, number, number],
  zones: readonly Zone[],
): string | null {
  return zones.find((zone) => isInsideZone(position[0], position[2], zone))?.zoneId ?? null;
}
