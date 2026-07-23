import type {
  ActorStaging,
  AmbientActivity,
  AmbientActivityPhase,
  AmbientActorDirection,
  AmbientActorHome,
  AmbientDestination,
  AmbientEmployeeClock,
  AmbientRoutePlanner,
  AmbientRoutePoint,
  AmbientRoutineKind,
  AmbientSchedulerInput,
  AmbientSchedulerSnapshot,
  AmbientSchedulerState,
  CharacterPerformanceState,
  StagingPrefab,
  WorldAnchor,
} from '@offisim/shared-types';
/**
 * Pure deterministic ambient-life scheduler (Office Toy Performance P5).
 *
 * This layer is deliberately not a runtime/AI fact. It accepts an injected
 * clock, seed, roster availability, homes and prefab anchors, then returns a
 * serializable scheduler state plus render directions. There is no Date.now,
 * Math.random, timer or store access here: identical inputs replay byte for
 * byte, including after JSON serialization.
 */
import { CHARACTER_WALK_SPEED_UNITS_PER_SECOND } from './character-motion.js';
export type {
  AmbientActivity,
  AmbientActivityPhase,
  AmbientActorAvailability,
  AmbientActorDirection,
  AmbientActorHome,
  AmbientDestination,
  AmbientEmployeeClock,
  AmbientRoutePlan,
  AmbientRoutePlanner,
  AmbientRoutePoint,
  AmbientRouteRequest,
  AmbientRoutineKind,
  AmbientSchedulerInput,
  AmbientSchedulerSnapshot,
  AmbientSchedulerState,
} from '@offisim/shared-types';
import { IDLE_PERFORMANCE, performanceForRoutine } from './performance.js';
import { worldAnchorsFor } from './staging.js';

export const AMBIENT_SCHEDULER_VERSION = 'office-ambient-v2' as const;

export const AMBIENT_TIMING = {
  firstDueMinMs: 3_000,
  firstDueMaxMs: 9_000,
  nextDueMinMs: 20_000,
  nextDueMaxMs: 75_000,
  suspensionLatenessMs: 5_000,
  outboundMs: 4_000,
  refreshmentDwellMs: 7_000,
  libraryDwellMs: 8_000,
  socialDwellMs: 12_000,
  phoneDwellMs: 9_000,
  returnMs: 4_000,
  seatedShiftMs: 5_000,
  deskFidgetMs: 6_000,
  lookAroundMs: 8_000,
  stretchMs: 7_000,
  postureTransitionBufferMs: 3_000,
} as const;

const MOVEMENT_ROUTINES: readonly AmbientRoutineKind[] = ['refreshment', 'library', 'social'];
/** At-destination dwell per movement routine (phone = standing desk-side call). */
const MOVEMENT_DWELL_MS = {
  refreshment: AMBIENT_TIMING.refreshmentDwellMs,
  library: AMBIENT_TIMING.libraryDwellMs,
  social: AMBIENT_TIMING.socialDwellMs,
  phone: AMBIENT_TIMING.phoneDwellMs,
} as const;
const ROUTINE_MIX: readonly AmbientRoutineKind[] = [
  'refreshment',
  'library',
  'social',
  'phone',
  'desk-fidget',
  'desk-fidget',
  'look-around',
  'look-around',
  'stretch',
  'seated-shift',
];

/** Deterministic locale-independent comparator shared by every dramaturgy sort. */
export function compareStrings(a: string, b: string): number {
  return a < b ? -1 : a > b ? 1 : 0;
}
const cmpString = compareStrings;

/** FNV-1a → stable unit interval; domain strings isolate every decision. */
function seededUnit(seed: string, employeeId: string, sequence: number, domain: string): number {
  const value = `${seed}\u001f${employeeId}\u001f${sequence}\u001f${domain}`;
  let hash = 0x811c9dc5;
  for (let index = 0; index < value.length; index += 1) {
    hash ^= value.charCodeAt(index);
    hash = Math.imul(hash, 0x01000193);
  }
  return (hash >>> 0) / 0x1_0000_0000;
}

function seededInteger(
  seed: string,
  employeeId: string,
  sequence: number,
  domain: string,
  min: number,
  max: number,
): number {
  return min + Math.floor(seededUnit(seed, employeeId, sequence, domain) * (max - min + 1));
}

