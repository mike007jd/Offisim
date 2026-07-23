import { readFile } from 'node:fs/promises';
import {
  type SceneCueInput,
  actorAcceptsAmbientCue,
  ambientDirectionsForAvailableActors,
  applyAmbientCues,
  projectSceneCues,
} from '../apps/desktop/renderer/src/assistant/runtime/scene-cue-projection.js';
import { clipForPerformance } from '../apps/desktop/renderer/src/surfaces/office/scene/character/clip-map.js';
import {
  buildOfficePathfinder,
  measureOfficeRouteDistance,
  measureOfficeRouteWithinBounds,
  pointInsideOfficeBounds,
} from '../apps/desktop/renderer/src/surfaces/office/scene/scene-pathfinding.js';
import {
  AMBIENT_SCHEDULER_VERSION,
  AMBIENT_TIMING,
  type AmbientActivity,
  type AmbientActorAvailability,
  type AmbientActorHome,
  type AmbientRoutePlanner,
  type AmbientRoutineKind,
  type AmbientSchedulerInput,
  type AmbientSchedulerSnapshot,
  type AmbientSchedulerState,
  CHARACTER_WALK_SPEED_UNITS_PER_SECOND,
  type StagingPrefab,
  advanceAmbientScheduler,
  ambientPolicyForMode,
  performanceForRoutine,
  worldAnchorsFor,
} from '../packages/dramaturgy/src/index.js';

/**
 * Office Toy Performance P5 oracle — deterministic ambient life.
 *
 * Exercises the production pure reducer at exact due/phase boundaries, then
 * verifies the renderer's synchronous real-run preemption seam. No wall-clock
 * sleeps, debug acceleration, source-local test framework or probabilistic
 * assertion is involved.
 */

const ROOT = new URL('../', import.meta.url);
const START = 1_000_000;
const OFFICE_POLICY = ambientPolicyForMode('office');

let checks = 0;
let failures = 0;

function check(name: string, condition: unknown, detail = ''): void {
  checks += 1;
  if (condition) {
    console.log(`  PASS ${name}`);
    return;
  }
  failures += 1;
  console.error(`  FAIL ${name}${detail ? ` — ${detail}` : ''}`);
}

function json(value: unknown): string {
  return JSON.stringify(value);
}

function employees(count: number): AmbientActorAvailability[] {
  return Array.from({ length: count }, (_, index) => ({
    employeeId: `employee-${String(index + 1).padStart(2, '0')}`,
    busy: false,
  }));
}

function homes(count: number): AmbientActorHome[] {
  return Array.from({ length: count }, (_, index) => ({
    employeeId: `employee-${String(index + 1).padStart(2, '0')}`,
    x: (index % 4) * 2.4 - 3.6,
    z: Math.floor(index / 4) * 2.4 - 2.4,
    facing: index % 2 === 0 ? 180 : 0,
    posture: 'sitting' as const,
  }));
}

const PREFABS: readonly StagingPrefab[] = [
  { instanceId: 'water-a', prefabId: 'water-cooler', x: 7, z: -4, rotation: 0 },
  { instanceId: 'shelf-a', prefabId: 'bookshelf-double', x: -7, z: -4, rotation: 0 },
  { instanceId: 'shelf-b', prefabId: 'bookshelf-double', x: 0, z: 6, rotation: 180 },
];
const STRAIGHT_ROUTE_FOR: AmbientRoutePlanner = ({ from, to }) => ({
  distance: Math.hypot(to.x - from.x, to.z - from.z),
});

function input(
  now: number,
  options: Partial<Omit<AmbientSchedulerInput, 'now'>> = {},
): AmbientSchedulerInput {
  return {
    seed: 'company-p5::project-p5',
    now,
    actors: employees(8),
    homes: homes(8),
    prefabs: PREFABS,
    policy: OFFICE_POLICY,
    routeFor: STRAIGHT_ROUTE_FOR,
    routeSignature: 'harness-straight-v1',
    ...options,
  };
}

function step(
  state: AmbientSchedulerState | null,
  now: number,
  options: Partial<Omit<AmbientSchedulerInput, 'now'>> = {},
): AmbientSchedulerSnapshot {
  return advanceAmbientScheduler(state, input(now, options));
}

function plannerFor(pathfinder: ReturnType<typeof buildOfficePathfinder>): AmbientRoutePlanner {
  return ({ from, to, allowBlockedTarget }) => {
    const distance = measureOfficeRouteDistance(
      pathfinder,
      [from.x, from.z],
      [to.x, to.z],
      allowBlockedTarget,
    );
    return distance === null ? null : { distance };
  };
}

function firstActivity(
  kind: AmbientRoutineKind,
  options: Partial<Omit<AmbientSchedulerInput, 'now' | 'seed'>> = {},
): {
  snapshot: AmbientSchedulerSnapshot;
  activity: AmbientActivity;
} {
  for (let seedIndex = 0; seedIndex < 500; seedIndex += 1) {
    const seed = `p5-phase-${kind}-${seedIndex}`;
    let snapshot = step(null, START, { ...options, seed });
    let guard = 0;
    while (snapshot.nextWakeAt <= START + 30 * 60_000 && guard < 10_000) {
      snapshot = step(snapshot.state, snapshot.nextWakeAt, { ...options, seed });
      const activity = snapshot.state.activities.find((candidate) => candidate.routine === kind);
      if (activity) return { snapshot, activity };
      guard += 1;
    }
  }
  throw new Error(`Unable to find seeded ${kind} activity`);
}

function advanceTo(
  snapshot: AmbientSchedulerSnapshot,
  targetAt: number,
  options: Partial<Omit<AmbientSchedulerInput, 'now'>> = {},
): AmbientSchedulerSnapshot {
  let current = snapshot;
  let guard = 0;
  while (current.nextWakeAt < targetAt && guard < 10_000) {
    current = step(current.state, current.nextWakeAt, options);
    guard += 1;
  }
  if (guard >= 10_000) throw new Error(`advanceTo exceeded guard before ${targetAt}`);
  return current.state.lastAdvancedAt === targetAt
    ? current
    : step(current.state, targetAt, options);
}

