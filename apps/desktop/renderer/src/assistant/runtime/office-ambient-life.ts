/**
 * Renderer-owned singleton for deterministic office ambient life (P5).
 *
 * Multiple consumers (3D/2D scene plus workload drilldown) share one company /
 * project session and one global next-boundary timer. Scheduler state survives
 * surface switches; a long unmounted gap is rebased by the pure reducer with no
 * catch-up burst. This module owns wall-clock/timer mechanics only — the actual
 * decisions live in shared-types and remain replayable.
 */
import {
  type AmbientActorAvailability,
  type AmbientActorDirection,
  type AmbientActorHome,
  type AmbientRoutePlanner,
  type AmbientSchedulerState,
  type DramaturgyMode,
  type StagingPrefab,
  advanceAmbientScheduler,
  ambientPolicyForMode,
} from '@offisim/shared-types';
import { useEffect, useId, useMemo, useSyncExternalStore } from 'react';

interface OfficeAmbientContext {
  readonly actors: readonly AmbientActorAvailability[];
  readonly homes: readonly AmbientActorHome[];
  readonly prefabs: readonly StagingPrefab[];
  readonly blockedAnchorIds: readonly string[];
  readonly mode: DramaturgyMode;
  readonly reducedMotion: boolean;
  readonly routeFor?: AmbientRoutePlanner;
  readonly routeSignature?: string;
}

interface OfficeAmbientHookInput extends OfficeAmbientContext {
  readonly companyId: string | null;
  readonly projectId: string | null;
}

interface AmbientSession {
  readonly scopeKey: string;
  context: OfficeAmbientContext;
  contextSignature: string;
  state: AmbientSchedulerState | null;
  directions: readonly AmbientActorDirection[];
  directionsSignature: string;
  nextWakeAt: number;
  lastTouchedAt: number;
  readonly ownerContexts: Map<string, OfficeAmbientContext>;
}

const EMPTY_DIRECTIONS: readonly AmbientActorDirection[] = Object.freeze([]);
const MAX_RETAINED_SESSIONS = 32;
const sessions = new Map<string, AmbientSession>();
const listeners = new Set<() => void>();
let version = 0;
let wakeTimer: ReturnType<typeof setTimeout> | null = null;

function cmpString(a: string, b: string): number {
  return a < b ? -1 : a > b ? 1 : 0;
}

/** Stable context identity; stale geometry/directions are never shown across a switch. */
function officeAmbientContextSignature(context: OfficeAmbientContext): string {
  return JSON.stringify({
    // Busy and blocked anchors are deliberately absent: the render layer
    // synchronously suppresses only the affected mover/social pair while this
    // passive store update cancels it. Including either dynamic reservation
    // would blank every unrelated direction for one frame.
    actors: [...context.actors].map((actor) => actor.employeeId).sort(cmpString),
    homes: [...context.homes]
      .map((home) => [home.employeeId, home.x, home.z, home.facing ?? 0, home.posture ?? 'sitting'])
      .sort((a, b) => cmpString(String(a[0]), String(b[0]))),
    prefabs: [...context.prefabs]
      .map((prefab) => [
        prefab.instanceId,
        prefab.prefabId,
        prefab.x,
        prefab.z,
        prefab.rotation,
        prefab.scale ?? 1,
      ])
      .sort((a, b) => cmpString(String(a[0]), String(b[0]))),
    mode: context.mode,
    reducedMotion: context.reducedMotion,
    routeSignature: context.routeSignature,
  });
}

