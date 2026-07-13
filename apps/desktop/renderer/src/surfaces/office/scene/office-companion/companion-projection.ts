import type { SceneCueFrame } from '@/assistant/runtime/scene-cue-projection.js';
import type { DramaturgyMode } from '@offisim/shared-types';
import type { ZoneDef } from '../scene-layout.js';
import type { OfficePathfinder, PathPoint } from '../scene-pathfinding.js';

const OFFICE_COMPANION_STATES = [
  'idle',
  'run',
  'inspect',
  'greet',
  'celebrate',
  'concerned',
  'rest',
  'pause',
  'work-watch',
] as const;

type OfficeCompanionState = (typeof OFFICE_COMPANION_STATES)[number];

export interface OfficeCompanionPoint {
  readonly x: number;
  readonly z: number;
}

export interface OfficeCompanionPlanInput {
  readonly enabled: boolean;
  readonly companyId: string;
  readonly projectId: string;
  readonly nowMs: number;
  readonly mode: DramaturgyMode;
  readonly reducedMotion: boolean;
  readonly geometryRevision: string;
  readonly frame: SceneCueFrame;
  readonly candidates: readonly OfficeCompanionPoint[];
  readonly occupiedPoints: readonly OfficeCompanionPoint[];
  readonly actorPositions: ReadonlyMap<string, OfficeCompanionPoint>;
  /** Precomputed with officeCompanionSpatialRevision for render-loop callers. */
  readonly spatialRevision?: string;
  readonly deliveryPoint?: OfficeCompanionPoint;
  readonly pathfinder: Pick<OfficePathfinder, 'findWaypoints'> | null;
}

export interface OfficeCompanionPlan {
  readonly key: string;
  readonly visible: boolean;
  readonly segmentStartedAt: number;
  readonly segmentDurationMs: number;
  readonly fixedState: OfficeCompanionState | null;
  readonly path: readonly OfficeCompanionPoint[];
  readonly pathLength: number;
  readonly facing: -1 | 1;
  readonly static: boolean;
  readonly nextWakeAt: number | null;
}

export interface OfficeCompanionPresentation {
  readonly visible: boolean;
  readonly state: OfficeCompanionState;
  readonly x: number;
  readonly z: number;
  readonly facing: -1 | 1;
  readonly moving: boolean;
  readonly static: boolean;
  readonly nextWakeAt: number | null;
}

interface CompanionSignal {
  readonly state: Exclude<OfficeCompanionState, 'idle' | 'run' | 'pause' | 'rest'> | null;
  readonly focusEmployeeId: string | null;
  readonly focusDelivery: boolean;
}

const SEGMENT_DURATION_MS = 8_000;
const TRAVEL_START = 0.12;
const TRAVEL_END = 0.88;
const EMPLOYEE_CLEARANCE = 2.2;
export const OFFICE_COMPANION_ROUTE_CLEARANCE = 1.35;
const DETOUR_CANDIDATE_BUDGET = 16;
const MAX_ROUTE_LEGS = 3;

function stableHash(value: string): number {
  let hash = 2_166_136_261;
  for (let index = 0; index < value.length; index += 1) {
    hash ^= value.charCodeAt(index);
    hash = Math.imul(hash, 16_777_619);
  }
  return hash >>> 0;
}

function pointDistance(left: OfficeCompanionPoint, right: OfficeCompanionPoint): number {
  return Math.hypot(left.x - right.x, left.z - right.z);
}

function pointKey(point: OfficeCompanionPoint): string {
  return `${point.x.toFixed(3)}:${point.z.toFixed(3)}`;
}

