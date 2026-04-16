import type { Zone } from '@offisim/shared-types';
import { getZoneCenter } from '../hooks/scene-orchestrator-positions';
import { type SeatRegistry, computeRestSeatPosition } from '../lib/seat-registry';

const zoneSlotCounters = new Map<string, number>();

export function getNextSlot(zoneId: string): number {
  const n = zoneSlotCounters.get(zoneId) ?? 0;
  zoneSlotCounters.set(zoneId, n + 1);
  return n;
}

export function resetSlotCounters(): void {
  zoneSlotCounters.clear();
}

function getRestSlotKey(companyId: string): string {
  return `${companyId}:rest-counter`;
}

export function getRestPos(
  companyId: string,
  registry: SeatRegistry | null,
  zones: readonly Zone[],
): [number, number, number] {
  const key = getRestSlotKey(companyId);
  const idx = zoneSlotCounters.get(key) ?? 0;
  zoneSlotCounters.set(key, idx + 1);
  if (registry) {
    return [...registry.getRestSeat(zones, idx)];
  }
  const restCenter = getZoneCenter(zones, 'rest');
  return computeRestSeatPosition(restCenter[0], restCenter[2], idx);
}

/** Clear all zone slot counters keyed for the given company. */
export function clearZoneSlotCountersForCompany(companyId: string): void {
  for (const key of zoneSlotCounters.keys()) {
    if (key.startsWith(`${companyId}:`)) zoneSlotCounters.delete(key);
  }
}