function firstDueAt(seed: string, employeeId: string, joinedAt: number): number {
  return (
    joinedAt +
    seededInteger(
      seed,
      employeeId,
      0,
      'first-due',
      AMBIENT_TIMING.firstDueMinMs,
      AMBIENT_TIMING.firstDueMaxMs,
    )
  );
}

function nextDueAt(seed: string, employeeId: string, nextSequence: number, after: number): number {
  return (
    after +
    seededInteger(
      seed,
      employeeId,
      nextSequence,
      'next-due',
      AMBIENT_TIMING.nextDueMinMs,
      AMBIENT_TIMING.nextDueMaxMs,
    )
  );
}

function consumeAttempt(
  seed: string,
  clock: AmbientEmployeeClock,
  after: number,
): AmbientEmployeeClock {
  const sequence = clock.sequence + 1;
  return {
    employeeId: clock.employeeId,
    sequence,
    nextDueAt: nextDueAt(seed, clock.employeeId, sequence, after),
  };
}

function routineFor(seed: string, employeeId: string, sequence: number): AmbientRoutineKind {
  const choices = sequence === 0 ? MOVEMENT_ROUTINES : ROUTINE_MIX;
  const index = seededInteger(seed, employeeId, sequence, 'routine', 0, choices.length - 1);
  return choices[index] as AmbientRoutineKind;
}

/**
 * Stable loop-diversification lane for one activity. Pure seeded function of
 * the scheduler seed, employee, activity sequence and routine, isolated in its
 * own FNV domain so it can never shift routine/timing decisions.
 */
function performanceVariantFor(
  seed: string,
  employeeId: string,
  sequence: number,
  routine: AmbientRoutineKind,
): CharacterPerformanceState['variant'] {
  return seededInteger(
    seed,
    employeeId,
    sequence,
    `performance-variant:${routine}`,
    0,
    3,
  ) as CharacterPerformanceState['variant'];
}

function freeAnchorsByDistance(
  kind: 'refreshment' | 'library-inspect',
  home: AmbientActorHome,
  anchors: readonly WorldAnchor[],
  reserved: ReadonlySet<string>,
  reservedFixtureIds: ReadonlySet<string>,
): WorldAnchor[] {
  return anchors
    .filter(
      (anchor) =>
        anchor.kind === kind &&
        !reserved.has(anchor.anchorId) &&
        !reservedFixtureIds.has(anchor.instanceId),
    )
    .sort((a, b) => {
      const aDistance = (a.x - home.x) ** 2 + (a.z - home.z) ** 2;
      const bDistance = (b.x - home.x) ** 2 + (b.z - home.z) ** 2;
      return aDistance - bDistance || cmpString(a.anchorId, b.anchorId);
    });
}

function worldDestination(anchor: WorldAnchor): AmbientDestination {
  return {
    anchorId: anchor.anchorId,
    x: anchor.x,
    z: anchor.z,
    facing: anchor.facing,
    posture: 'standing',
  };
}

function facingToward(fromX: number, fromZ: number, toX: number, toZ: number): number {
  const degrees = (Math.atan2(toX - fromX, toZ - fromZ) * 180) / Math.PI;
  return ((degrees % 360) + 360) % 360;
}

