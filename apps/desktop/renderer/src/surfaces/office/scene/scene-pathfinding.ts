/**
 * Office floor pathfinding (H1/H2) — a lightweight, pure-JS obstacle-avoidance
 * router so a relocated employee WALKS a route around furniture instead of
 * gliding straight through it.
 *
 * Approach: grid A* over the walkable floor rect with the known obstacle radii
 * (the SAME `obstacleRadius` table the seat planner uses in scene-layout.ts)
 * inflated by a walking-body clearance, then a line-of-sight string-pull that
 * simplifies the cell path back to a handful of waypoints. No dependency, no
 * WASM (recast-navigation is deliberately avoided — its WASM would risk the
 * WKWebView CSP that already needed `wasm-unsafe-eval` for the meshopt decoder),
 * and no per-frame cost: the grid is built once per obstacle set and A* runs
 * only when a movement target changes.
 *
 * The scene stays fail-safe: `findWaypoints` returns `null` (no route) or a
 * single-element `[target]` (straight line) whenever routing is unavailable,
 * unnecessary, or impossible — the caller then keeps the legacy straight-line
 * lerp, so there is zero regression when there are no obstacles.
 */

/** A circular obstacle footprint in world (x, z) coordinates. */
export interface PathObstacle {
  readonly x: number;
  readonly z: number;
  readonly radius: number;
}

/** Walkable floor rect (origin-centered in practice, but any rect works). */
export interface PathfinderBounds {
  readonly minX: number;
  readonly minZ: number;
  readonly maxX: number;
  readonly maxZ: number;
}

export type PathPoint = readonly [number, number];

/** Inclusive floor containment shared by route admission and the A* grid. */
export function pointInsideOfficeBounds(bounds: PathfinderBounds, point: PathPoint): boolean {
  return (
    point[0] >= bounds.minX &&
    point[0] <= bounds.maxX &&
    point[1] >= bounds.minZ &&
    point[1] <= bounds.maxZ
  );
}

/** Grid cell size in world units — office corridors/gaps are ~1u, so 0.6 keeps
 *  narrow passages walkable without an excessive cell count. */
const CELL_SIZE = 0.6;
/** Half-footprint of a walking employee; obstacles inflate by this so a route
 *  keeps the body clear. Deliberately tighter than the seated-clearance the seat
 *  planner uses (0.72) — a moving body threads gaps a parked one would not. */
const AGENT_CLEARANCE = 0.5;
/** Hard cap so a pathological layout can never allocate a runaway grid. */
const MAX_GRID_CELLS = 40_000;
/** Ring radius (in cells) when snapping a blocked start/goal to open floor. */
const SNAP_RING = 6;
/** How close (world units) counts as "reached" for the final approach LOS test. */
const SQRT2 = Math.SQRT2;

/** Minimal binary min-heap over integer cell indices keyed by an f-score. */
class MinHeap {
  private readonly items: number[] = [];
  private readonly keys: number[] = [];

  get size(): number {
    return this.items.length;
  }

  push(item: number, key: number): void {
    this.items.push(item);
    this.keys.push(key);
    let i = this.items.length - 1;
    while (i > 0) {
      const parent = (i - 1) >> 1;
      if (this.keys[parent]! <= this.keys[i]!) break;
      this.swap(i, parent);
      i = parent;
    }
  }

  pop(): number | undefined {
    const n = this.items.length;
    if (n === 0) return undefined;
    const top = this.items[0]!;
    const lastItem = this.items.pop()!;
    const lastKey = this.keys.pop()!;
    if (n > 1) {
      this.items[0] = lastItem;
      this.keys[0] = lastKey;
      let i = 0;
      for (;;) {
        const left = 2 * i + 1;
        const right = 2 * i + 2;
        let smallest = i;
        if (left < this.items.length && this.keys[left]! < this.keys[smallest]!) smallest = left;
        if (right < this.items.length && this.keys[right]! < this.keys[smallest]!) smallest = right;
        if (smallest === i) break;
        this.swap(i, smallest);
        i = smallest;
      }
    }
    return top;
  }

  private swap(a: number, b: number): void {
    const ti = this.items[a]!;
    this.items[a] = this.items[b]!;
    this.items[b] = ti;
    const tk = this.keys[a]!;
    this.keys[a] = this.keys[b]!;
    this.keys[b] = tk;
  }
}