console.log('office-ambient-p5 gate');

console.log('\n[policy] explicit mode budgets');
check(
  'focus disables the full low-frequency layer',
  json(ambientPolicyForMode('focus')) === json({ enabled: false, maxAway: 0, maxActiveActors: 0 }),
  json(ambientPolicyForMode('focus')),
);
check(
  'office owns the hard two-away / four-active budget',
  json(OFFICE_POLICY) === json({ enabled: true, maxAway: 2, maxActiveActors: 4 }),
  json(OFFICE_POLICY),
);
check(
  'cinematic relaxation is explicit and bounded',
  json(ambientPolicyForMode('cinematic')) ===
    json({ enabled: true, maxAway: 3, maxActiveActors: 6 }),
  json(ambientPolicyForMode('cinematic')),
);
check(
  'reduced motion overrides cinematic and disables ambience',
  ambientPolicyForMode('cinematic', true).enabled === false,
  json(ambientPolicyForMode('cinematic', true)),
);

console.log('\n[determinism] schedule identity and restart');
const initial = step(null, START);
const replay = step(null, START);
check(
  'same seed/input creates byte-identical non-empty schedule',
  initial.state.clocks.length === 8 && json(initial) === json(replay),
  json(initial.state.clocks),
);
const reversed = step(null, START, {
  actors: [...employees(8)].reverse(),
  homes: [...homes(8)].reverse(),
  prefabs: [...PREFABS].reverse(),
});
check(
  'roster/home/prefab input order cannot change canonical state',
  json(initial) === json(reversed),
);
const anotherSeed = step(null, START, { seed: 'company-p5::different-project' });
check(
  'different seed changes at least one due decision',
  initial.state.clocks.some(
    (clock, index) => clock.nextDueAt !== anotherSeed.state.clocks[index]?.nextDueAt,
  ),
);
const expanded = step(initial.state, START, {
  actors: employees(9),
  homes: homes(9),
});
check(
  'adding an unrelated employee preserves every incumbent clock',
  json(expanded.state.clocks.slice(0, 8)) === json(initial.state.clocks),
  json(expanded.state.clocks),
);
const firstDue = Math.min(...initial.state.clocks.map((clock) => clock.nextDueAt));
const uninterrupted = step(initial.state, firstDue);
const restoredState = JSON.parse(json(initial.state)) as AmbientSchedulerState;
const restored = step(restoredState, firstDue);
check('JSON restart continues byte-identically', json(uninterrupted) === json(restored));

console.log('\n[cadence] due/attempt contract without catch-up');
check(
  'scheduler state version is office-ambient-v2',
  initial.state.version === 'office-ambient-v2' &&
    initial.state.version === AMBIENT_SCHEDULER_VERSION,
  json(initial.state.version),
);
const staleVersionState = {
  ...initial.state,
  version: 'office-ambient-v1',
} as unknown as AmbientSchedulerState;
const rebuiltFromStale = step(staleVersionState, START);
check(
  'stale scheduler version rebuilds instead of migrating',
  rebuiltFromStale.state.version === AMBIENT_SCHEDULER_VERSION &&
    json(rebuiltFromStale) === json(initial),
  json(rebuiltFromStale.state),
);
check(
  'every first due is 3–9 seconds from session start',
  initial.state.clocks.every((clock) => {
    const delay = clock.nextDueAt - START;
    return delay >= AMBIENT_TIMING.firstDueMinMs && delay <= AMBIENT_TIMING.firstDueMaxMs;
  }),
  json(initial.state.clocks),
);
check(
  'the first actual routine is a physical movement routine',
  uninterrupted.state.activities.length > 0 &&
    ['refreshment', 'library', 'social'].includes(uninterrupted.state.activities[0]?.routine ?? ''),
  json(uninterrupted.state.activities),
);
check(
  'the first boundary emits a visible away movement direction',
  uninterrupted.directions.some(
    (direction) =>
      direction.away &&
      direction.phase === 'outbound' &&
      ['refreshment', 'library', 'social'].includes(direction.routine),
  ),
  json(uninterrupted.directions),
);
const firstStarted = uninterrupted.state.activities[0];
const firstStartedClock = firstStarted
  ? uninterrupted.state.clocks.find((clock) => clock.employeeId === firstStarted.moverId)
  : undefined;
check(
  'a started routine schedules its next attempt 20–75 seconds after this attempt',
  !!firstStarted &&
    !!firstStartedClock &&
    firstStartedClock.nextDueAt - firstStarted.startedAt >= AMBIENT_TIMING.nextDueMinMs &&
    firstStartedClock.nextDueAt - firstStarted.startedAt <= AMBIENT_TIMING.nextDueMaxMs,
  json({ firstStarted, firstStartedClock }),
);
const capacityFallback = step(initial.state, firstDue, {
  policy: { enabled: true, maxAway: 0, maxActiveActors: 4 },
});
check(
  'no-away capacity deterministically degrades in place instead of queueing',
  capacityFallback.state.activities.length > 0 &&
    capacityFallback.state.activities.every((activity) => !activity.away) &&
    capacityFallback.state.clocks.every((clock) => clock.nextDueAt > firstDue),
  json(capacityFallback.state),
);
const longJumpAt = START + 60 * 60_000;
const longJump = step(initial.state, longJumpAt);
const sameJump = step(longJump.state, longJumpAt);
check(
  'one-hour suspension rebases overdue clocks without starting a catch-up burst',
  longJump.state.activities.length === 0 &&
    longJump.directions.length === 0 &&
    longJump.state.clocks.every((clock) => clock.sequence <= 1 && clock.nextDueAt > longJumpAt),
  json(longJump),
);
check(
  'repeating the same injected time is idempotent (no catch-up burst)',
  json(longJump) === json(sameJump),
);
const activeBeforeSleep = firstActivity('social');
const missedPhaseAt =
  activeBeforeSleep.activity.outboundEndsAt + AMBIENT_TIMING.suspensionLatenessMs + 1;