function socialDestinations(
  seed: string,
  moverId: string,
  sequence: number,
  partner: AmbientActorHome,
  homes: readonly AmbientActorHome[],
  activities: readonly AmbientActivity[],
): AmbientDestination[] {
  const radians = ((partner.facing ?? 0) * Math.PI) / 180;
  const forward: readonly [number, number] = [Math.sin(radians), Math.cos(radians)];
  const right: readonly [number, number] = [Math.cos(radians), -Math.sin(radians)];
  const side = seededUnit(seed, moverId, sequence, 'social-side') < 0.5 ? -1 : 1;
  // Try the aisle behind the partner's chair first, then either side. The desk
  // is in the partner's +forward direction, so these candidates avoid staging
  // the visitor inside workstation geometry.
  const offsets: readonly (readonly [number, number])[] = [
    [-forward[0] * 1.65, -forward[1] * 1.65],
    [-forward[0] * 1.3 + right[0] * 1.1 * side, -forward[1] * 1.3 + right[1] * 1.1 * side],
    [-forward[0] * 1.3 - right[0] * 1.1 * side, -forward[1] * 1.3 - right[1] * 1.1 * side],
    [-forward[0] * 1.9 + right[0] * 0.7 * side, -forward[1] * 1.9 + right[1] * 0.7 * side],
    [-forward[0] * 1.9 - right[0] * 0.7 * side, -forward[1] * 1.9 - right[1] * 0.7 * side],
  ];
  const destinations: AmbientDestination[] = [];
  for (let index = 0; index < offsets.length; index += 1) {
    const offset = offsets[index] as readonly [number, number];
    const x = partner.x + offset[0];
    const z = partner.z + offset[1];
    const crowdsHome = homes.some(
      (home) =>
        home.employeeId !== partner.employeeId &&
        home.employeeId !== moverId &&
        (home.x - x) ** 2 + (home.z - z) ** 2 < 0.36,
    );
    const crowdsActivity = activities.some(
      (activity) =>
        activity.destination !== null &&
        (activity.destination.x - x) ** 2 + (activity.destination.z - z) ** 2 < 0.36,
    );
    if (crowdsHome || crowdsActivity) continue;
    destinations.push({
      anchorId: `ambient-social:${moverId}:${partner.employeeId}:${sequence}:${index}`,
      x,
      z,
      facing: facingToward(x, z, partner.x, partner.z),
      posture: 'standing',
    });
  }
  return destinations;
}

function phoneDestinations(
  seed: string,
  employeeId: string,
  sequence: number,
  home: AmbientActorHome,
  homes: readonly AmbientActorHome[],
  activities: readonly AmbientActivity[],
): AmbientDestination[] {
  return socialDestinations(seed, employeeId, sequence, home, homes, activities).map(
    (destination, index) => ({
      ...destination,
      anchorId: `ambient-phone:${employeeId}:${sequence}:${index}`,
      facing: home.facing ?? 0,
    }),
  );
}

function activityForMovement(
  routine: Extract<AmbientRoutineKind, 'refreshment' | 'library' | 'social' | 'phone'>,
  moverId: string,
  partnerId: string | null,
  sequence: number,
  destination: AmbientDestination,
  home: AmbientActorHome,
  outboundDistance: number,
  returnDistance: number,
  now: number,
): AmbientActivity {
  const dwellMs = MOVEMENT_DWELL_MS[routine];
  const outboundTravelMs = Math.max(
    AMBIENT_TIMING.outboundMs,
    Math.ceil((outboundDistance / CHARACTER_WALK_SPEED_UNITS_PER_SECOND) * 1_000) +
      AMBIENT_TIMING.postureTransitionBufferMs,
  );
  const returnTravelMs = Math.max(
    AMBIENT_TIMING.returnMs,
    Math.ceil((returnDistance / CHARACTER_WALK_SPEED_UNITS_PER_SECOND) * 1_000) +
      AMBIENT_TIMING.postureTransitionBufferMs,
  );
  const outboundEndsAt = now + outboundTravelMs;
  const dwellEndsAt = outboundEndsAt + dwellMs;
  return {
    moverId,
    partnerId,
    routine,
    sequence,
    away: true,
    destination,
    homePosture: home.posture ?? 'sitting',
    startedAt: now,
    outboundEndsAt,
    dwellEndsAt,
    endsAt: dwellEndsAt + returnTravelMs,
  };
}

function activityForInPlace(
  routine: Extract<
    AmbientRoutineKind,
    'phone' | 'seated-shift' | 'desk-fidget' | 'look-around' | 'stretch'
  >,
  employeeId: string,
  sequence: number,
  home: AmbientActorHome | undefined,
  now: number,
): AmbientActivity {
  const homePosture = home?.posture ?? 'standing';
  let resolvedRoutine = routine;
  if (routine === 'seated-shift' && homePosture !== 'sitting') {
    resolvedRoutine = 'phone';
  } else if (routine === 'desk-fidget' && homePosture !== 'sitting') {
    resolvedRoutine = 'look-around';
  }

  const durationMs =
    resolvedRoutine === 'seated-shift'
      ? AMBIENT_TIMING.seatedShiftMs
      : resolvedRoutine === 'desk-fidget'
        ? AMBIENT_TIMING.deskFidgetMs
        : resolvedRoutine === 'look-around'
          ? AMBIENT_TIMING.lookAroundMs
          : resolvedRoutine === 'stretch'
            ? AMBIENT_TIMING.stretchMs
            : AMBIENT_TIMING.phoneDwellMs;
  const endsAt = now + durationMs;
  return {
    moverId: employeeId,
    partnerId: null,
    routine: resolvedRoutine,
    sequence,
    away: false,
    destination: null,
    homePosture:
      resolvedRoutine === 'seated-shift' || resolvedRoutine === 'desk-fidget'
        ? 'sitting'
        : homePosture,
    startedAt: now,
    outboundEndsAt: now,
    dwellEndsAt: endsAt,
    endsAt,
  };
}