function companionSignal(frame: SceneCueFrame): CompanionSignal {
  const blocked = frame.actors.find((actor) => actor.status === 'blocked');
  const resourceOwner = frame.resources[0]?.employeeId ?? null;
  const failureFlow = frame.flows.find((flow) => flow.kind === 'failure' || flow.ink === 'risk');
  if (resourceOwner || blocked || failureFlow) {
    return {
      state: 'concerned',
      focusEmployeeId: resourceOwner ?? blocked?.employeeId ?? failureFlow?.employeeId ?? null,
      focusDelivery: false,
    };
  }

  const approval = frame.actors.find((actor) => actor.status === 'approval');
  if (approval) {
    return { state: 'inspect', focusEmployeeId: approval.employeeId, focusDelivery: false };
  }

  if (frame.delivery.latest) {
    return { state: 'greet', focusEmployeeId: null, focusDelivery: true };
  }

  const happy = frame.actors.find((actor) => actor.performance?.expression === 'happy');
  if (happy) {
    return {
      state: 'celebrate',
      focusEmployeeId: happy.employeeId,
      focusDelivery: false,
    };
  }

  const working = frame.actors.find(
    (actor) =>
      actor.running ||
      actor.status === 'working' ||
      (actor.performance !== null && actor.performance.workGesture !== 'none'),
  );
  if (working) {
    return { state: 'work-watch', focusEmployeeId: working.employeeId, focusDelivery: false };
  }

  return { state: null, focusEmployeeId: null, focusDelivery: false };
}

function cycleCandidateIndex(seed: string, tick: number, count: number): number {
  if (count === 0) return 0;
  return (stableHash(seed) + (tick % count) + count) % count;
}

function nearestCandidate(
  candidates: readonly OfficeCompanionPoint[],
  target: OfficeCompanionPoint | undefined,
  fallbackIndex: number,
): OfficeCompanionPoint {
  if (!target) return candidates[fallbackIndex] ?? candidates[0] ?? { x: 0, z: 0 };
  return (
    [...candidates].sort(
      (left, right) =>
        pointDistance(left, target) - pointDistance(right, target) ||
        left.x - right.x ||
        left.z - right.z,
    )[0] ?? target
  );
}

function routeLength(path: readonly OfficeCompanionPoint[]): number {
  let total = 0;
  for (let index = 1; index < path.length; index += 1) {
    const from = path[index - 1];
    const to = path[index];
    if (from && to) total += pointDistance(from, to);
  }
  return total;
}

function pointSegmentDistance(
  point: OfficeCompanionPoint,
  from: OfficeCompanionPoint,
  to: OfficeCompanionPoint,
): number {
  const dx = to.x - from.x;
  const dz = to.z - from.z;
  const lengthSquared = dx * dx + dz * dz;
  if (lengthSquared <= 0) return pointDistance(point, from);
  const progress = Math.max(
    0,
    Math.min(1, ((point.x - from.x) * dx + (point.z - from.z) * dz) / lengthSquared),
  );
  return Math.hypot(point.x - (from.x + dx * progress), point.z - (from.z + dz * progress));
}

function routeIsClear(
  path: readonly OfficeCompanionPoint[],
  occupiedPoints: readonly OfficeCompanionPoint[],
): boolean {
  for (let index = 1; index < path.length; index += 1) {
    const from = path[index - 1];
    const to = path[index];
    if (!from || !to) continue;
    if (
      occupiedPoints.some(
        (occupied) => pointSegmentDistance(occupied, from, to) < OFFICE_COMPANION_ROUTE_CLEARANCE,
      )
    ) {
      return false;
    }
  }
  return true;
}

function routeBetween(
  from: OfficeCompanionPoint,
  to: OfficeCompanionPoint,
  pathfinder: OfficeCompanionPlanInput['pathfinder'],
): readonly OfficeCompanionPoint[] | null {
  if (pointDistance(from, to) < 0.01) return [from];
  if (!pathfinder) return [from, to];
  const waypoints = pathfinder.findWaypoints(
    [from.x, from.z] as PathPoint,
    [to.x, to.z] as PathPoint,
  );
  if (!waypoints) return null;
  return [from, ...waypoints.map(([x, z]) => ({ x, z }))];
}

