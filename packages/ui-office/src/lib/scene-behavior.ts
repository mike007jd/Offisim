import type { ToolCategory } from './tool-category';

type Vec3 = [number, number, number];

export interface ObstacleFootprint {
  cx: number;
  cz: number;
  halfW: number;
  halfD: number;
}

interface MovementLike {
  moveTo: (dest: Vec3, speed?: number, onArrive?: () => void) => void;
}

interface RouteOptions {
  zoneWaypoints?: readonly Vec3[];
  obstacleFootprints?: readonly ObstacleFootprint[];
}

const MEETING_EXIT_DISTANCE = 1.6;
const APPROVAL_HOLD_DISTANCE = 1.9;
const CLARIFICATION_HOLD_DISTANCE = 2.1;
const DUPLICATE_POINT_EPSILON = 0.35;
const OBSTACLE_CLEARANCE = 0.35;
const OBSTACLE_TOUCH_EPSILON = 0.01;
const MAX_DETOUR_DEPTH = 6;

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

function ensureTerminalPoint(points: readonly Vec3[], terminal: Vec3): Vec3[] {
  if (points.length === 0) {
    return [terminal];
  }
  const next = [...points];
  const last = next.at(-1);
  if (!last) {
    return [terminal];
  }
  if (distance2D(last, terminal) < 1e-6) {
    next[next.length - 1] = terminal;
    return next;
  }
  next.push(terminal);
  return next;
}

function pathDistance(points: readonly Vec3[]): number {
  let total = 0;
  for (let i = 1; i < points.length; i += 1) {
    const prev = points[i - 1];
    const current = points[i];
    if (!prev || !current) continue;
    total += distance2D(prev, current);
  }
  return total;
}

function filterBlockedWaypoints(
  points: readonly Vec3[],
  footprints: readonly ObstacleFootprint[],
): Vec3[] {
  if (footprints.length === 0) {
    return [...points];
  }
  return points.filter(
    (point, index) =>
      index === points.length - 1 ||
      !footprints.some((footprint) => pointInsideExpandedFootprint(point, footprint)),
  );
}

function pointInsideExpandedFootprint(point: Vec3, footprint: ObstacleFootprint): boolean {
  return (
    Math.abs(point[0] - footprint.cx) < footprint.halfW + OBSTACLE_CLEARANCE &&
    Math.abs(point[2] - footprint.cz) < footprint.halfD + OBSTACLE_CLEARANCE
  );
}

function segmentsIntersect2D(a1: Vec3, a2: Vec3, b1: Vec3, b2: Vec3): boolean {
  const orientation = (p: Vec3, q: Vec3, r: Vec3) => {
    const value = (q[2] - p[2]) * (r[0] - q[0]) - (q[0] - p[0]) * (r[2] - q[2]);
    if (Math.abs(value) < 1e-6) return 0;
    return value > 0 ? 1 : 2;
  };
  const onSegment = (p: Vec3, q: Vec3, r: Vec3) =>
    q[0] <= Math.max(p[0], r[0]) + 1e-6 &&
    q[0] + 1e-6 >= Math.min(p[0], r[0]) &&
    q[2] <= Math.max(p[2], r[2]) + 1e-6 &&
    q[2] + 1e-6 >= Math.min(p[2], r[2]);

  const o1 = orientation(a1, a2, b1);
  const o2 = orientation(a1, a2, b2);
  const o3 = orientation(b1, b2, a1);
  const o4 = orientation(b1, b2, a2);

  if (o1 !== o2 && o3 !== o4) return true;
  if (o1 === 0 && onSegment(a1, b1, a2)) return true;
  if (o2 === 0 && onSegment(a1, b2, a2)) return true;
  if (o3 === 0 && onSegment(b1, a1, b2)) return true;
  if (o4 === 0 && onSegment(b1, a2, b2)) return true;
  return false;
}

function segmentIntersectsFootprint(start: Vec3, end: Vec3, footprint: ObstacleFootprint): boolean {
  if (
    pointInsideExpandedFootprint(start, footprint) ||
    pointInsideExpandedFootprint(end, footprint)
  ) {
    return true;
  }

  const left = footprint.cx - footprint.halfW - OBSTACLE_CLEARANCE;
  const right = footprint.cx + footprint.halfW + OBSTACLE_CLEARANCE;
  const top = footprint.cz - footprint.halfD - OBSTACLE_CLEARANCE;
  const bottom = footprint.cz + footprint.halfD + OBSTACLE_CLEARANCE;
  const edges: Array<[Vec3, Vec3]> = [
    [
      [left + OBSTACLE_TOUCH_EPSILON, 0, top + OBSTACLE_TOUCH_EPSILON],
      [right - OBSTACLE_TOUCH_EPSILON, 0, top + OBSTACLE_TOUCH_EPSILON],
    ],
    [
      [right - OBSTACLE_TOUCH_EPSILON, 0, top + OBSTACLE_TOUCH_EPSILON],
      [right - OBSTACLE_TOUCH_EPSILON, 0, bottom - OBSTACLE_TOUCH_EPSILON],
    ],
    [
      [right - OBSTACLE_TOUCH_EPSILON, 0, bottom - OBSTACLE_TOUCH_EPSILON],
      [left + OBSTACLE_TOUCH_EPSILON, 0, bottom - OBSTACLE_TOUCH_EPSILON],
    ],
    [
      [left + OBSTACLE_TOUCH_EPSILON, 0, bottom - OBSTACLE_TOUCH_EPSILON],
      [left + OBSTACLE_TOUCH_EPSILON, 0, top + OBSTACLE_TOUCH_EPSILON],
    ],
  ];

  return edges.some(([a, b]) => segmentsIntersect2D(start, end, a, b));
}