function routeDistance(
  routeFor: AmbientRoutePlanner | undefined,
  from: AmbientRoutePoint,
  to: AmbientRoutePoint,
  allowBlockedTarget: boolean,
): number | null {
  if (!routeFor) return null;
  const route = routeFor({ from, to, allowBlockedTarget });
  return route && Number.isFinite(route.distance) && route.distance >= 0 ? route.distance : null;
}

export function ambientActivityPhase(activity: AmbientActivity, now: number): AmbientActivityPhase {
  if (now < activity.outboundEndsAt) return 'outbound';
  if (now < activity.dwellEndsAt) return 'dwell';
  return 'return';
}

function stagingFor(activity: AmbientActivity, phase: AmbientActivityPhase): ActorStaging | null {
  if (phase === 'return' || !activity.destination) return null;
  return {
    actorId: activity.moverId,
    affordance:
      activity.routine === 'refreshment'
        ? 'refreshment'
        : activity.routine === 'library'
          ? 'library-inspect'
          : activity.routine === 'social'
            ? 'social-seat'
            : 'standing-review',
    anchorId: activity.destination.anchorId,
    x: activity.destination.x,
    z: activity.destination.z,
    facing: activity.destination.facing,
    posture: activity.destination.posture,
  };
}

function destinationPerformance(
  activity: AmbientActivity,
  seed: string,
): CharacterPerformanceState {
  const variant = performanceVariantFor(
    seed,
    activity.moverId,
    activity.sequence,
    activity.routine,
  );
  switch (activity.routine) {
    case 'refreshment':
      return performanceForRoutine('consume', variant);
    case 'library':
      return performanceForRoutine('inspect', variant);
    case 'social':
      return performanceForRoutine('social', variant);
    case 'phone':
      return performanceForRoutine('phone', variant);
    case 'seated-shift':
      return performanceForRoutine('seated-shift', variant);
    case 'desk-fidget':
      return performanceForRoutine('desk-fidget', variant);
    case 'look-around':
      return performanceForRoutine('look-around', variant);
    case 'stretch':
      return performanceForRoutine('stretch', variant);
  }
}

function directionsFor(
  activities: readonly AmbientActivity[],
  now: number,
  seed: string,
): AmbientActorDirection[] {
  const directions: AmbientActorDirection[] = [];
  for (const activity of activities) {
    const phase = ambientActivityPhase(activity, now);
    const performance =
      phase === 'return'
        ? {
            ...IDLE_PERFORMANCE,
            posture: activity.homePosture === 'sitting' ? ('sit' as const) : ('stand' as const),
          }
        : destinationPerformance(activity, seed);
    directions.push({
      employeeId: activity.moverId,
      routine: activity.routine,
      phase,
      away: activity.away,
      partnerId: activity.partnerId,
      performance,
      staging: stagingFor(activity, phase),
    });
    if (activity.routine === 'social' && activity.partnerId && phase === 'dwell') {
      directions.push({
        employeeId: activity.partnerId,
        routine: 'social',
        phase,
        away: false,
        partnerId: activity.moverId,
        performance: {
          ...performanceForRoutine(
            'social',
            performanceVariantFor(seed, activity.partnerId, activity.sequence, 'social'),
          ),
          posture: 'sit',
        },
        staging: null,
      });
    }
  }
  return directions.sort(
    (a, b) => cmpString(a.employeeId, b.employeeId) || cmpString(a.routine, b.routine),
  );
}

function nextBoundary(
  clocks: readonly AmbientEmployeeClock[],
  activities: readonly AmbientActivity[],
  now: number,
): number {
  let next = Number.POSITIVE_INFINITY;
  for (const clock of clocks) {
    if (clock.nextDueAt < next) next = clock.nextDueAt;
  }
  for (const activity of activities) {
    for (const boundary of [activity.outboundEndsAt, activity.dwellEndsAt, activity.endsAt]) {
      if (boundary > now && boundary < next) next = boundary;
    }
  }
  return next;
}