function safeSerializableRoute(
  from: OfficeCompanionPoint,
  to: OfficeCompanionPoint,
  candidates: readonly OfficeCompanionPoint[],
  occupiedPoints: readonly OfficeCompanionPoint[],
  pathfinder: OfficeCompanionPlanInput['pathfinder'],
): readonly OfficeCompanionPoint[] | null {
  const direct = routeBetween(from, to, pathfinder);
  if (direct && routeIsClear(direct, occupiedPoints)) return direct;

  const detours = candidates
    .filter(
      (candidate) => pointDistance(candidate, from) >= 0.01 && pointDistance(candidate, to) >= 0.01,
    )
    .sort(
      (left, right) =>
        pointDistance(left, from) +
          pointDistance(left, to) -
          pointDistance(right, from) -
          pointDistance(right, to) ||
        left.x - right.x ||
        left.z - right.z,
    )
    .slice(0, DETOUR_CANDIDATE_BUDGET);
  const routeCache = new Map<string, readonly OfficeCompanionPoint[] | null>();
  routeCache.set(`${pointKey(from)}>${pointKey(to)}`, null);
  const safeLeg = (
    start: OfficeCompanionPoint,
    end: OfficeCompanionPoint,
  ): readonly OfficeCompanionPoint[] | null => {
    const key = `${pointKey(start)}>${pointKey(end)}`;
    if (routeCache.has(key)) return routeCache.get(key) ?? null;
    const route = routeBetween(start, end, pathfinder);
    const safe = route && routeIsClear(route, occupiedPoints) ? route : null;
    routeCache.set(key, safe);
    return safe;
  };
  const queue: Array<{
    readonly point: OfficeCompanionPoint;
    readonly path: readonly OfficeCompanionPoint[];
    readonly legs: number;
  }> = [{ point: from, path: [from], legs: 0 }];
  const visited = new Set([pointKey(from)]);
  while (queue.length > 0) {
    const current = queue.shift();
    if (!current) break;
    const nextPoints = [to, ...detours];
    for (const next of nextPoints) {
      if (pointDistance(current.point, next) < 0.01) continue;
      const leg = safeLeg(current.point, next);
      if (!leg) continue;
      const path = [...current.path, ...leg.slice(1)];
      if (pointDistance(next, to) < 0.01) return path;
      const legs = current.legs + 1;
      const key = pointKey(next);
      if (legs >= MAX_ROUTE_LEGS || visited.has(key)) continue;
      visited.add(key);
      queue.push({ point: next, path, legs });
    }
  }
  return null;
}

export function buildOfficeCompanionCandidates(
  zoneDefs: readonly ZoneDef[],
  occupied: readonly OfficeCompanionPoint[],
  pathfinder: Pick<OfficePathfinder, 'clearLineOfSight'> | null,
): readonly OfficeCompanionPoint[] {
  const raw: Array<{ readonly point: OfficeCompanionPoint; readonly clearance: number }> = [];
  for (const zone of [...zoneDefs].sort((left, right) => left.id.localeCompare(right.id))) {
    const offsets = [-0.46, 0, 0.46] as const;
    const clearance = Math.min(
      EMPLOYEE_CLEARANCE,
      Math.max(OFFICE_COMPANION_ROUTE_CLEARANCE, Math.min(zone.w, zone.d) * 0.4),
    );
    for (const ox of offsets) {
      for (const oz of offsets) {
        raw.push({ point: { x: zone.cx + zone.w * ox, z: zone.cz + zone.d * oz }, clearance });
      }
    }
  }

  const unique = new Map<string, OfficeCompanionPoint>();
  for (const { point, clearance } of raw) {
    if (!Number.isFinite(point.x) || !Number.isFinite(point.z)) continue;
    if (occupied.some((item) => pointDistance(point, item) < clearance)) continue;
    if (pathfinder && !pathfinder.clearLineOfSight(point.x, point.z, point.x, point.z)) continue;
    unique.set(pointKey(point), point);
  }
  return [...unique.values()].sort((left, right) => left.x - right.x || left.z - right.z);
}

