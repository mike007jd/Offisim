import type { RoleSlug, Zone } from '@offisim/shared-types';
import { UNASSIGNED_ZONE_ID, resolveZoneForRole } from '@offisim/shared-types';
import {
  buildZoneRouteWaypoints,
  elevateWaypoints,
  getMeetingZoneId,
} from '../../lib/scene-nav.js';

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
  points: [number, number, number][];
  variant: 'normal' | 'handoff' | 'approval' | 'report' | 'blocked';
  createdAt: number;
}

export function getFlowLineColor(variant: FlowLineData['variant']): string {
  switch (variant) {
    case 'handoff':
      return '#f97316';
    case 'approval':
      return '#fbbf24';
    case 'report':
      return '#22d3ee';
    case 'blocked':
      return '#f87171';
    default:
      return '#60a5fa';
  }
}

export function getFlowLineVariantLabel(variant: FlowLineData['variant']): string | null {
  switch (variant) {
    case 'handoff':
      return 'Handing off';
    case 'approval':
      return 'Pending approval';
    case 'report':
      return 'Reporting';
    case 'blocked':
      return 'Blocked';
    default:
      return null;
  }
}

const ACTIVE_REPORTING_STATES = new Set([
  'assigned',
  'thinking',
  'searching',
  'executing',
  'waiting',
  'reporting',
  'blocked',
  'failed',
]);

function buildFlowEndpoint(layout: Zone3DLayout, height = 0.5): [number, number, number] {
  return [layout.position[0], height, layout.position[2]];
}

function getMeetingLayout(
  zones: readonly Zone[],
  layoutMap: Readonly<Record<string, Zone3DLayout>>,
): Zone3DLayout | null {
  return layoutMap[getMeetingZoneId(zones)] ?? null;
}

export function createFlowLine(
  from: [number, number, number],
  to: [number, number, number],
  variant: FlowLineData['variant'],
  waypoints: [number, number, number][] = [],
): FlowLineData {
  const now = Date.now();
  return {
    id: `flow-${now}-${Math.random()}`,
    from,
    to,
    points: [from, ...waypoints, to],
    variant,
    createdAt: now,
  };
}

export function buildDispatchFlowLine(
  fromLayout: Zone3DLayout,
  toLayout: Zone3DLayout,
  waypoints: [number, number, number][] = [],
): FlowLineData {
  return createFlowLine(
    buildFlowEndpoint(fromLayout),
    buildFlowEndpoint(toLayout),
    'normal',
    waypoints,
  );
}

export function buildEmployeeToMeetingFlowLine(
  employeeId: string,
  agents: Map<string, { role: string; workstationId?: string | null }>,
  zones: readonly Zone[],
  layoutMap: Readonly<Record<string, Zone3DLayout>>,
  variant: Extract<FlowLineData['variant'], 'approval' | 'blocked' | 'report'>,
  waypoints: [number, number, number][] = [],
): FlowLineData | null {
  const meetingZoneId = getMeetingZoneId(zones);
  const meetingLayout = getMeetingLayout(zones, layoutMap);
  const agent = agents.get(employeeId);
  if (!meetingLayout || !agent) return null;

  const zoneId = resolveEmployeeZoneDynamic(agent, zones);
  const fromLayout = layoutMap[zoneId];
  if (!fromLayout || zoneId === meetingZoneId) return null;

  return createFlowLine(
    buildFlowEndpoint(fromLayout),
    buildFlowEndpoint(meetingLayout),
    variant,
    waypoints,
  );
}

export function buildReportingFlowLines(
  agents: Map<string, { role: string; state?: string; workstationId?: string | null }>,
  zones: readonly Zone[],
  layoutMap: Readonly<Record<string, Zone3DLayout>>,
): FlowLineData[] {
  const meetingZoneId = getMeetingZoneId(zones);
  const meetingLayout = layoutMap[meetingZoneId];
  if (!meetingLayout) return [];

  const lines: FlowLineData[] = [];
  for (const [, agent] of agents) {
    if (!ACTIVE_REPORTING_STATES.has(agent.state ?? 'idle')) {
      continue;
    }
    const zoneId = resolveEmployeeZoneDynamic(agent, zones);
    const zone = zones.find((entry) => entry.zoneId === zoneId);
    if (!zone || zone.archetype === 'meeting' || zone.archetype === 'rest') {
      continue;
    }
    const fromLayout = layoutMap[zoneId];
    if (!fromLayout) continue;
    lines.push(
      createFlowLine(
        buildFlowEndpoint(fromLayout),
        buildFlowEndpoint(meetingLayout),
        'report',
        elevateWaypoints(buildZoneRouteWaypoints(zones, zoneId, meetingZoneId)),
      ),
    );
  }
  return lines;
}

export function buildHandoffFlowLine(
  fromEmployeeId: string,
  toEmployeeId: string,
  agents: Map<string, { role: string; workstationId?: string | null }>,
  zones: readonly Zone[],
  layoutMap: Readonly<Record<string, Zone3DLayout>>,
): FlowLineData | null {
  const fromAgent = agents.get(fromEmployeeId);
  const toAgent = agents.get(toEmployeeId);
  if (!fromAgent || !toAgent) return null;

  const fromLayout = layoutMap[resolveEmployeeZoneDynamic(fromAgent, zones)];
  const toLayout = layoutMap[resolveEmployeeZoneDynamic(toAgent, zones)];
  const meetingLayout = getMeetingLayout(zones, layoutMap);
  if (!fromLayout || !toLayout || !meetingLayout) return null;

  return createFlowLine(buildFlowEndpoint(fromLayout), buildFlowEndpoint(toLayout), 'handoff', [
    buildFlowEndpoint(meetingLayout),
  ]);
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