function mergedOwnerContext(
  ownerContexts: ReadonlyMap<string, OfficeAmbientContext>,
): OfficeAmbientContext {
  const ranked = [...ownerContexts.entries()].sort(
    ([ownerA, contextA], [ownerB, contextB]) =>
      Number(Boolean(contextB.routeFor)) - Number(Boolean(contextA.routeFor)) ||
      contextB.actors.length - contextA.actors.length ||
      contextB.homes.length - contextA.homes.length ||
      contextB.prefabs.length - contextA.prefabs.length ||
      cmpString(officeAmbientContextSignature(contextA), officeAmbientContextSignature(contextB)) ||
      cmpString(ownerA, ownerB),
  );
  const authoritative = ranked[0]?.[1];
  if (!authoritative) throw new Error('Cannot merge an unowned ambient session');

  const actorBusy = new Map<string, boolean>();
  const blockedAnchorIds = new Set<string>();
  for (const [, context] of ranked) {
    for (const actor of context.actors) {
      actorBusy.set(actor.employeeId, (actorBusy.get(actor.employeeId) ?? false) || actor.busy);
    }
    for (const anchorId of context.blockedAnchorIds) blockedAnchorIds.add(anchorId);
  }

  const homes = new Map(authoritative.homes.map((home) => [home.employeeId, home]));
  const prefabs = new Map(authoritative.prefabs.map((prefab) => [prefab.instanceId, prefab]));
  for (const [, context] of ranked.slice(1)) {
    for (const home of context.homes) {
      if (!homes.has(home.employeeId)) homes.set(home.employeeId, home);
    }
    for (const prefab of context.prefabs) {
      if (!prefabs.has(prefab.instanceId)) prefabs.set(prefab.instanceId, prefab);
    }
  }

  const modes = new Set(ranked.map(([, context]) => context.mode));
  return {
    actors: [...actorBusy]
      .map(([employeeId, busy]) => ({ employeeId, busy }))
      .sort((a, b) => cmpString(a.employeeId, b.employeeId)),
    homes: [...homes.values()].sort((a, b) => cmpString(a.employeeId, b.employeeId)),
    prefabs: [...prefabs.values()].sort((a, b) => cmpString(a.instanceId, b.instanceId)),
    blockedAnchorIds: [...blockedAnchorIds].sort(cmpString),
    // During a transient owner mismatch, choose the most restrictive visible
    // policy. All owners converge on the same global mode on the next render.
    mode: modes.has('focus') ? 'focus' : modes.has('office') ? 'office' : 'cinematic',
    reducedMotion: ranked.some(([, context]) => context.reducedMotion),
    routeFor: authoritative.routeFor,
    routeSignature: authoritative.routeSignature,
  };
}

function mergeSessionContext(session: AmbientSession): boolean {
  const context = mergedOwnerContext(session.ownerContexts);
  const contextSignature = officeAmbientContextSignature(context);
  const changed = contextSignature !== session.contextSignature;
  session.context = context;
  session.contextSignature = contextSignature;
  return changed;
}

function notify(): void {
  version += 1;
  for (const listener of listeners) listener();
}

function refreshSession(session: AmbientSession, now: number): boolean {
  const snapshot = advanceAmbientScheduler(session.state, {
    seed: session.scopeKey,
    now,
    actors: session.context.actors,
    homes: session.context.homes,
    prefabs: session.context.prefabs,
    blockedAnchorIds: session.context.blockedAnchorIds,
    policy: ambientPolicyForMode(session.context.mode, session.context.reducedMotion),
    routeFor: session.context.routeFor,
    routeSignature: session.context.routeSignature,
  });
  session.state = snapshot.state;
  session.nextWakeAt = snapshot.nextWakeAt;
  const signature = JSON.stringify(snapshot.directions);
  if (signature === session.directionsSignature) return false;
  session.directions = snapshot.directions;
  session.directionsSignature = signature;
  return true;
}

function pruneIdleSessions(): void {
  if (sessions.size <= MAX_RETAINED_SESSIONS) return;
  const idle = [...sessions.values()]
    .filter((session) => session.ownerContexts.size === 0)
    .sort((a, b) => a.lastTouchedAt - b.lastTouchedAt);
  while (sessions.size > MAX_RETAINED_SESSIONS) {
    const oldest = idle.shift();
    if (!oldest) break;
    sessions.delete(oldest.scopeKey);
  }
}

function scheduleWake(): void {
  if (wakeTimer !== null) {
    clearTimeout(wakeTimer);
    wakeTimer = null;
  }
  let next = Number.POSITIVE_INFINITY;
  for (const session of sessions.values()) {
    if (session.ownerContexts.size > 0 && session.nextWakeAt < next) next = session.nextWakeAt;
  }
  if (!Number.isFinite(next)) return;
  const now = Date.now();
  wakeTimer = setTimeout(
    () => {
      wakeTimer = null;
      const tickAt = Date.now();
      let changed = false;
      for (const session of sessions.values()) {
        if (session.ownerContexts.size > 0 && session.nextWakeAt <= tickAt) {
          changed = refreshSession(session, tickAt) || changed;
        }
      }
      if (changed) notify();
      scheduleWake();
    },
    Math.max(0, next - now),
  );
}