function initialState(input: AmbientSchedulerInput): AmbientSchedulerState {
  const employees = [...new Set(input.actors.map((actor) => actor.employeeId))].sort(cmpString);
  return {
    version: AMBIENT_SCHEDULER_VERSION,
    seed: input.seed,
    startedAt: input.now,
    lastAdvancedAt: input.now,
    geometrySignature: geometrySignature(input.homes, input.prefabs, input.routeSignature),
    clocks: employees.map((employeeId) => ({
      employeeId,
      sequence: 0,
      nextDueAt: firstDueAt(input.seed, employeeId, input.now),
    })),
    activities: [],
  };
}

function geometrySignature(
  homes: readonly AmbientActorHome[],
  prefabs: readonly StagingPrefab[],
  routeSignature: string | undefined,
): string {
  return JSON.stringify({
    homes: [...homes]
      .map((home) => [home.employeeId, home.x, home.z, home.facing ?? 0, home.posture ?? 'sitting'])
      .sort((a, b) => cmpString(String(a[0]), String(b[0]))),
    prefabs: [...prefabs]
      .map((prefab) => [
        prefab.instanceId,
        prefab.prefabId,
        prefab.x,
        prefab.z,
        prefab.rotation,
        prefab.scale ?? 1,
      ])
      .sort((a, b) => cmpString(String(a[0]), String(b[0]))),
    routeSignature: routeSignature ?? 'unversioned-route',
  });
}

/**
 * Advance one injected-clock boundary. Every due employee consumes at most one
 * attempt, even after a long suspension; skipped/capacity-blocked attempts are
 * rebased into the future instead of queued, so there is no catch-up burst.
 */
