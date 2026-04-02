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
  const meetingZone = zones.find((zone) => zone.archetype === 'meeting');
  if (!meetingZone) return null;
  return layoutMap[meetingZone.zoneId] ?? null;
}

export function createFlowLine(
  from: [number, number, number],
  to: [number, number, number],
  variant: FlowLineData['variant'],
): FlowLineData {
  const now = Date.now();
  return {
    id: `flow-${now}-${Math.random()}`,
    from,
    to,
    variant,
    createdAt: now,
  };
}

export function buildEmployeeToMeetingFlowLine(
  employeeId: string,
  agents: Map<string, { role: string; workstationId?: string | null }>,
  zones: readonly Zone[],
  layoutMap: Readonly<Record<string, Zone3DLayout>>,
  variant: Extract<FlowLineData['variant'], 'approval' | 'blocked' | 'report'>,
): FlowLineData | null {
  const meetingZone = zones.find((zone) => zone.archetype === 'meeting');
  const meetingLayout = getMeetingLayout(zones, layoutMap);
  const agent = agents.get(employeeId);
  if (!meetingLayout || !meetingZone || !agent) return null;

  const zoneId = resolveEmployeeZoneDynamic(agent, zones);
  const fromLayout = layoutMap[zoneId];
  if (!fromLayout || zoneId === meetingZone.zoneId) return null;

  return createFlowLine(buildFlowEndpoint(fromLayout), buildFlowEndpoint(meetingLayout), variant);
}

export function buildReportingFlowLines(
  agents: Map<string, { role: string; state?: string; workstationId?: string | null }>,
  zones: readonly Zone[],
  layoutMap: Readonly<Record<string, Zone3DLayout>>,
): FlowLineData[] {
  const meetingLayout = getMeetingLayout(zones, layoutMap);
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
      createFlowLine(buildFlowEndpoint(fromLayout), buildFlowEndpoint(meetingLayout), 'report'),
    );
  }
  return lines;
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