const missedPhase = step(activeBeforeSleep.snapshot.state, missedPhaseAt, {
  seed: activeBeforeSleep.snapshot.state.seed,
});
check(
  'missing an active phase boundary by the suspension threshold cancels without resuming',
  missedPhase.state.activities.length === 0 &&
    missedPhase.directions.length === 0 &&
    missedPhase.state.clocks.every((clock) => clock.nextDueAt > missedPhaseAt),
  json(missedPhase),
);

console.log('\n[routines] real clips and exact phase scripts');
const clipByRoutine = {
  refreshment: clipForPerformance(performanceForRoutine('consume', 0)).clip,
  library: clipForPerformance(performanceForRoutine('inspect', 0)).clip,
  social: clipForPerformance(performanceForRoutine('social', 0)).clip,
  phone: clipForPerformance(performanceForRoutine('phone', 0)).clip,
  'seated-shift': clipForPerformance(performanceForRoutine('seated-shift', 0)).clip,
  'desk-fidget': clipForPerformance(performanceForRoutine('desk-fidget', 0)).clip,
  'look-around': clipForPerformance(performanceForRoutine('look-around', 0)).clip,
  stretch: clipForPerformance(performanceForRoutine('stretch', 0)).clip,
};
check(
  'all eight semantic routines reach their shipped clips',
  json(clipByRoutine) ===
    json({
      refreshment: 'consume',
      library: 'inspect.open',
      social: 'idle.talk',
      phone: 'phone',
      'seated-shift': 'sit.idle',
      'desk-fidget': 'sit.fidget',
      'look-around': 'look.around',
      stretch: 'stretch',
    }),
  json(clipByRoutine),
);

for (const kind of ['refreshment', 'library', 'social'] as const) {
  const found = firstActivity(kind);
  const { activity } = found;
  const outbound = advanceTo(found.snapshot, activity.startedAt, {
    seed: found.snapshot.state.seed,
  });
  const dwell = advanceTo(found.snapshot, activity.outboundEndsAt, {
    seed: found.snapshot.state.seed,
  });
  const returning = advanceTo(found.snapshot, activity.dwellEndsAt, {
    seed: found.snapshot.state.seed,
  });
  const home = advanceTo(found.snapshot, activity.endsAt, {
    seed: found.snapshot.state.seed,
  });
  check(
    `${kind} follows outbound → dwell → return → home`,
    outbound.directions.some(
      (direction) => direction.employeeId === activity.moverId && direction.phase === 'outbound',
    ) &&
      dwell.directions.some(
        (direction) => direction.employeeId === activity.moverId && direction.phase === 'dwell',
      ) &&
      returning.directions.some(
        (direction) => direction.employeeId === activity.moverId && direction.phase === 'return',
      ) &&
      !home.state.activities.some((candidate) => candidate.moverId === activity.moverId),
    json({
      outbound: outbound.directions,
      dwell: dwell.directions,
      returning: returning.directions,
    }),
  );
  check(
    `${kind} destination has a stable unique anchor`,
    !!activity.destination?.anchorId,
    json(activity.destination),
  );
  const moverHome = homes(8).find((candidate) => candidate.employeeId === activity.moverId);
  const destination = activity.destination;
  const routeTravelMs =
    moverHome && destination
      ? Math.ceil(
          (Math.hypot(destination.x - moverHome.x, destination.z - moverHome.z) /
            CHARACTER_WALK_SPEED_UNITS_PER_SECOND) *
            1_000,
        ) + AMBIENT_TIMING.postureTransitionBufferMs
      : Number.POSITIVE_INFINITY;
  const minimumOutboundMs = Math.max(AMBIENT_TIMING.outboundMs, routeTravelMs);
  const minimumReturnMs = Math.max(AMBIENT_TIMING.returnMs, routeTravelMs);
  check(
    `${kind} travel honors route time, posture exit, and four-second floors`,
    activity.outboundEndsAt - activity.startedAt >= minimumOutboundMs &&
      activity.endsAt - activity.dwellEndsAt >= minimumReturnMs,
    json({ activity, moverHome, routeTravelMs, minimumOutboundMs, minimumReturnMs }),
  );
  if (kind !== 'social') {
    const anchor = worldAnchorsFor(PREFABS).find(
      (candidate) => candidate.anchorId === activity.destination?.anchorId,
    );
    check(
      `${kind} resolves to its dedicated physical fixture affordance`,
      anchor?.kind === (kind === 'refreshment' ? 'refreshment' : 'library-inspect') &&
        (kind !== 'library' || anchor.instanceId.startsWith('shelf-')),
      json(anchor),
    );
  }
  if (kind === 'social') {
    check(
      'social dwell matches AMBIENT_TIMING and partner talks only in dwell',
      activity.dwellEndsAt - activity.outboundEndsAt === AMBIENT_TIMING.socialDwellMs &&
        !outbound.directions.some((direction) => direction.employeeId === activity.partnerId) &&
        dwell.directions.some(
          (direction) =>
            direction.employeeId === activity.partnerId &&
            clipForPerformance(direction.performance).clip === 'sit.talk',
        ) &&
        !returning.directions.some((direction) => direction.employeeId === activity.partnerId),
      json({ activity, outbound: outbound.directions, dwell: dwell.directions }),
    );
  }
}