function connect(ownerId: string, scopeKey: string, context: OfficeAmbientContext): () => void {
  let session = sessions.get(scopeKey);
  if (!session) {
    session = {
      scopeKey,
      context,
      contextSignature: officeAmbientContextSignature(context),
      state: null,
      directions: EMPTY_DIRECTIONS,
      directionsSignature: '[]',
      nextWakeAt: Number.POSITIVE_INFINITY,
      lastTouchedAt: Date.now(),
      ownerContexts: new Map(),
    };
    sessions.set(scopeKey, session);
  }
  const ownerAdded = !session.ownerContexts.has(ownerId);
  session.ownerContexts.set(ownerId, context);
  const contextChanged = mergeSessionContext(session);
  session.lastTouchedAt = Date.now();
  const directionsChanged = refreshSession(session, session.lastTouchedAt);
  // A newly mounted owner rendered EMPTY before its passive effect connected.
  // Notify even when another owner already kept the identical session warm so
  // the newcomer receives the existing directions immediately.
  if (ownerAdded || contextChanged || directionsChanged) notify();
  pruneIdleSessions();
  scheduleWake();

  return () => {
    const current = sessions.get(scopeKey);
    if (current) {
      current.ownerContexts.delete(ownerId);
      current.lastTouchedAt = Date.now();
      // Keep scheduler state across the brief zero-owner gap when React swaps
      // 2D/3D surfaces. The owner gate hides cached directions; reconnect runs
      // the reducer, whose route revision and suspension guards decide whether
      // the activity can continue.
      if (current.ownerContexts.size > 0) {
        const contextChanged = mergeSessionContext(current);
        const directionsChanged = refreshSession(current, current.lastTouchedAt);
        if (contextChanged || directionsChanged) notify();
      }
    }
    pruneIdleSessions();
    scheduleWake();
  };
}

function updateConnection(ownerId: string, scopeKey: string, context: OfficeAmbientContext): void {
  const session = sessions.get(scopeKey);
  if (!session?.ownerContexts.has(ownerId)) return;
  session.ownerContexts.set(ownerId, context);
  const contextChanged = mergeSessionContext(session);
  session.lastTouchedAt = Date.now();
  const directionsChanged = refreshSession(session, session.lastTouchedAt);
  if (contextChanged || directionsChanged) notify();
  scheduleWake();
}

const ambientStore = {
  subscribe(listener: () => void): () => void {
    listeners.add(listener);
    return () => listeners.delete(listener);
  },
  getVersion(): number {
    return version;
  },
  directionsFor(
    ownerId: string,
    scopeKey: string,
    contextSignature: string,
  ): readonly AmbientActorDirection[] {
    const session = sessions.get(scopeKey);
    return session?.contextSignature === contextSignature && session.ownerContexts.has(ownerId)
      ? session.directions
      : EMPTY_DIRECTIONS;
  },
};

/** Shared ambient directions for the active company/project scene. */
export function useOfficeAmbientDirections(
  input: OfficeAmbientHookInput,
): readonly AmbientActorDirection[] {
  const ownerId = useId();
  const scopeKey = input.companyId ? `${input.companyId}::${input.projectId ?? 'company'}` : null;
  const context = useMemo<OfficeAmbientContext>(
    () => ({
      actors: input.actors,
      homes: input.homes,
      prefabs: input.prefabs,
      blockedAnchorIds: input.blockedAnchorIds,
      mode: input.mode,
      reducedMotion: input.reducedMotion,
      routeFor: input.routeFor,
      routeSignature: input.routeSignature,
    }),
    [
      input.actors,
      input.homes,
      input.prefabs,
      input.blockedAnchorIds,
      input.mode,
      input.reducedMotion,
      input.routeFor,
      input.routeSignature,
    ],
  );
  const contextSignature = useMemo(() => officeAmbientContextSignature(context), [context]);
  const storeVersion = useSyncExternalStore(
    ambientStore.subscribe,
    ambientStore.getVersion,
    ambientStore.getVersion,
  );

  // Ownership is scoped only to mount/company/project. Context changes are
  // updated by the next effect without running this true-unmount cleanup.
  // biome-ignore lint/correctness/useExhaustiveDependencies: context/contextSignature are intentionally handled by updateConnection below.
  useEffect(() => {
    if (!scopeKey) return undefined;
    return connect(ownerId, scopeKey, context);
  }, [ownerId, scopeKey]);

  useEffect(() => {
    if (!scopeKey) return;
    updateConnection(ownerId, scopeKey, context);
  }, [ownerId, scopeKey, context]);

  return useMemo(() => {
    void storeVersion;
    if (!scopeKey || !ambientPolicyForMode(context.mode, context.reducedMotion).enabled) {
      return EMPTY_DIRECTIONS;
    }
    return ambientStore.directionsFor(ownerId, scopeKey, contextSignature);
  }, [ownerId, scopeKey, context.mode, context.reducedMotion, contextSignature, storeVersion]);
}
