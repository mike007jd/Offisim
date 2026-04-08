import type { Zone } from '@offisim/shared-types';
import type { SeatRegistry } from '../../lib/seat-registry.js';
import { positionToSVG } from './office-2d-geometry';

export interface SvgPoint {
  x: number;
  y: number;
}

export function buildZoneDeskEmployeeSvgPositions(
  zone: Zone,
  employeeCount: number,
  seatRegistry: SeatRegistry,
): SvgPoint[] {
  return Array.from({ length: employeeCount }, (_, index) => {
    const [worldX, , worldZ] = seatRegistry.getSeat(zone.zoneId, index)?.position ?? [zone.cx, 0, zone.cz];
    return positionToSVG(worldX, worldZ);
  });
}