export function officeCompanionOccupiedPoints(
  frame: SceneCueFrame,
  actorPositions: ReadonlyMap<string, OfficeCompanionPoint>,
  deliveryPoint?: OfficeCompanionPoint,
): readonly OfficeCompanionPoint[] {
  const occupied = new Map<string, OfficeCompanionPoint>();
  for (const point of actorPositions.values()) occupied.set(pointKey(point), point);
  for (const actor of frame.actors) {
    const staging = actor.staging;
    if (staging && staging.x !== null && staging.z !== null) {
      const point = { x: staging.x, z: staging.z };
      occupied.set(pointKey(point), point);
    }
  }
  if (frame.delivery.latest && deliveryPoint) occupied.set(pointKey(deliveryPoint), deliveryPoint);
  return [...occupied.values()].sort((left, right) => left.x - right.x || left.z - right.z);
}

export function officeCompanionSpatialRevision(
  candidates: readonly OfficeCompanionPoint[],
  occupiedPoints: readonly OfficeCompanionPoint[],
  actorPositions: ReadonlyMap<string, OfficeCompanionPoint>,
): string {
  const candidateSignature = [...candidates]
    .sort((left, right) => left.x - right.x || left.z - right.z)
    .map(pointKey)
    .join(';');
  const occupiedSignature = [...occupiedPoints]
    .sort((left, right) => left.x - right.x || left.z - right.z)
    .map(pointKey)
    .join(';');
  const actorSignature = [...actorPositions.entries()]
    .sort(([left], [right]) => left.localeCompare(right))
    .map(([employeeId, point]) => `${employeeId}:${pointKey(point)}`)
    .join(';');
  return `${candidateSignature}|${occupiedSignature}|${actorSignature}`;
}

export function officeCompanionPlanKey(input: OfficeCompanionPlanInput): string {
  const signal = companionSignal(input.frame);
  const tick = Math.floor(input.nowMs / SEGMENT_DURATION_MS);
  const spatialRevision =
    input.spatialRevision ??
    officeCompanionSpatialRevision(input.candidates, input.occupiedPoints, input.actorPositions);
  return [
    input.enabled ? 'on' : 'off',
    input.companyId,
    input.projectId,
    input.geometryRevision,
    input.mode,
    input.reducedMotion ? 'reduced' : 'motion',
    signal.state ?? 'quiet',
    signal.focusEmployeeId ?? '-',
    signal.focusDelivery ? 'delivery' : '-',
    spatialRevision,
    input.reducedMotion || input.mode === 'focus' || signal.state ? 'fixed' : tick,
  ].join('|');
}

