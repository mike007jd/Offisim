import type { Zone } from '@offisim/shared-types';
import type { NewWorkstation } from '../runtime/repositories.js';

/**
 * Build the zone-level "home" workstation row for an office zone.
 *
 * The workstation id IS the zone id: the office scene resolves an employee's
 * seat by matching `employee.workstation_id === zone.zone_id`. This is the
 * single builder for that row shape so template materialization and the legacy
 * backfill can never drift on `room_type` / `position_json` / `seat_capacity`.
 */
export function buildZoneHomeWorkstation(
  zone: Zone,
  companyId: string,
  seatCount: number,
  now: string,
): NewWorkstation {
  return {
    workstation_id: zone.zoneId,
    company_id: companyId,
    room_type: zone.archetype ?? zone.kind,
    label: zone.label,
    position_json: JSON.stringify({
      kind: 'zone-assignment',
      zoneId: zone.zoneId,
      x: zone.cx,
      z: zone.cz,
    }),
    seat_capacity: Math.max(1, seatCount),
    created_at: now,
    updated_at: now,
  };
}