/**
 * A precomputed office pathfinder: the blocked grid is built once (per obstacle
 * set) and reused for every `findWaypoints` query. Construct via
 * `buildOfficePathfinder`, which returns `null` when routing is not worthwhile
 * (no obstacles / degenerate bounds) so callers stay on the straight-line path.
 */
export class OfficePathfinder {
  private readonly cols: number;
  private readonly rows: number;
  private readonly minX: number;
  private readonly minZ: number;
  private readonly cell: number;
  private readonly blocked: Uint8Array;
  private readonly obstacles: readonly PathObstacle[];

  constructor(bounds: PathfinderBounds, obstacles: readonly PathObstacle[], cell: number) {
    this.cell = cell;
    this.minX = bounds.minX;
    this.minZ = bounds.minZ;
    this.cols = Math.max(1, Math.ceil((bounds.maxX - bounds.minX) / cell));
    this.rows = Math.max(1, Math.ceil((bounds.maxZ - bounds.minZ) / cell));
    this.obstacles = obstacles;
    this.blocked = new Uint8Array(this.cols * this.rows);
    // A cell is blocked when its center falls inside any obstacle inflated by
    // the agent clearance. Cell granularity plus center-sampling is the standard
    // grid approximation; the clearance absorbs the half-cell error.
    for (let r = 0; r < this.rows; r += 1) {
      const cz = this.minZ + (r + 0.5) * cell;
      for (let c = 0; c < this.cols; c += 1) {
        const cx = this.minX + (c + 0.5) * cell;
        if (!pointInsideOfficeBounds(bounds, [cx, cz]) || this.pointBlocked(cx, cz)) {
          this.blocked[r * this.cols + c] = 1;
        }
      }
    }
  }

  /** True when a world point sits inside any inflated obstacle. */
  private pointBlocked(x: number, z: number): boolean {
    for (const o of this.obstacles) {
      const dx = x - o.x;
      const dz = z - o.z;
      const rr = o.radius + AGENT_CLEARANCE;
      if (dx * dx + dz * dz < rr * rr) return true;
    }
    return false;
  }

  private clampCol(c: number): number {
    return c < 0 ? 0 : c >= this.cols ? this.cols - 1 : c;
  }

  private clampRow(r: number): number {
    return r < 0 ? 0 : r >= this.rows ? this.rows - 1 : r;
  }

  private colOf(x: number): number {
    return this.clampCol(Math.floor((x - this.minX) / this.cell));
  }

  private rowOf(z: number): number {
    return this.clampRow(Math.floor((z - this.minZ) / this.cell));
  }

  private cellCenter(c: number, r: number): PathPoint {
    return [this.minX + (c + 0.5) * this.cell, this.minZ + (r + 0.5) * this.cell];
  }

  private isBlocked(c: number, r: number): boolean {
    return this.blocked[r * this.cols + c] === 1;
  }

  /**
   * Circle-based line-of-sight: true when the straight segment (ax,az)→(bx,bz)
   * clears every inflated obstacle. Used both for the fast straight-line early
   * exit and for string-pulling the A* cell path down to minimal waypoints, so
   * smoothing can never pull a segment back through an obstacle.
   */
  clearLineOfSight(ax: number, az: number, bx: number, bz: number): boolean {
    const dx = bx - ax;
    const dz = bz - az;
    const length = Math.hypot(dx, dz);
    if (length < 1e-6) return !this.pointBlocked(ax, az);
    for (const o of this.obstacles) {
      const rr = o.radius + AGENT_CLEARANCE;
      // Closest approach of the obstacle center to the segment (clamped t).
      const t = clamp(((o.x - ax) * dx + (o.z - az) * dz) / (length * length), 0, 1);
      const px = ax + dx * t;
      const pz = az + dz * t;
      const ddx = px - o.x;
      const ddz = pz - o.z;
      if (ddx * ddx + ddz * ddz < rr * rr) return false;
    }
    return true;
  }

  /** Nearest open cell within {@link SNAP_RING} of (c,r); the cell itself if free. */
  private nearestFreeCell(c: number, r: number): [number, number] | null {
    if (!this.isBlocked(c, r)) return [c, r];
    for (let ring = 1; ring <= SNAP_RING; ring += 1) {
      for (let dr = -ring; dr <= ring; dr += 1) {
        for (let dc = -ring; dc <= ring; dc += 1) {
          if (Math.max(Math.abs(dr), Math.abs(dc)) !== ring) continue;
          const nc = c + dc;
          const nr = r + dr;
          if (nc < 0 || nc >= this.cols || nr < 0 || nr >= this.rows) continue;
          if (!this.isBlocked(nc, nr)) return [nc, nr];
        }
      }
    }
    return null;
  }