for (const kind of ['desk-fidget', 'look-around', 'stretch'] as const) {
  const found = firstActivity(kind);
  const { activity } = found;
  const dwell = advanceTo(found.snapshot, activity.startedAt, {
    seed: found.snapshot.state.seed,
  });
  const home = advanceTo(found.snapshot, activity.endsAt, {
    seed: found.snapshot.state.seed,
  });
  const dwellDirection = dwell.directions.find(
    (direction) => direction.employeeId === activity.moverId,
  );
  const expectedDuration =
    kind === 'desk-fidget'
      ? AMBIENT_TIMING.deskFidgetMs
      : kind === 'look-around'
        ? AMBIENT_TIMING.lookAroundMs
        : AMBIENT_TIMING.stretchMs;
  check(
    `${kind} stays in-place with null staging and exact dwell`,
    !activity.away &&
      activity.destination === null &&
      activity.outboundEndsAt === activity.startedAt &&
      activity.dwellEndsAt - activity.startedAt === expectedDuration &&
      activity.endsAt === activity.dwellEndsAt &&
      dwellDirection?.staging === null &&
      dwellDirection?.away === false &&
      clipForPerformance(dwellDirection.performance).clip === clipByRoutine[kind],
    json({ activity, dwellDirection }),
  );
  check(
    `${kind} never reserves an away slot or fixture anchor`,
    !activity.away &&
      activity.destination === null &&
      !dwell.directions.some(
        (direction) => direction.employeeId === activity.moverId && direction.staging !== null,
      ),
    json(dwell.directions),
  );
  if (kind === 'desk-fidget') {
    check(
      'desk-fidget remains seated at a sitting home',
      activity.homePosture === 'sitting' &&
        dwellDirection?.performance.posture === 'sit' &&
        !home.state.activities.some((candidate) => candidate.moverId === activity.moverId),
      json({ activity, dwellDirection }),
    );
  } else {
    check(
      `${kind} stands during dwell at a sitting home then clears back to home`,
      activity.homePosture === 'sitting' &&
        dwellDirection?.performance.posture === 'stand' &&
        !home.state.activities.some((candidate) => candidate.moverId === activity.moverId) &&
        !home.directions.some((direction) => direction.employeeId === activity.moverId),
      json({ activity, dwellDirection, home: home.directions }),
    );
  }
}

const seenRoutines = new Set<AmbientRoutineKind>();
for (let seedIndex = 0; seedIndex < 40 && seenRoutines.size < 8; seedIndex += 1) {
  const seed = `p5-coverage-${seedIndex}`;
  let snapshot = step(null, START, { seed });
  const end = START + 45 * 60_000;
  let guard = 0;
  while (snapshot.nextWakeAt <= end && guard < 10_000) {
    snapshot = step(snapshot.state, snapshot.nextWakeAt, { seed });
    for (const activity of snapshot.state.activities) seenRoutines.add(activity.routine);
    guard += 1;
  }
}
check(
  'seeded production sequence reaches all eight routine families',
  seenRoutines.size === 8,
  json([...seenRoutines].sort()),
);

console.log('\n[routes/layout] production A* truth and geometry invalidation');
const detourBounds = { minX: -6, minZ: -6, maxX: 6, maxZ: 6 } as const;
const detourPathfinder = buildOfficePathfinder(detourBounds, [{ x: 0, z: 0, radius: 1.2 }]);
const detourDistance = measureOfficeRouteDistance(detourPathfinder, [-4, 0], [4, 0], false);
check(
  'real A* detour distance exceeds the blocked straight line',
  detourDistance !== null && detourDistance > 8,
  String(detourDistance),
);
check(
  'non-fixture destination inside an obstacle is rejected',
  measureOfficeRouteDistance(detourPathfinder, [-4, 0], [0, 0], false) === null,
);
check(
  'route admission rejects a clear-line target outside the authored floor bounds',
  measureOfficeRouteWithinBounds(detourBounds, detourPathfinder, [4, 0], [6.1, 0], false) === null,
);
check(
  'route admission still allows a dragged outside start to walk home inside the floor',
  measureOfficeRouteWithinBounds(detourBounds, detourPathfinder, [6.1, 0], [4, 0], false) !== null,
);
const wallPathfinder = buildOfficePathfinder(
  { minX: -4, minZ: -4, maxX: 4, maxZ: 4 },
  Array.from({ length: 13 }, (_, index) => ({ x: -4.2 + index * 0.7, z: 0, radius: 0.45 })),
);
check(
  'real A* reports a sealed-floor route as unreachable',
  measureOfficeRouteDistance(wallPathfinder, [0, -3], [0, 3], false) === null,
);

const noRouteInitial = step(null, START, {
  seed: 'p5-no-route',
  routeFor: () => null,
});
const noRouteDue = Math.min(...noRouteInitial.state.clocks.map((clock) => clock.nextDueAt));
const noRoute = step(noRouteInitial.state, noRouteDue, {
  seed: 'p5-no-route',
  routeFor: () => null,
});
check(
  'scheduler never starts an unreachable away route and degrades in place',
  noRoute.state.activities.length > 0 &&
    noRoute.state.activities.every((activity) => !activity.away && activity.destination === null),
  json(noRoute.state.activities),
);

const measuredRouteFor: AmbientRoutePlanner = () => ({ distance: 20 });
const measuredInitial = step(null, START, {
  seed: 'p5-measured-route',
  routeFor: measuredRouteFor,
});
const measuredDue = Math.min(...measuredInitial.state.clocks.map((clock) => clock.nextDueAt));
const measured = step(measuredInitial.state, measuredDue, {
  seed: 'p5-measured-route',
  routeFor: measuredRouteFor,
});
const measuredActivity = measured.state.activities.find((activity) => activity.away);
check(
  'scheduler dwell timing consumes injected route length, not Euclidean heuristic',
  !!measuredActivity &&
    measuredActivity.outboundEndsAt - measuredActivity.startedAt >=
      Math.ceil((20 / CHARACTER_WALK_SPEED_UNITS_PER_SECOND) * 1_000) +
        AMBIENT_TIMING.postureTransitionBufferMs,
  json(measuredActivity),
);

const refreshForLayout = firstActivity('refreshment');
const movedPrefabs = PREFABS.map((prefab) =>
  prefab.instanceId === 'water-a' ? { ...prefab, x: prefab.x + 100 } : prefab,
);
const layoutChanged = step(
  refreshForLayout.snapshot.state,
  refreshForLayout.activity.startedAt + 1,
  { seed: refreshForLayout.snapshot.state.seed, prefabs: movedPrefabs },
);
check(
  'layout geometry change cancels stale active coordinates instead of retaining them',
  !layoutChanged.state.activities.some(
    (activity) => activity.moverId === refreshForLayout.activity.moverId,
  ) &&
    !layoutChanged.directions.some(
      (direction) => direction.employeeId === refreshForLayout.activity.moverId,
    ),
  json(layoutChanged.state.activities),
);
const routeRevisionChanged = step(
  refreshForLayout.snapshot.state,
  refreshForLayout.activity.startedAt + 1,
  {
    seed: refreshForLayout.snapshot.state.seed,
    routeSignature: 'harness-straight-v2',
  },
);
check(
  'route-grid revision cancels active choreography even when layout coordinates are unchanged',
  routeRevisionChanged.state.activities.length === 0 &&
    routeRevisionChanged.directions.length === 0,
  json(routeRevisionChanged.state.activities),
);