export function advanceAmbientScheduler(
  previous: AmbientSchedulerState | null,
  input: AmbientSchedulerInput,
): AmbientSchedulerSnapshot {
  const base =
    previous?.version === AMBIENT_SCHEDULER_VERSION && previous.seed === input.seed
      ? previous
      : initialState(input);
  const actors = [...input.actors]
    .filter(
      (actor, index, all) =>
        all.findIndex((candidate) => candidate.employeeId === actor.employeeId) === index,
    )
    .sort((a, b) => cmpString(a.employeeId, b.employeeId));
  const actorById = new Map(actors.map((actor) => [actor.employeeId, actor]));
  const homes = [...input.homes]
    .filter((home) => actorById.has(home.employeeId))
    .sort((a, b) => cmpString(a.employeeId, b.employeeId));
  const homeById = new Map(homes.map((home) => [home.employeeId, home]));
  const currentGeometrySignature = geometrySignature(homes, input.prefabs, input.routeSignature);
  const geometryChanged = base.geometrySignature !== currentGeometrySignature;
  const expectedWakeAt = nextBoundary(base.clocks, base.activities, base.lastAdvancedAt);
  const resumedAfterLongGap =
    Number.isFinite(expectedWakeAt) &&
    input.now - expectedWakeAt > AMBIENT_TIMING.suspensionLatenessMs;

  const priorClockById = new Map(base.clocks.map((clock) => [clock.employeeId, clock]));
  let clocks = actors.map(
    (actor): AmbientEmployeeClock =>
      priorClockById.get(actor.employeeId) ?? {
        employeeId: actor.employeeId,
        sequence: 0,
        nextDueAt: firstDueAt(input.seed, actor.employeeId, input.now),
      },
  );
  const clockById = new Map(clocks.map((clock) => [clock.employeeId, clock]));

  const anchors = worldAnchorsFor(input.prefabs);
  const anchorById = new Map(anchors.map((anchor) => [anchor.anchorId, anchor]));
  const blockedAnchorIds = new Set(input.blockedAnchorIds ?? []);
  const blockedFixtureIds = new Set(
    [...blockedAnchorIds]
      .map((anchorId) => anchorById.get(anchorId)?.instanceId)
      .filter((instanceId): instanceId is string => Boolean(instanceId)),
  );
  const retained: AmbientActivity[] = [];
  const retainedParticipants = new Set<string>();
  let retainedAway = 0;
  for (const activity of [...base.activities].sort(
    (a, b) => a.startedAt - b.startedAt || cmpString(a.moverId, b.moverId),
  )) {
    const participants = [activity.moverId, ...(activity.partnerId ? [activity.partnerId] : [])];
    const destinationAnchor = activity.destination
      ? anchorById.get(activity.destination.anchorId)
      : undefined;
    const invalid =
      !input.policy.enabled ||
      geometryChanged ||
      resumedAfterLongGap ||
      activity.endsAt <= input.now ||
      participants.some(
        (employeeId) =>
          !actorById.has(employeeId) ||
          actorById.get(employeeId)?.busy ||
          retainedParticipants.has(employeeId),
      ) ||
      (activity.destination !== null &&
        (blockedAnchorIds.has(activity.destination.anchorId) ||
          (destinationAnchor !== undefined &&
            blockedFixtureIds.has(destinationAnchor.instanceId)))) ||
      (activity.away && retainedAway >= input.policy.maxAway) ||
      retainedParticipants.size + participants.length > input.policy.maxActiveActors;
    if (invalid) continue;
    retained.push(activity);
    if (activity.away) retainedAway += 1;
    for (const employeeId of participants) retainedParticipants.add(employeeId);
  }

  let activities = retained;
  const activeParticipants = new Set(retainedParticipants);
  const reservedAnchorIds = new Set(blockedAnchorIds);
  const reservedFixtureIds = new Set(blockedFixtureIds);
  for (const activity of activities) {
    if (activity.destination) {
      reservedAnchorIds.add(activity.destination.anchorId);
      const anchor = anchorById.get(activity.destination.anchorId);
      if (anchor) reservedFixtureIds.add(anchor.instanceId);
    }
  }
  let awayCount = retainedAway;
  let activeActorCount = activeParticipants.size;

  if (!input.policy.enabled) {
    const state: AmbientSchedulerState = {
      version: AMBIENT_SCHEDULER_VERSION,
      seed: input.seed,
      startedAt: base.startedAt,
      lastAdvancedAt: input.now,
      geometrySignature: currentGeometrySignature,
      clocks,
      activities: [],
    };
    return { state, directions: [], nextWakeAt: Number.POSITIVE_INFINITY };
  }

  const updateClock = (clock: AmbientEmployeeClock): void => {
    clockById.set(clock.employeeId, clock);
  };

  const due = [...clockById.values()]
    .filter((clock) => clock.nextDueAt <= input.now)
    .sort((a, b) => a.nextDueAt - b.nextDueAt || cmpString(a.employeeId, b.employeeId));

  for (const dueClock of due) {
    // A due employee may have been recruited as an earlier social partner in
    // this same boundary. Read the canonical clock again so the stale due list
    // cannot consume/overwrite that partner's newly rebased schedule.
    const clock = clockById.get(dueClock.employeeId);
    if (!clock || clock.nextDueAt > input.now) continue;
    const actor = actorById.get(clock.employeeId);
    if (!actor) continue;
    if (resumedAfterLongGap || actor.busy || activeParticipants.has(clock.employeeId)) {
      updateClock(consumeAttempt(input.seed, clock, input.now));
      continue;
    }

    const home = homeById.get(clock.employeeId);
    const preferred = routineFor(input.seed, clock.employeeId, clock.sequence);
    let activity: AmbientActivity | null = null;

    const canAddActors = (count: number): boolean =>
      activeActorCount + count <= input.policy.maxActiveActors;

    if (
      preferred === 'phone' &&
      home &&
      (home.posture ?? 'sitting') === 'sitting' &&
      awayCount < input.policy.maxAway &&
      canAddActors(1)
    ) {
      for (const destination of phoneDestinations(
        input.seed,
        clock.employeeId,
        clock.sequence,
        home,
        homes,
        activities,
      )) {
        const outboundDistance = routeDistance(input.routeFor, home, destination, false);
        const returnDistance = routeDistance(input.routeFor, destination, home, true);
        if (outboundDistance === null || returnDistance === null) continue;
        activity = activityForMovement(
          'phone',
          clock.employeeId,
          null,
          clock.sequence,
          destination,
          home,
          outboundDistance,
          returnDistance,
          input.now,
        );
        break;
      }
    }

    if (
      !activity &&
      MOVEMENT_ROUTINES.includes(preferred) &&
      awayCount < input.policy.maxAway &&
      home
    ) {
      const start = MOVEMENT_ROUTINES.indexOf(preferred);
      for (let offset = 0; offset < MOVEMENT_ROUTINES.length && !activity; offset += 1) {
        const routine = MOVEMENT_ROUTINES[(start + offset) % MOVEMENT_ROUTINES.length] as Extract<
          AmbientRoutineKind,
          'refreshment' | 'library' | 'social'
        >;
        if (routine === 'social') {
          if (!canAddActors(2)) continue;
          const partners = homes
            .filter(
              (candidate) =>
                candidate.employeeId !== clock.employeeId &&
                (candidate.posture ?? 'sitting') === 'sitting' &&
                !actorById.get(candidate.employeeId)?.busy &&
                !activeParticipants.has(candidate.employeeId),
            )
            .sort((a, b) => {
              const aDistance = (a.x - home.x) ** 2 + (a.z - home.z) ** 2;
              const bDistance = (b.x - home.x) ** 2 + (b.z - home.z) ** 2;
              return aDistance - bDistance || cmpString(a.employeeId, b.employeeId);
            });
          for (const partner of partners) {
            const destinations = socialDestinations(
              input.seed,
              clock.employeeId,
              clock.sequence,
              partner,
              homes,
              activities,
            );
            for (const destination of destinations) {
              const outboundDistance = routeDistance(input.routeFor, home, destination, false);
              const returnDistance = routeDistance(input.routeFor, destination, home, true);
              if (outboundDistance === null || returnDistance === null) continue;
              activity = activityForMovement(
                routine,
                clock.employeeId,
                partner.employeeId,
                clock.sequence,
                destination,
                home,
                outboundDistance,
                returnDistance,
                input.now,
              );
              break;
            }
            if (activity) break;
          }
        } else {
          if (!canAddActors(1)) continue;
          for (const anchor of freeAnchorsByDistance(
            routine === 'refreshment' ? 'refreshment' : 'library-inspect',
            home,
            anchors,
            reservedAnchorIds,
            reservedFixtureIds,
          )) {
            const destination = worldDestination(anchor);
            const outboundDistance = routeDistance(input.routeFor, home, destination, true);
            const returnDistance = routeDistance(input.routeFor, destination, home, true);
            if (outboundDistance === null || returnDistance === null) continue;
            activity = activityForMovement(
              routine,
              clock.employeeId,
              null,
              clock.sequence,
              destination,
              home,
              outboundDistance,
              returnDistance,
              input.now,
            );
            break;
          }
        }
      }
    }

    if (!activity && canAddActors(1)) {
      const fallback: Extract<
        AmbientRoutineKind,
        'phone' | 'seated-shift' | 'desk-fidget' | 'look-around' | 'stretch'
      > =
        preferred === 'phone' ||
        preferred === 'seated-shift' ||
        preferred === 'desk-fidget' ||
        preferred === 'look-around' ||
        preferred === 'stretch'
          ? preferred
          : (home?.posture ?? 'standing') === 'sitting'
            ? 'seated-shift'
            : 'phone';
      activity = activityForInPlace(fallback, clock.employeeId, clock.sequence, home, input.now);
    }

    if (!activity) {
      updateClock(consumeAttempt(input.seed, clock, input.now));
      continue;
    }

    activities = [...activities, activity];
    activeParticipants.add(activity.moverId);
    activeActorCount += 1;
    if (activity.away) awayCount += 1;
    if (activity.destination) {
      reservedAnchorIds.add(activity.destination.anchorId);
      const anchor = anchorById.get(activity.destination.anchorId);
      if (anchor) reservedFixtureIds.add(anchor.instanceId);
    }
    updateClock(consumeAttempt(input.seed, clock, input.now));

    if (activity.partnerId) {
      activeParticipants.add(activity.partnerId);
      activeActorCount += 1;
    }
  }

  clocks = [...clockById.values()].sort((a, b) => cmpString(a.employeeId, b.employeeId));
  activities = [...activities].sort(
    (a, b) => a.startedAt - b.startedAt || cmpString(a.moverId, b.moverId),
  );
  const state: AmbientSchedulerState = {
    version: AMBIENT_SCHEDULER_VERSION,
    seed: input.seed,
    startedAt: base.startedAt,
    lastAdvancedAt: input.now,
    geometrySignature: currentGeometrySignature,
    clocks,
    activities,
  };
  return {
    state,
    directions: directionsFor(activities, input.now, input.seed),
    nextWakeAt: nextBoundary(clocks, activities, input.now),
  };
}
