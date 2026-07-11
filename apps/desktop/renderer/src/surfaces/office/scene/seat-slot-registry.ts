/**
 * Renderer-owned, company-scoped office seat identity.
 *
 * Only the semantic slot is persisted. World coordinates remain derived from
 * the current zone/prefab layout, so Studio edits never create stale geometry
 * or a second layout schema. Offisim is prelaunch: malformed/old values reset
 * directly instead of growing a migration layer.
 */
import { MAX_COMPANY_EMPLOYEES } from '@/data/employee-capacity.js';

const SEAT_SLOT_REGISTRY_VERSION = 1 as const;
export const SEAT_SLOT_CAPACITY = MAX_COMPANY_EMPLOYEES;
const STORAGE_PREFIX = 'offisim:office:seat-slots:v1';

interface SeatEmployee {
  readonly id: string;
  readonly workstationId?: string | null;
}

interface SeatZone {
  readonly id: string;
}

interface SeatSlotAssignment {
  readonly zoneId: string;
  readonly slot: number;
}

export interface SeatSlotRegistry {
  readonly version: typeof SEAT_SLOT_REGISTRY_VERSION;
  readonly assignments: Readonly<Record<string, SeatSlotAssignment>>;
}

function emptyRegistry(): SeatSlotRegistry {
  return { version: SEAT_SLOT_REGISTRY_VERSION, assignments: {} };
}

function orderedAssignments(
  assignments: Readonly<Record<string, SeatSlotAssignment>>,
): Record<string, SeatSlotAssignment> {
  const ordered: Record<string, SeatSlotAssignment> = {};
  for (const employeeId of Object.keys(assignments).sort()) {
    const assignment = assignments[employeeId];
    if (assignment) ordered[employeeId] = assignment;
  }
  return ordered;
}

export function parseSeatSlotRegistry(raw: string | null | undefined): SeatSlotRegistry {
  if (!raw) return emptyRegistry();
  try {
    const parsed = JSON.parse(raw) as unknown;
    if (!parsed || typeof parsed !== 'object') return emptyRegistry();
    const record = parsed as Record<string, unknown>;
    if (record.version !== SEAT_SLOT_REGISTRY_VERSION) return emptyRegistry();
    if (!record.assignments || typeof record.assignments !== 'object') return emptyRegistry();

    const assignments: Record<string, SeatSlotAssignment> = {};
    for (const [employeeId, value] of Object.entries(
      record.assignments as Record<string, unknown>,
    )) {
      if (!employeeId || !value || typeof value !== 'object') continue;
      const seat = value as Record<string, unknown>;
      if (typeof seat.zoneId !== 'string' || !seat.zoneId) continue;
      if (!Number.isInteger(seat.slot) || (seat.slot as number) < 0) continue;
      if ((seat.slot as number) >= SEAT_SLOT_CAPACITY) continue;
      assignments[employeeId] = { zoneId: seat.zoneId, slot: seat.slot as number };
    }
    return { version: SEAT_SLOT_REGISTRY_VERSION, assignments: orderedAssignments(assignments) };
  } catch {
    return emptyRegistry();
  }
}

export function serializeSeatSlotRegistry(registry: SeatSlotRegistry): string {
  return JSON.stringify({
    version: SEAT_SLOT_REGISTRY_VERSION,
    assignments: orderedAssignments(registry.assignments),
  });
}

export function seatSlotRegistriesEqual(left: SeatSlotRegistry, right: SeatSlotRegistry): boolean {
  return serializeSeatSlotRegistry(left) === serializeSeatSlotRegistry(right);
}

/**
 * Preserve every still-valid identity binding, then allocate only the missing
 * employees in stable id order. Duplicate/corrupt slots are resolved by the
 * lexicographically first employee, making recovery deterministic.
 */
export function reconcileSeatSlotRegistry(
  roster: readonly SeatEmployee[],
  zones: readonly SeatZone[],
  fallbackZone: SeatZone,
  previous: SeatSlotRegistry,
): SeatSlotRegistry {
  if (zones.length === 0) return emptyRegistry();
  const zoneIds = new Set(zones.map((zone) => zone.id));
  const sortedRoster = [...roster].sort((a, b) => (a.id === b.id ? 0 : a.id < b.id ? -1 : 1));
  const zoneFor = (employee: SeatEmployee) =>
    employee.workstationId && zoneIds.has(employee.workstationId)
      ? employee.workstationId
      : fallbackZone.id;
  const usedByZone = new Map<string, Set<number>>();
  const assignments: Record<string, SeatSlotAssignment> = {};

  for (const employee of sortedRoster) {
    const zoneId = zoneFor(employee);
    const prior = previous.assignments[employee.id];
    if (!prior || prior.zoneId !== zoneId) continue;
    if (!Number.isInteger(prior.slot) || prior.slot < 0 || prior.slot >= SEAT_SLOT_CAPACITY)
      continue;
    const used = usedByZone.get(zoneId) ?? new Set<number>();
    if (used.has(prior.slot)) continue;
    used.add(prior.slot);
    usedByZone.set(zoneId, used);
    assignments[employee.id] = prior;
  }

  for (const employee of sortedRoster) {
    if (assignments[employee.id]) continue;
    const zoneId = zoneFor(employee);
    const used = usedByZone.get(zoneId) ?? new Set<number>();
    let slot = 0;
    while (used.has(slot) && slot < SEAT_SLOT_CAPACITY) slot += 1;
    if (slot >= SEAT_SLOT_CAPACITY) {
      throw new Error(`Zone ${zoneId} exceeds the 16-employee office capacity.`);
    }
    used.add(slot);
    usedByZone.set(zoneId, used);
    assignments[employee.id] = { zoneId, slot };
  }

  return { version: SEAT_SLOT_REGISTRY_VERSION, assignments: orderedAssignments(assignments) };
}

function storageKey(companyId: string): string {
  return `${STORAGE_PREFIX}:${companyId || 'preview'}`;
}

export function readSeatSlotRegistry(companyId: string): SeatSlotRegistry {
  try {
    return parseSeatSlotRegistry(globalThis.localStorage?.getItem(storageKey(companyId)));
  } catch {
    return emptyRegistry();
  }
}

export function writeSeatSlotRegistry(companyId: string, registry: SeatSlotRegistry): void {
  try {
    globalThis.localStorage?.setItem(storageKey(companyId), serializeSeatSlotRegistry(registry));
  } catch {
    // Hardened previews may disable storage; deterministic in-memory placement remains usable.
  }
}
