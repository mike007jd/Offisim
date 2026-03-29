import type { RoleSlug, Zone } from '@offisim/shared-types';
import { UNASSIGNED_ZONE_ID, resolveZoneForRole } from '@offisim/shared-types';

export interface Zone3DLayout {
  position: [number, number, number];
  size: [number, number];
}

export type Zone3D = Zone & Zone3DLayout;

export interface DragState3D {
  employeeId: string;
  sourceZoneId: string;
  active: boolean;
  position: [number, number, number];
  startScreenX: number;
  startScreenY: number;
}

export interface FlowLineData {
  id: string;
  from: [number, number, number];
  to: [number, number, number];
  variant: 'normal' | 'handoff';
  createdAt: number;
}

export function toZone3DLayout(zone: Zone): Zone3DLayout {
  return {
    position: [zone.cx, 0, zone.cz] as [number, number, number],
    size: [zone.w, zone.d] as [number, number],
  };
}

export function resolveEmployeeZoneDynamic(
  agent: { role: string; workstationId?: string | null },
  zones: readonly Zone[],
): string {
  if (agent.workstationId) {
    const validIds = new Set(zones.filter((zone) => zone.deskSlots > 0).map((zone) => zone.zoneId));
    if (validIds.has(agent.workstationId)) {
      return agent.workstationId;
    }
  }
  return resolveZoneForRole(agent.role as RoleSlug, zones)?.zoneId ?? UNASSIGNED_ZONE_ID;
}

export function hitTestZone3D(
  worldX: number,
  worldZ: number,
  dropTargets: readonly Zone3D[],
): Zone3D | null {
  for (const zone of dropTargets) {
    const halfW = zone.size[0] / 2;
    const halfD = zone.size[1] / 2;
    const cx = zone.position[0];
    const cz = zone.position[2];
    if (
      worldX >= cx - halfW &&
      worldX <= cx + halfW &&
      worldZ >= cz - halfD &&
      worldZ <= cz + halfD
    ) {
      return zone;
    }
  }
  return null;
}

export const DRAG_THRESHOLD_PX = 5;