const singleActor = employees(1);
const singleHome = homes(1);
const singleShelf: readonly StagingPrefab[] = [
  { instanceId: 'shelf-only', prefabId: 'bookshelf-double', x: 3, z: 0, rotation: 0 },
];
const shelfInitial = step(null, START, {
  seed: 'p5-fixture-reservation',
  actors: singleActor,
  homes: singleHome,
  prefabs: singleShelf,
});
const shelfDue = shelfInitial.state.clocks[0]?.nextDueAt ?? START;
const shelfOpen = step(shelfInitial.state, shelfDue, {
  seed: 'p5-fixture-reservation',
  actors: singleActor,
  homes: singleHome,
  prefabs: singleShelf,
});
const shelfBlocked = step(shelfInitial.state, shelfDue, {
  seed: 'p5-fixture-reservation',
  actors: singleActor,
  homes: singleHome,
  prefabs: singleShelf,
  blockedAnchorIds: ['shelf-only#0'],
});
check(
  'a real reading anchor blocks the whole bookshelf fixture from ambient overlap',
  shelfOpen.state.activities.some((activity) => activity.routine === 'library') &&
    !shelfBlocked.state.activities.some((activity) => activity.routine === 'library'),
  json({ open: shelfOpen.state.activities, blocked: shelfBlocked.state.activities }),
);

const alternateWaterPrefabs: readonly StagingPrefab[] = [
  { instanceId: 'water-near', prefabId: 'water-cooler', x: 1, z: 0, rotation: 0 },
  { instanceId: 'water-far', prefabId: 'water-cooler', x: 6, z: 0, rotation: 0 },
];
const alternateHome = singleHome[0];
if (!alternateHome) throw new Error('Alternate fixture case requires a home');
const [nearWaterAnchor, farWaterAnchor] = worldAnchorsFor(alternateWaterPrefabs)
  .filter((anchor) => anchor.kind === 'refreshment')
  .sort((a, b) => {
    const aDistance = (a.x - alternateHome.x) ** 2 + (a.z - alternateHome.z) ** 2;
    const bDistance = (b.x - alternateHome.x) ** 2 + (b.z - alternateHome.z) ** 2;
    return aDistance - bDistance || a.anchorId.localeCompare(b.anchorId);
  });
if (!nearWaterAnchor || !farWaterAnchor) {
  throw new Error('Alternate fixture case requires two refreshment anchors');
}
const rejectNearRouteFor: AmbientRoutePlanner = ({ from, to }) =>
  Math.abs(to.x - nearWaterAnchor.x) < 1e-6 && Math.abs(to.z - nearWaterAnchor.z) < 1e-6
    ? null
    : { distance: Math.hypot(to.x - from.x, to.z - from.z) };
let alternateFixture: AmbientActivity | null = null;
for (let seedIndex = 0; seedIndex < 500 && !alternateFixture; seedIndex += 1) {
  const seed = `p5-alternate-fixture-${seedIndex}`;
  const initialForFixture = step(null, START, {
    seed,
    actors: singleActor,
    homes: singleHome,
    prefabs: alternateWaterPrefabs,
  });
  const dueAt = initialForFixture.state.clocks[0]?.nextDueAt ?? START;
  const baselineFixture = step(initialForFixture.state, dueAt, {
    seed,
    actors: singleActor,
    homes: singleHome,
    prefabs: alternateWaterPrefabs,
  });
  if (
    !baselineFixture.state.activities.some(
      (activity) =>
        activity.routine === 'refreshment' &&
        activity.destination?.anchorId === nearWaterAnchor.anchorId,
    )
  ) {
    continue;
  }
  alternateFixture =
    step(initialForFixture.state, dueAt, {
      seed,
      actors: singleActor,
      homes: singleHome,
      prefabs: alternateWaterPrefabs,
      routeFor: rejectNearRouteFor,
    }).state.activities[0] ?? null;
}
check(
  'an unreachable nearest fixture falls through to the farther reachable fixture',
  alternateFixture?.routine === 'refreshment' &&
    alternateFixture.destination?.anchorId === farWaterAnchor.anchorId,
  json(alternateFixture),
);

const edgeBounds = { minX: -5, minZ: -5, maxX: 5, maxZ: 5 } as const;
const edgeActors = employees(2);
const edgeHomes: AmbientActorHome[] = [
  { employeeId: edgeActors[0]?.employeeId ?? 'employee-01', x: 3, z: 0, facing: 270 },
  { employeeId: edgeActors[1]?.employeeId ?? 'employee-02', x: 4.4, z: 0, facing: 270 },
];
const boundedRouteFor: AmbientRoutePlanner = ({ from, to }) => {
  const distance = measureOfficeRouteWithinBounds(
    edgeBounds,
    null,
    [from.x, from.z],
    [to.x, to.z],
    false,
  );
  return distance === null ? null : { distance };
};
let edgeCase: { baseline: AmbientActivity; bounded: AmbientSchedulerSnapshot } | null = null;
for (let seedIndex = 0; seedIndex < 500 && !edgeCase; seedIndex += 1) {
  const seed = `p5-floor-edge-${seedIndex}`;
  const edgeInitial = step(null, START, {
    seed,
    actors: edgeActors,
    homes: edgeHomes,
    prefabs: [],
  });
  const edgeDue = Math.min(...edgeInitial.state.clocks.map((clock) => clock.nextDueAt));
  const edgeBaseline = step(edgeInitial.state, edgeDue, {
    seed,
    actors: edgeActors,
    homes: edgeHomes,
    prefabs: [],
  });
  const baseline = edgeBaseline.state.activities.find(
    (activity) =>
      activity.routine === 'social' &&
      activity.destination !== null &&
      !pointInsideOfficeBounds(edgeBounds, [activity.destination.x, activity.destination.z]),
  );
  if (!baseline) continue;
  edgeCase = {
    baseline,
    bounded: step(edgeInitial.state, edgeDue, {
      seed,
      actors: edgeActors,
      homes: edgeHomes,
      prefabs: [],
      routeFor: boundedRouteFor,
      routeSignature: 'edge-bounds-v1',
    }),
  };
}
check(
  'edge-seat social candidates never stage outside the floor route bounds',
  edgeCase?.bounded.state.activities.every(
    (activity) =>
      activity.destination === null ||
      pointInsideOfficeBounds(edgeBounds, [activity.destination.x, activity.destination.z]),
  ) &&
    edgeCase.bounded.directions.every(
      (direction) =>
        direction.staging === null ||
        pointInsideOfficeBounds(edgeBounds, [direction.staging.x, direction.staging.z]),
    ),
  json(edgeCase),
);