export function createOfficeCompanionPlan(input: OfficeCompanionPlanInput): OfficeCompanionPlan {
  const key = officeCompanionPlanKey(input);
  if (!input.enabled || !input.companyId || !input.projectId || input.candidates.length === 0) {
    return {
      key,
      visible: false,
      segmentStartedAt: input.nowMs,
      segmentDurationMs: SEGMENT_DURATION_MS,
      fixedState: 'idle',
      path: [],
      pathLength: 0,
      facing: 1,
      static: true,
      nextWakeAt: null,
    };
  }

  const seed = `${input.companyId}::${input.projectId}::codex-companion-v1`;
  const tick = Math.floor(input.nowMs / SEGMENT_DURATION_MS);
  const signal = companionSignal(input.frame);
  const fixed = input.reducedMotion || input.mode === 'focus' || signal.state !== null;
  const candidates = [...input.candidates].sort(
    (left, right) => left.x - right.x || left.z - right.z,
  );
  const fallbackIndex = cycleCandidateIndex(seed, fixed ? 0 : tick, candidates.length);
  const focus = signal.focusDelivery
    ? input.deliveryPoint
    : signal.focusEmployeeId
      ? input.actorPositions.get(signal.focusEmployeeId)
      : undefined;
  const from = nearestCandidate(candidates, fixed ? focus : undefined, fallbackIndex);

  if (fixed) {
    return {
      key,
      visible: true,
      segmentStartedAt: Math.floor(input.nowMs / SEGMENT_DURATION_MS) * SEGMENT_DURATION_MS,
      segmentDurationMs: SEGMENT_DURATION_MS,
      fixedState: signal.state ?? 'idle',
      path: [from],
      pathLength: 0,
      facing: 1,
      static: true,
      nextWakeAt: null,
    };
  }

  const nextIndex = cycleCandidateIndex(seed, tick + 1, candidates.length);
  const to = candidates[nextIndex] ?? from;
  const path = safeSerializableRoute(from, to, candidates, input.occupiedPoints, input.pathfinder);
  if (!path) {
    return {
      key,
      visible: false,
      segmentStartedAt: tick * SEGMENT_DURATION_MS,
      segmentDurationMs: SEGMENT_DURATION_MS,
      fixedState: 'pause',
      path: [],
      pathLength: 0,
      facing: 1,
      static: true,
      nextWakeAt: (tick + 1) * SEGMENT_DURATION_MS,
    };
  }
  const pathLength = routeLength(path);
  const quietState: OfficeCompanionState | null =
    tick % 7 === 0 ? 'rest' : tick % 5 === 0 ? 'idle' : null;
  const facing = (path[path.length - 1]?.x ?? from.x) < from.x ? -1 : 1;

  return {
    key,
    visible: true,
    segmentStartedAt: tick * SEGMENT_DURATION_MS,
    segmentDurationMs: SEGMENT_DURATION_MS,
    fixedState: quietState,
    path,
    pathLength,
    facing,
    static: pathLength < 0.01,
    nextWakeAt: (tick + 1) * SEGMENT_DURATION_MS,
  };
}

function samplePath(
  path: readonly OfficeCompanionPoint[],
  totalLength: number,
  progress: number,
): OfficeCompanionPoint {
  const first = path[0] ?? { x: 0, z: 0 };
  if (path.length < 2 || totalLength <= 0) return first;
  let remaining = totalLength * progress;
  for (let index = 1; index < path.length; index += 1) {
    const from = path[index - 1];
    const to = path[index];
    if (!from || !to) continue;
    const length = pointDistance(from, to);
    if (remaining <= length || index === path.length - 1) {
      const t = length <= 0 ? 1 : Math.min(1, remaining / length);
      return { x: from.x + (to.x - from.x) * t, z: from.z + (to.z - from.z) * t };
    }
    remaining -= length;
  }
  return path[path.length - 1] ?? first;
}

export function sampleOfficeCompanionPlan(
  plan: OfficeCompanionPlan,
  nowMs: number,
): OfficeCompanionPresentation {
  if (!plan.visible || plan.path.length === 0) {
    return {
      visible: false,
      state: 'idle',
      x: 0,
      z: 0,
      facing: 1,
      moving: false,
      static: true,
      nextWakeAt: null,
    };
  }

  const raw = Math.max(0, Math.min(1, (nowMs - plan.segmentStartedAt) / plan.segmentDurationMs));
  const travel = Math.max(0, Math.min(1, (raw - TRAVEL_START) / (TRAVEL_END - TRAVEL_START)));
  const eased = travel * travel * (3 - 2 * travel);
  const point = samplePath(plan.path, plan.pathLength, eased);
  const moving = !plan.static && raw >= TRAVEL_START && raw <= TRAVEL_END;
  const state = moving ? 'run' : (plan.fixedState ?? 'pause');

  return {
    visible: true,
    state,
    x: point.x,
    z: point.z,
    facing: plan.facing,
    moving,
    static: plan.static,
    nextWakeAt: plan.nextWakeAt,
  };
}