  /**
   * Plan a walking route from `start` to `target`, both in world (x, z).
   * Returns the ordered waypoints to walk to (excluding the start, ending at the
   * exact target), or:
   *  - `[target]` when the straight line is already clear (the common case), and
   *  - `null` when no route exists — the caller falls back to the straight lerp.
   */
  findWaypoints(start: PathPoint, target: PathPoint): PathPoint[] | null {
    const [sx, sz] = start;
    const [tx, tz] = target;
    // Fast path: an unobstructed straight shot needs no routing.
    if (this.clearLineOfSight(sx, sz, tx, tz)) return [target];

    const startCellRaw: [number, number] = [this.colOf(sx), this.rowOf(sz)];
    const goalCellRaw: [number, number] = [this.colOf(tx), this.rowOf(tz)];
    const startCell = this.nearestFreeCell(startCellRaw[0], startCellRaw[1]) ?? startCellRaw;
    const goalCell = this.nearestFreeCell(goalCellRaw[0], goalCellRaw[1]) ?? goalCellRaw;

    const cellPath = this.aStar(startCell, goalCell);
    if (!cellPath) return null;

    // World-space anchors for string pulling: real start + the A*-reachable cell
    // centers (all obstacle-free). Smoothing collapses the grid staircase into a
    // few natural corners, ending at the GOAL CELL center. The exact target is
    // appended AFTER smoothing as a final short step so it never participates in
    // string-pull — otherwise a target that snapped out of a blocked cell could
    // collapse into a long leg that crosses the furniture it sits against
    // (only the sub-cell goal-cell→target hop enters the target's own cell).
    const points: PathPoint[] = [start];
    for (const [c, r] of cellPath) points.push(this.cellCenter(c, r));
    const route = this.smooth(points);
    const tail = route[route.length - 1];
    if (!tail || tail[0] !== tx || tail[1] !== tz) route.push(target);
    return route;
  }

  /** A* over the 8-connected blocked grid; diagonals may not cut obstacle corners. */
  private aStar(from: [number, number], to: [number, number]): [number, number][] | null {
    const [fc, fr] = from;
    const [tc, tr] = to;
    const total = this.cols * this.rows;
    const fromIdx = fr * this.cols + fc;
    const toIdx = tr * this.cols + tc;
    if (fromIdx === toIdx) return [to];

    const gScore = new Float64Array(total).fill(Number.POSITIVE_INFINITY);
    const cameFrom = new Int32Array(total).fill(-1);
    const closed = new Uint8Array(total);
    const open = new MinHeap();
    gScore[fromIdx] = 0;
    open.push(fromIdx, this.heuristic(fc, fr, tc, tr));

    while (open.size > 0) {
      const current = open.pop()!;
      if (current === toIdx) return this.reconstruct(cameFrom, current);
      if (closed[current] === 1) continue;
      closed[current] = 1;
      const cc = current % this.cols;
      const cr = (current - cc) / this.cols;
      for (let dr = -1; dr <= 1; dr += 1) {
        for (let dc = -1; dc <= 1; dc += 1) {
          if (dc === 0 && dr === 0) continue;
          const nc = cc + dc;
          const nr = cr + dr;
          if (nc < 0 || nc >= this.cols || nr < 0 || nr >= this.rows) continue;
          const nIdx = nr * this.cols + nc;
          // The goal cell is always enterable even if it snapped onto a blocked
          // cell; every other blocked cell is impassable.
          if (nIdx !== toIdx && this.blocked[nIdx] === 1) continue;
          if (closed[nIdx] === 1) continue;
          if (dc !== 0 && dr !== 0) {
            // No corner cutting: both orthogonal neighbors must be open.
            if (this.blocked[cr * this.cols + nc] === 1) continue;
            if (this.blocked[nr * this.cols + cc] === 1) continue;
          }
          const step = dc !== 0 && dr !== 0 ? SQRT2 : 1;
          const tentative = gScore[current]! + step;
          if (tentative >= gScore[nIdx]!) continue;
          gScore[nIdx] = tentative;
          cameFrom[nIdx] = current;
          open.push(nIdx, tentative + this.heuristic(nc, nr, tc, tr));
        }
      }
    }
    return null;
  }