const standingActors = employees(2);
const standingHomes = homes(2).map((home) => ({ ...home, posture: 'standing' as const }));
const standingOptions = {
  seed: 'p5-standing-partner',
  actors: standingActors,
  homes: standingHomes,
  prefabs: [] as const,
};
let standing = step(null, START, standingOptions);
const standingSeen = new Set<AmbientRoutineKind>();
let standingPostureOk = true;
let standingGuard = 0;
while (standing.nextWakeAt <= START + 10 * 60_000 && standingGuard < 10_000) {
  standing = step(standing.state, standing.nextWakeAt, standingOptions);
  for (const activity of standing.state.activities) standingSeen.add(activity.routine);
  standingPostureOk =
    standingPostureOk &&
    standing.directions.every((direction) => direction.performance.posture === 'stand');
  standingGuard += 1;
}
check(
  'standing homes never become a seated social partner, seated-shift, or desk-fidget actor',
  ![...standingSeen].some(
    (routine) => routine === 'social' || routine === 'seated-shift' || routine === 'desk-fidget',
  ) && standingPostureOk,
  json([...standingSeen].sort()),
);

const deskPathfinder = buildOfficePathfinder({ minX: -8, minZ: -8, maxX: 8, maxZ: 8 }, [
  { x: 0, z: 0, radius: 1.58 },
]);
const socialActors = employees(2);
const socialMover = socialActors[0];
const socialPartner = socialActors[1];
if (!socialMover || !socialPartner) throw new Error('Social fixture requires two actors');
const socialHomes: AmbientActorHome[] = [
  { employeeId: socialMover.employeeId, x: 4, z: 3, facing: 180, posture: 'sitting' },
  { employeeId: socialPartner.employeeId, x: 0, z: 0.89, facing: 180, posture: 'sitting' },
];
const socialInitial = step(null, START, {
  seed: 'p5-walkable-social',
  actors: socialActors,
  homes: socialHomes,
  prefabs: [],
  routeFor: plannerFor(deskPathfinder),
});
const socialDue = Math.min(...socialInitial.state.clocks.map((clock) => clock.nextDueAt));
const walkableSocial = step(socialInitial.state, socialDue, {
  seed: 'p5-walkable-social',
  actors: socialActors,
  homes: socialHomes,
  prefabs: [],
  routeFor: plannerFor(deskPathfinder),
});
const socialActivity = walkableSocial.state.activities.find(
  (activity) => activity.routine === 'social',
);
check(
  'neighbor social target is obstacle-clear under the real workstation pathfinder',
  !!socialActivity?.destination &&
    measureOfficeRouteDistance(
      deskPathfinder,
      [socialActivity.destination.x, socialActivity.destination.z],
      [socialActivity.destination.x, socialActivity.destination.z],
      false,
    ) === 0,
  json(socialActivity),
);

const phoneActors = employees(1);
const phoneHomes: AmbientActorHome[] = [
  {
    employeeId: phoneActors[0]?.employeeId ?? 'employee-01',
    x: 0,
    z: 0.89,
    facing: 180,
    posture: 'sitting',
  },
];
const phoneOptions = {
  actors: phoneActors,
  homes: phoneHomes,
  prefabs: [] as const,
  routeFor: plannerFor(deskPathfinder),
  routeSignature: 'desk-phone-v1',
};
const phoneFound = firstActivity('phone', phoneOptions);
const phoneDestination = phoneFound.activity.destination;
const phoneDwell = advanceTo(phoneFound.snapshot, phoneFound.activity.outboundEndsAt, {
  ...phoneOptions,
  seed: phoneFound.snapshot.state.seed,
});
check(
  'a seated phone routine leaves the chair for a walkable standing aisle target',
  phoneFound.activity.away &&
    phoneDestination !== null &&
    Math.hypot(phoneDestination.x - phoneHomes[0].x, phoneDestination.z - phoneHomes[0].z) >= 1.3 &&
    measureOfficeRouteDistance(
      deskPathfinder,
      [phoneDestination.x, phoneDestination.z],
      [phoneDestination.x, phoneDestination.z],
      false,
    ) === 0 &&
    phoneDwell.directions.some(
      (direction) =>
        direction.employeeId === phoneFound.activity.moverId &&
        direction.phase === 'dwell' &&
        clipForPerformance(direction.performance).clip === 'phone',
    ),
  json({ activity: phoneFound.activity, dwell: phoneDwell.directions }),
);

