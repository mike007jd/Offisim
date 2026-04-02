import type { ToolCategory } from './tool-category';

type Vec3 = [number, number, number];

interface MovementLike {
  moveTo: (dest: Vec3, speed?: number, onArrive?: () => void) => void;
}

interface RouteOptions {
  zoneWaypoints?: readonly Vec3[];
}

const MEETING_EXIT_DISTANCE = 1.6;
const APPROVAL_HOLD_DISTANCE = 1.9;
const CLARIFICATION_HOLD_DISTANCE = 2.1;
const DUPLICATE_POINT_EPSILON = 0.35;

function distance2D(a: Vec3, b: Vec3): number {
  const dx = a[0] - b[0];
  const dz = a[2] - b[2];
  return Math.sqrt(dx * dx + dz * dz);
}

function dedupePath(points: readonly Vec3[]): Vec3[] {
  const deduped: Vec3[] = [];
  for (const point of points) {
    const prev = deduped.at(-1);
    if (prev && distance2D(prev, point) < DUPLICATE_POINT_EPSILON) {
      continue;
    }
    deduped.push(point);
  }
  return deduped;
}

export function buildDispatchRoute(
  meetingCenter: Vec3,
  targetZoneCenter: Vec3,
  targetSeat: Vec3,
  options?: RouteOptions,
): Vec3[] {
  const meetingExit: Vec3 = [
    meetingCenter[0],
    0,
    meetingCenter[2] +
      (targetZoneCenter[2] >= meetingCenter[2] ? MEETING_EXIT_DISTANCE : -MEETING_EXIT_DISTANCE),
  ];
  const targetZone: Vec3 = [targetZoneCenter[0], 0, targetZoneCenter[2]];
  const seat: Vec3 = [targetSeat[0], 0, targetSeat[2]];
  const zoneWaypoints = options?.zoneWaypoints ?? [];

  if (zoneWaypoints.length > 0) {
    return dedupePath([meetingExit, ...zoneWaypoints, targetZone, seat]);
  }

  const aisleTurn: Vec3 = [targetZoneCenter[0], 0, meetingExit[2]];

  return dedupePath([meetingExit, aisleTurn, targetZone, seat]);
}

export function buildReturnToMeetingRoute(
  workPosition: Vec3,
  meetingCenter: Vec3,
  targetSeat: Vec3,
  options?: RouteOptions,
): Vec3[] {
  const meetingApproach: Vec3 = [
    workPosition[0],
    0,
    meetingCenter[2] +
      (workPosition[2] >= meetingCenter[2] ? MEETING_EXIT_DISTANCE : -MEETING_EXIT_DISTANCE),
  ];
  const seat: Vec3 = [targetSeat[0], 0, targetSeat[2]];
  const zoneWaypoints = options?.zoneWaypoints ?? [];

  if (zoneWaypoints.length > 0) {
    return dedupePath([meetingApproach, ...zoneWaypoints, seat]);
  }

  const aisleTurn: Vec3 = [targetSeat[0], 0, meetingApproach[2]];

  return dedupePath([meetingApproach, aisleTurn, seat]);
}

export function buildApprovalHoldTarget(meetingCenter: Vec3, slotIndex = 0): Vec3 {
  const laneOffset = (slotIndex % 3) - 1;
  return [
    Number((meetingCenter[0] + laneOffset * 0.75).toFixed(2)),
    0,
    Number((meetingCenter[2] - APPROVAL_HOLD_DISTANCE).toFixed(2)),
  ];
}

export function buildClarificationHoldTarget(meetingCenter: Vec3, slotIndex = 0): Vec3 {
  const laneOffset = (slotIndex % 3) - 1;
  return [
    Number((meetingCenter[0] + laneOffset * 0.75).toFixed(2)),
    0,
    Number((meetingCenter[2] + CLARIFICATION_HOLD_DISTANCE).toFixed(2)),
  ];
}

export function buildHandoffRoute(
  fromPos: Vec3,
  toPos: Vec3,
  meetingCenter: Vec3,
  options?: RouteOptions,
): Vec3[] {
  const fromAisle: Vec3 = [fromPos[0], 0, meetingCenter[2] + MEETING_EXIT_DISTANCE];
  const transferPoint: Vec3 = [meetingCenter[0], 0, meetingCenter[2] + MEETING_EXIT_DISTANCE];
  const toAisle: Vec3 = [toPos[0], 0, transferPoint[2]];
  const zoneWaypoints = options?.zoneWaypoints ?? [];

  if (zoneWaypoints.length > 0) {
    return dedupePath([fromAisle, ...zoneWaypoints, transferPoint, toAisle, toPos]);
  }

  return dedupePath([fromAisle, transferPoint, toAisle, toPos]);
}

export function buildManagerPresenceTarget(
  meetingCenter: Vec3,
  phase: 'analyzing' | 'planning' | 'reporting',
): Vec3 {
  switch (phase) {
    case 'planning':
      return [meetingCenter[0] + 1.4, 0, meetingCenter[2] - 2.4];
    case 'analyzing':
    case 'reporting':
      return [meetingCenter[0], 0, meetingCenter[2] - 3.1];
  }
}

export function buildWorkActivityTarget(basePosition: Vec3, category: ToolCategory): Vec3 {
  const offsets: Record<ToolCategory, Vec3> = {
    search: [-0.65, 0, 0.45],
    read: [0, 0, 0.5],
    edit: [0.35, 0, -0.15],
    shell: [-0.3, 0, -0.25],
    other: [0.15, 0, 0.2],
  };
  const offset = offsets[category];
  return [
    Number((basePosition[0] + offset[0]).toFixed(2)),
    0,
    Number((basePosition[2] + offset[2]).toFixed(2)),
  ];
}

export function buildStalledWorkTarget(
  basePosition: Vec3,
  kind: 'blocked' | 'failed' = 'blocked',
): Vec3 {
  const offset: Vec3 = kind === 'failed' ? [0.45, 0, 0.55] : [-0.45, 0, 0.65];
  return [
    Number((basePosition[0] + offset[0]).toFixed(2)),
    0,
    Number((basePosition[2] + offset[2]).toFixed(2)),
  ];
}

export function moveThroughPoints(
  handle: MovementLike,
  points: readonly Vec3[],
  speed = 4,
  onComplete?: () => void,
): void {
  if (points.length === 0) {
    onComplete?.();
    return;
  }

  const [first, ...rest] = points;
  if (!first) {
    onComplete?.();
    return;
  }
  handle.moveTo(first, speed, () => {
    if (rest.length === 0) {
      onComplete?.();
      return;
    }
    moveThroughPoints(handle, rest, speed, onComplete);
  });
}