  /** Octile distance — admissible for 8-connected grids with √2 diagonals. */
  private heuristic(c: number, r: number, tc: number, tr: number): number {
    const dc = Math.abs(c - tc);
    const dr = Math.abs(r - tr);
    return Math.max(dc, dr) + (SQRT2 - 1) * Math.min(dc, dr);
  }

  private reconstruct(cameFrom: Int32Array, endIdx: number): [number, number][] {
    const path: [number, number][] = [];
    let idx = endIdx;
    while (idx !== -1) {
      const c = idx % this.cols;
      const r = (idx - c) / this.cols;
      path.push([c, r]);
      idx = cameFrom[idx]!;
    }
    path.reverse();
    return path;
  }

  /**
   * Greedy line-of-sight string pull: keep a waypoint only when the current
   * anchor cannot see the NEXT point past it, always ending at the exact target.
   * Drops the start point (it is where the actor already stands).
   */
  private smooth(points: PathPoint[]): PathPoint[] {
    if (points.length <= 2) return [points[points.length - 1]!];
    const out: PathPoint[] = [];
    let anchor = points[0]!;
    for (let i = 1; i < points.length - 1; i += 1) {
      const next = points[i + 1]!;
      if (!this.clearLineOfSight(anchor[0], anchor[1], next[0], next[1])) {
        out.push(points[i]!);
        anchor = points[i]!;
      }
    }
    out.push(points[points.length - 1]!);
    return out;
  }
}

/**
 * Measure the exact production A* route used by EmployeeUnit. A null result is
 * a real no-route decision; callers must not schedule a timed choreography that
 * the character cannot perform. Non-furniture destinations must also be open
 * floor, while a shelf/cooler/home anchor may intentionally touch an inflated
 * fixture footprint and use the router's snapped final approach.
 */
export function measureOfficeRouteDistance(
  pathfinder: OfficePathfinder | null,
  start: PathPoint,
  target: PathPoint,
  allowBlockedTarget: boolean,
): number | null {
  if (!pathfinder) return Math.hypot(target[0] - start[0], target[1] - start[1]);
  if (
    !allowBlockedTarget &&
    !pathfinder.clearLineOfSight(target[0], target[1], target[0], target[1])
  ) {
    return null;
  }
  const waypoints = pathfinder.findWaypoints(start, target);
  if (!waypoints) return null;
  let distance = 0;
  let prior = start;
  for (const waypoint of waypoints) {
    distance += Math.hypot(waypoint[0] - prior[0], waypoint[1] - prior[1]);
    prior = waypoint;
  }
  return distance;
}

/**
 * Route-admission contract for authored floor destinations. An actor may start
 * outside the floor after a raw drag and must still be able to walk home, but
 * no new staging target may be scheduled outside the floor rectangle.
 */
export function measureOfficeRouteWithinBounds(
  bounds: PathfinderBounds,
  pathfinder: OfficePathfinder | null,
  start: PathPoint,
  target: PathPoint,
  allowBlockedTarget: boolean,
): number | null {
  return pointInsideOfficeBounds(bounds, target)
    ? measureOfficeRouteDistance(pathfinder, start, target, allowBlockedTarget)
    : null;
}

function clamp(value: number, min: number, max: number): number {
  return value < min ? min : value > max ? max : value;
}

/**
 * Build an {@link OfficePathfinder} for a floor rect + obstacle set, or `null`
 * when routing is not worthwhile (no obstacles, or a degenerate/oversized grid).
 * A `null` planner keeps the scene on its straight-line lerp with zero cost.
 */
export function buildOfficePathfinder(
  bounds: PathfinderBounds,
  obstacles: readonly PathObstacle[],
  cell: number = CELL_SIZE,
): OfficePathfinder | null {
  if (obstacles.length === 0) return null;
  const width = bounds.maxX - bounds.minX;
  const depth = bounds.maxZ - bounds.minZ;
  if (!(width > 0) || !(depth > 0)) return null;
  const effectiveCell = Math.max(cell, Math.sqrt((width * depth) / MAX_GRID_CELLS));
  return new OfficePathfinder(bounds, obstacles, effectiveCell);
}