console.log('\n[capacity stress] 16 employees / 60 virtual minutes');
const stressActors = employees(16);
const stressHomes = homes(16);
let stress = step(null, START, { actors: stressActors, homes: stressHomes, seed: 'p5-stress' });
const stressEnd = START + 60 * 60_000;
let stressFrames = 0;
let maxAway = 0;
let maxActive = 0;
let cadenceOk = true;
let uniquenessOk = true;
let priorStressState = stress.state;
while (stress.nextWakeAt <= stressEnd && stressFrames < 20_000) {
  const at = stress.nextWakeAt;
  stress = step(stress.state, at, {
    actors: stressActors,
    homes: stressHomes,
    seed: 'p5-stress',
  });
  const away = stress.state.activities.filter((activity) => activity.away).length;
  const activeIds = new Set<string>();
  const anchorIds = new Set<string>();
  const destinationPoints = new Set<string>();
  for (const activity of stress.state.activities) {
    activeIds.add(activity.moverId);
    if (activity.partnerId) activeIds.add(activity.partnerId);
    if (activity.destination) {
      if (anchorIds.has(activity.destination.anchorId)) uniquenessOk = false;
      anchorIds.add(activity.destination.anchorId);
      const point = `${activity.destination.x.toFixed(4)}:${activity.destination.z.toFixed(4)}`;
      if (destinationPoints.has(point)) uniquenessOk = false;
      destinationPoints.add(point);
    }
  }
  maxAway = Math.max(maxAway, away);
  maxActive = Math.max(maxActive, activeIds.size);

  const priorClockById = new Map(priorStressState.clocks.map((clock) => [clock.employeeId, clock]));
  for (const clock of stress.state.clocks) {
    const priorClock = priorClockById.get(clock.employeeId);
    if (!priorClock || clock.sequence === priorClock.sequence) continue;
    if (clock.sequence !== priorClock.sequence + 1) cadenceOk = false;
    const delay = clock.nextDueAt - at;
    if (delay < AMBIENT_TIMING.nextDueMinMs || delay > AMBIENT_TIMING.nextDueMaxMs) {
      cadenceOk = false;
    }
  }
  priorStressState = stress.state;
  stressFrames += 1;
}
check(
  'stress visited real boundaries and terminated without a timer loop',
  stressFrames > 100 && stressFrames < 20_000,
  String(stressFrames),
);
check('office never exceeds two away employees', maxAway <= 2, String(maxAway));
check('office never exceeds four ambient-active employees', maxActive <= 4, String(maxActive));
check('active anchors and destinations never double-book', uniquenessOk);
check('every observed attempt advances once into a 20–75 second future due', cadenceOk);
check(
  'all 16 employees receive at least one deterministic attempt',
  stress.state.clocks.every((clock) => clock.sequence > 0),
  json(stress.state.clocks),
);

let liveWindow = step(null, START, { seed: 'p5-release-eight' });
let liveMaxAway = 0;
let liveMovementSeen = false;
while (liveWindow.nextWakeAt <= START + 120_000) {
  liveWindow = step(liveWindow.state, liveWindow.nextWakeAt, { seed: 'p5-release-eight' });
  const away = liveWindow.state.activities.filter((activity) => activity.away).length;
  liveMaxAway = Math.max(liveMaxAway, away);
  liveMovementSeen = liveMovementSeen || away > 0;
}
check(
  'an eight-person release fixture shows movement within the real two-minute window',
  liveMovementSeen && liveMaxAway >= 1 && liveMaxAway <= 2,
  json({ liveMovementSeen, liveMaxAway }),
);

console.log('\n[preemption] runtime facts win synchronously');
const socialFound = firstActivity('social');
const social = socialFound.activity;
const busyPartnerActors = employees(8).map((actor) => ({
  ...actor,
  busy: actor.employeeId === social.partnerId,
}));
const preemptedSocial = step(socialFound.snapshot.state, social.startedAt + 1, {
  seed: socialFound.snapshot.state.seed,
  actors: busyPartnerActors,
});
check(
  'either social participant becoming busy cancels the whole pair immediately',
  !preemptedSocial.state.activities.some(
    (activity) => activity.moverId === social.moverId || activity.partnerId === social.partnerId,
  ) &&
    !preemptedSocial.directions.some(
      (direction) =>
        direction.employeeId === social.moverId || direction.employeeId === social.partnerId,
    ),
  json(preemptedSocial.state.activities),
);
const noResume = step(preemptedSocial.state, social.startedAt + 1, {
  seed: socialFound.snapshot.state.seed,
  actors: employees(8),
});
check(
  'clearing busy does not resurrect the cancelled routine',
  !noResume.state.activities.some((activity) => activity.moverId === social.moverId),
  json(noResume.state.activities),
);

const focused = step(socialFound.snapshot.state, social.startedAt + 1, {
  seed: socialFound.snapshot.state.seed,
  policy: ambientPolicyForMode('focus'),
});
const reduced = step(socialFound.snapshot.state, social.startedAt + 1, {
  seed: socialFound.snapshot.state.seed,
  policy: ambientPolicyForMode('office', true),
});
check(
  'focus and reduced motion cancel all active ambient directions',
  focused.state.activities.length === 0 &&
    focused.directions.length === 0 &&
    focused.nextWakeAt === Number.POSITIVE_INFINITY &&
    reduced.state.activities.length === 0 &&
    reduced.directions.length === 0 &&
    reduced.nextWakeAt === Number.POSITIVE_INFINITY &&
    json(focused.state.clocks) === json(socialFound.snapshot.state.clocks) &&
    json(reduced.state.clocks) === json(socialFound.snapshot.state.clocks),
);