function buildFootprintDetours(start: Vec3, end: Vec3, footprint: ObstacleFootprint): Vec3[][] {
  const left = Number((footprint.cx - footprint.halfW - OBSTACLE_CLEARANCE).toFixed(2));
  const right = Number((footprint.cx + footprint.halfW + OBSTACLE_CLEARANCE).toFixed(2));
  const top = Number((footprint.cz - footprint.halfD - OBSTACLE_CLEARANCE).toFixed(2));
  const bottom = Number((footprint.cz + footprint.halfD + OBSTACLE_CLEARANCE).toFixed(2));

  // Clamp start/end x to outside the footprint's expanded x range so
  // the first/last leg of the detour doesn't re-enter the obstacle.
  const safeStartX = start[0] < footprint.cx ? Math.min(start[0], left) : Math.max(start[0], right);
  const safeEndX = end[0] < footprint.cx ? Math.min(end[0], left) : Math.max(end[0], right);

  // Two-waypoint L-shaped detours through top or bottom of the obstacle.
  const candidates: Vec3[][] = [
    [
      [safeStartX, 0, top],
      [safeEndX, 0, top],
    ],
    [
      [safeStartX, 0, bottom],
      [safeEndX, 0, bottom],
    ],
  ];

  return candidates.map((candidate) => dedupePath(candidate));
}

function rerouteSegment(
  start: Vec3,
  end: Vec3,
  footprints: readonly ObstacleFootprint[],
  depth = 0,
): Vec3[] {
  if (depth > MAX_DETOUR_DEPTH) {
    return [start, end];
  }

  const blockingFootprint = footprints.find((footprint) =>
    segmentIntersectsFootprint(start, end, footprint),
  );
  if (!blockingFootprint) {
    return [start, end];
  }

  const candidates = buildFootprintDetours(start, end, blockingFootprint)
    .map((detour) => [start, ...detour, end] as Vec3[])
    .map((candidate) => {
      const expanded: Vec3[] = [candidate[0] ?? start];
      for (let i = 1; i < candidate.length; i += 1) {
        const prev = expanded.at(-1) ?? start;
        const current = candidate[i];
        if (!current) continue;
        expanded.push(...rerouteSegment(prev, current, footprints, depth + 1).slice(1));
      }
      return dedupePath(expanded);
    })
    .filter((candidate) =>
      candidate.every(
        (point, index) =>
          (index === 0 ||
            !footprints.some((footprint) => pointInsideExpandedFootprint(point, footprint))) &&
          (index === 0 ||
            !footprints.some((footprint) =>
              segmentIntersectsFootprint(candidate[index - 1] ?? point, point, footprint),
            )),
      ),
    )
    .sort((left, right) => pathDistance(left) - pathDistance(right));

  return candidates[0] ?? [start, end];
}

function applyObstacleDetours(
  origin: Vec3,
  points: readonly Vec3[],
  footprints: readonly ObstacleFootprint[],
): Vec3[] {
  if (points.length === 0 || footprints.length === 0) {
    return [...points];
  }

  const routed: Vec3[] = [origin];
  for (const point of points) {
    const start = routed.at(-1) ?? origin;
    routed.push(...rerouteSegment(start, point, footprints).slice(1));
  }
  return dedupePath(routed).slice(1);
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
  const obstacleFootprints = options?.obstacleFootprints ?? [];
  const basePath =
    zoneWaypoints.length > 0
      ? dedupePath([meetingExit, ...zoneWaypoints, targetZone, seat])
      : dedupePath([meetingExit, [targetZoneCenter[0], 0, meetingExit[2]], targetZone, seat]);

  return ensureTerminalPoint(
    applyObstacleDetours(
      meetingCenter,
      filterBlockedWaypoints(basePath, obstacleFootprints),
      obstacleFootprints,
    ),
    seat,
  );
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
  const obstacleFootprints = options?.obstacleFootprints ?? [];
  const basePath =
    zoneWaypoints.length > 0
      ? dedupePath([meetingApproach, ...zoneWaypoints, seat])
      : dedupePath([meetingApproach, [targetSeat[0], 0, meetingApproach[2]], seat]);

  return ensureTerminalPoint(
    applyObstacleDetours(
      workPosition,
      filterBlockedWaypoints(basePath, obstacleFootprints),
      obstacleFootprints,
    ),
    seat,
  );
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
  const obstacleFootprints = options?.obstacleFootprints ?? [];

  const basePath =
    zoneWaypoints.length > 0
      ? dedupePath([fromAisle, ...zoneWaypoints, transferPoint, toAisle, toPos])
      : dedupePath([fromAisle, transferPoint, toAisle, toPos]);

  return [
    fromPos,
    ...ensureTerminalPoint(
      applyObstacleDetours(
        fromPos,
        filterBlockedWaypoints(basePath, obstacleFootprints),
        obstacleFootprints,
      ),
      toPos,
    ),
  ];
}

export function buildTransitRoute(fromPos: Vec3, toPos: Vec3, options?: RouteOptions): Vec3[] {
  const zoneWaypoints = options?.zoneWaypoints ?? [];
  const basePath = dedupePath([...zoneWaypoints, toPos]);
  const obstacleFootprints = options?.obstacleFootprints ?? [];
  return [
    fromPos,
    ...ensureTerminalPoint(
      applyObstacleDetours(
        fromPos,
        filterBlockedWaypoints(basePath, obstacleFootprints),
        obstacleFootprints,
      ),
      toPos,
    ),
  ];
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