const projectionInput: SceneCueInput = {
  roster: ['employee-idle'],
  workloads: new Map(),
  beats: [],
  now: START,
  prefabs: [],
  mode: 'office',
  reducedMotion: false,
  threadByEmployee: new Map(),
};
const idleFrame = projectSceneCues(projectionInput);
const direction = {
  employeeId: 'employee-idle',
  routine: 'phone' as const,
  phase: 'dwell' as const,
  away: false,
  partnerId: null,
  performance: performanceForRoutine('phone', 0),
  staging: null,
};
const overlaid = applyAmbientCues(idleFrame, [direction]);
const idleActor = idleFrame.actors[0];
if (!idleActor) throw new Error('Idle projection fixture produced no actor');
check(
  'fully idle actor accepts ambient presentation',
  actorAcceptsAmbientCue(idleActor) && overlaid.actors[0]?.performance?.workGesture === 'phone',
  json(overlaid.actors[0]),
);
const realFactVariants = [
  { ...idleActor, status: 'working' as const },
  { ...idleActor, running: true },
  { ...idleActor, delivering: true },
  { ...idleActor, performance: performanceForRoutine('inspect', 0) },
  {
    ...idleActor,
    staging: {
      actorId: idleActor.employeeId,
      affordance: 'reading-seat' as const,
      anchorId: 'real#0',
      x: 1,
      z: 1,
      facing: 0,
      posture: 'standing' as const,
    },
  },
];
check(
  'status/run/delivery/performance/staging facts each reject ambient byte-for-byte',
  realFactVariants.every((actor) => {
    const frame = { ...idleFrame, actors: [actor] };
    return json(applyAmbientCues(frame, [direction])) === json(frame);
  }),
);
const pairedDirection = {
  ...direction,
  employeeId: 'ambient-a',
  routine: 'social' as const,
  partnerId: 'busy-b',
};
const unrelatedDirection = { ...direction, employeeId: 'ambient-c' };
const availabilityFiltered = ambientDirectionsForAvailableActors(
  [pairedDirection, unrelatedDirection],
  new Set(['busy-b']),
);
check(
  'one busy social participant suppresses only that pair, not unrelated ambience',
  availabilityFiltered.length === 1 && availabilityFiltered[0]?.employeeId === 'ambient-c',
  json(availabilityFiltered),
);
const fixtureDirection = {
  ...direction,
  employeeId: 'ambient-at-shelf',
  routine: 'library' as const,
  staging: {
    actorId: 'ambient-at-shelf',
    affordance: 'library-inspect' as const,
    anchorId: 'shelf-a#1',
    x: 0,
    z: 0,
    facing: 0,
    posture: 'standing' as const,
  },
};
const fixtureFiltered = ambientDirectionsForAvailableActors(
  [fixtureDirection, unrelatedDirection],
  new Set(),
  new Set(['shelf-a#1']),
);
check(
  'one real fixture claim suppresses only its ambient actor, not unrelated ambience',
  fixtureFiltered.length === 1 && fixtureFiltered[0]?.employeeId === 'ambient-c',
  json(fixtureFiltered),
);

console.log('\n[wiring] one store, one timer, ordered projection');
const coreSource = await readFile(new URL('packages/dramaturgy/src/ambient.ts', ROOT), 'utf8');
const storeSource = await readFile(
  new URL('apps/desktop/renderer/src/assistant/runtime/office-ambient-life.ts', ROOT),
  'utf8',
);
const hookSource = await readFile(
  new URL('apps/desktop/renderer/src/assistant/runtime/scene-cue-react.ts', ROOT),
  'utf8',
);
const scene3dSource = await readFile(
  new URL('apps/desktop/renderer/src/surfaces/office/scene/OfficeScene3D.tsx', ROOT),
  'utf8',
);
const scene2dSource = await readFile(
  new URL('apps/desktop/renderer/src/surfaces/office/scene/OfficeScene2D.tsx', ROOT),
  'utf8',
);
const drilldownSource = await readFile(
  new URL('apps/desktop/renderer/src/surfaces/office/WorkloadDrilldown.tsx', ROOT),
  'utf8',
);
const stagingInputsSource = await readFile(
  new URL('apps/desktop/renderer/src/surfaces/office/scene/use-scene-staging-inputs.ts', ROOT),
  'utf8',
);
const hookBody = hookSource.slice(hookSource.indexOf('export function useSceneCueFrame'));
const baseIndex = hookBody.indexOf('projectSceneBaseFrame');
const ambientHookIndex = hookBody.indexOf('useOfficeAmbientDirections');
const ambientOverlayIndex = hookBody.indexOf('applyAmbientCues');
const inputIndex = hookBody.indexOf('applyInputState');
check(
  'pure scheduler has no wall clock, randomness or timer source',
  !/Date\.now\s*\(/.test(coreSource) &&
    !/Math\.random\s*\(/.test(coreSource) &&
    !/setTimeout\s*\(/.test(coreSource) &&
    !/setInterval\s*\(/.test(coreSource),
);
check(
  'renderer store uses one next-boundary timeout and no interval',
  (storeSource.match(/setTimeout\s*\(/g) ?? []).length === 1 &&
    !/setInterval\s*\(/.test(storeSource),
);
check(
  'unowned sessions cannot paint cached directions on a remount first frame',
  storeSource.includes('session.ownerContexts.has(ownerId)') &&
    storeSource.includes('ownerAdded || contextChanged || directionsChanged'),
);
check(
  'dragging and fixture claims synchronously suppress only affected ambient actors',
  hookSource.includes('actor.employeeId === draggingEmployeeId') &&
    hookSource.includes('ambientDirectionsForAvailableActors') &&
    hookSource.includes('blockedFixtureIds'),
);
check(
  'all scene consumers share speed plus one production A* route oracle and revision',
  scene3dSource.includes('CHARACTER_WALK_SPEED_UNITS_PER_SECOND * delta') &&
    stagingInputsSource.includes('measureOfficeRouteWithinBounds') &&
    stagingInputsSource.includes('routeSignature') &&
    [scene3dSource, scene2dSource, drilldownSource].every(
      (source) => source.includes('routeFor') && source.includes('routeSignature'),
    ),
);
check(
  'multi-owner contexts merge busy with OR and survive a zero-owner surface switch',
  storeSource.includes('ownerContexts: Map<string, OfficeAmbientContext>') &&
    storeSource.includes('(actorBusy.get(actor.employeeId) ?? false) || actor.busy') &&
    storeSource.includes('Keep scheduler state across the brief zero-owner gap') &&
    !storeSource.includes('cancelSessionActivities'),
);
check(
  'projection order is real base → ambient store → ambient overlay → input overlay',
  baseIndex >= 0 &&
    ambientHookIndex > baseIndex &&
    ambientOverlayIndex > ambientHookIndex &&
    inputIndex > ambientOverlayIndex,
  json({ baseIndex, ambientHookIndex, ambientOverlayIndex, inputIndex }),
);

if (failures > 0) {
  console.error(`\noffice-ambient-p5: ${failures}/${checks} checks failed`);
  process.exit(1);
}
console.log(`\noffice-ambient-p5: ${checks}/${checks} checks passed`);
