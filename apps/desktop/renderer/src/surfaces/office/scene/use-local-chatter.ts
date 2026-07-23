/**
 * React shell for deterministic 3D office local chatter.
 *
 * The injected-clock state machine owns chatter history, active presentation
 * state, and timers. This hook derives the current frame inputs, bridges React
 * lifecycle to Date.now/window timers, and projects the visible bubble map.
 */
import { useEffect, useMemo, useRef, useState } from 'react';
import {
  type LocalChatterMachine,
  type LocalChatterMachineSnapshot,
  type LocalChatterPresentation,
  type LocalChatterVisibleBubble,
  createLocalChatterMachine,
  presentationSpeakersEligible,
  visibleBubblesFromPresentation,
} from './local-chatter-machine.js';
import type { LocalChatterActor } from './local-chatter.js';

export {
  LOCAL_CHATTER_FIRST_ATTEMPT_MS,
  LOCAL_CHATTER_RETRY_MS,
  localChatterPresentationEndAtMs,
  nextLocalChatterBoundaryMs,
  presentationSpeakersEligible,
  projectLocalChatterAt,
  visibleBubblesFromPresentation,
} from './local-chatter-machine.js';
export type {
  LocalChatterPresentation,
  LocalChatterVisibleBubble,
} from './local-chatter-machine.js';

/** Structural actor slice — mirrors ActorCue fields chatter cares about. */
export interface LocalChatterFrameActor {
  readonly employeeId: string;
  readonly status: 'idle' | 'working' | 'approval' | 'blocked';
  readonly delivering: boolean;
  readonly running: boolean;
  readonly selected: boolean;
  readonly hovered: boolean;
  readonly dragging: boolean;
  readonly performance: unknown | null;
  readonly staging: unknown | null;
}

/** Structural frame slice for suppression / eligibility helpers. */
export interface LocalChatterFrameSlice {
  readonly actors: readonly LocalChatterFrameActor[];
  readonly flows: readonly unknown[];
  readonly delivery: {
    readonly latest: unknown | null;
    readonly recentCount: number;
  };
  readonly attention: unknown | null;
}

const EMPTY_BUBBLES: ReadonlyMap<string, LocalChatterVisibleBubble> = new Map();

export function localChatterLifecycleScope(
  companyId: string | null | undefined,
  projectId: string | null | undefined,
): string {
  const company = companyId?.trim() || 'company';
  const project = projectId?.trim() || company;
  return `${company}::${project}`;
}

/** Seed matches lifecycle scope: `companyId::projectId-or-company`. */
export function localChatterSeed(
  companyId: string | null | undefined,
  projectId: string | null | undefined,
): string {
  return localChatterLifecycleScope(companyId, projectId);
}

/** Raw locale with an en server-safe fallback when navigator is unavailable. */
export function resolveRawChatterLocale(raw: string | null | undefined): string {
  const value = raw?.trim();
  return value && value.length > 0 ? value : 'en';
}

/**
 * Idle-accept predicate kept byte-aligned with `actorAcceptsAmbientCue`
 * (status idle, not running/delivering, no performance/staging).
 */
export function localChatterActorAcceptsIdle(actor: LocalChatterFrameActor): boolean {
  return (
    actor.status === 'idle' &&
    !actor.running &&
    !actor.delivering &&
    actor.performance === null &&
    actor.staging === null
  );
}

export function deriveStatusExplanationActive(frame: LocalChatterFrameSlice): boolean {
  return frame.actors.some((actor) => actor.status === 'blocked' || actor.status === 'approval');
}

/**
 * Conservative whole-frame runtime-truth gate. Ambient performance/staging on
 * ambientActorIds must never count as runtime truth.
 */
export function deriveRuntimeTruthActive(
  frame: LocalChatterFrameSlice,
  ambientActorIds: ReadonlySet<string>,
): boolean {
  if (frame.attention != null) return true;
  if (frame.flows.length > 0) return true;
  if (frame.delivery.latest != null || frame.delivery.recentCount > 0) return true;
  for (const actor of frame.actors) {
    if (actor.running || actor.delivering) return true;
    if (actor.status === 'working') return true;
    if (
      (actor.performance != null || actor.staging != null) &&
      !ambientActorIds.has(actor.employeeId)
    ) {
      return true;
    }
  }
  return false;
}

function deriveLocalChatterActorPresentationState(
  actor: LocalChatterFrameActor,
  ambientActorIds: ReadonlySet<string>,
): LocalChatterActor['presentationState'] {
  if (
    ambientActorIds.has(actor.employeeId) &&
    actor.status === 'idle' &&
    !actor.running &&
    !actor.delivering
  ) {
    return 'ambient';
  }
  if (localChatterActorAcceptsIdle(actor)) return 'idle';
  if (actor.running || actor.delivering || actor.status === 'working') return 'working';
  return 'busy';
}

export function deriveLocalChatterActors(
  frame: LocalChatterFrameSlice,
  ambientActorIds: ReadonlySet<string>,
): LocalChatterActor[] {
  return frame.actors.map((actor) => ({
    actorId: actor.employeeId,
    presentationState: deriveLocalChatterActorPresentationState(actor, ambientActorIds),
    safeVisualWindow: !(actor.selected || actor.hovered || actor.dragging),
  }));
}

export interface UseLocalChatterOptions {
  readonly enabled: boolean;
  readonly scopeKey: string;
  readonly locale: string;
  readonly reducedMotion: boolean;
  readonly frame: LocalChatterFrameSlice;
  readonly ambientActorIds: ReadonlySet<string>;
}

/**
 * React integration shell. Runtime/status suppression, scope changes, and
 * speaker ineligibility synchronously fail closed during render; committed
 * inputs reach the timer-owning machine from effects only.
 */
export function useLocalChatter(
  options: UseLocalChatterOptions,
): ReadonlyMap<string, LocalChatterVisibleBubble> {
  const { enabled, scopeKey, locale, reducedMotion, frame, ambientActorIds } = options;
  const statusExplanationActive = deriveStatusExplanationActive(frame);
  const runtimeTruthActive = deriveRuntimeTruthActive(frame, ambientActorIds);
  const suppressed = !enabled || runtimeTruthActive || statusExplanationActive;

  const actors = useMemo(
    () => deriveLocalChatterActors(frame, ambientActorIds),
    [frame, ambientActorIds],
  );
  const frameActorIds = useMemo(
    () => new Set(frame.actors.map((actor) => actor.employeeId)),
    [frame],
  );
  const machineRef = useRef<LocalChatterMachine | null>(null);
  const [machineSnapshot, setMachineSnapshot] = useState<LocalChatterMachineSnapshot | null>(null);

  useEffect(() => {
    const machine = createLocalChatterMachine<number>({
      clock: {
        now: () => Date.now(),
        setTimeout: (callback, delayMs) => window.setTimeout(callback, delayMs),
        clearTimeout: (handle) => window.clearTimeout(handle),
      },
      onChange: setMachineSnapshot,
    });
    machineRef.current = machine;
    return () => {
      if (machineRef.current === machine) {
        machineRef.current = null;
      }
      machine.dispose();
    };
  }, []);

  useEffect(() => {
    machineRef.current?.update({
      enabled,
      scopeKey,
      locale,
      reducedMotion,
      runtimeTruthActive,
      statusExplanationActive,
      actors,
      frameActorIds,
    });
  }, [
    enabled,
    scopeKey,
    locale,
    reducedMotion,
    runtimeTruthActive,
    statusExplanationActive,
    actors,
    frameActorIds,
  ]);

  return useMemo(() => {
    const activePresentation: LocalChatterPresentation | null =
      machineSnapshot?.activePresentation ?? null;
    if (machineSnapshot?.scopeKey !== scopeKey || suppressed || !activePresentation) {
      return EMPTY_BUBBLES;
    }
    if (!presentationSpeakersEligible(activePresentation, actors, frameActorIds)) {
      return EMPTY_BUBBLES;
    }
    const clockMs =
      machineSnapshot.clockMs > 0 ? machineSnapshot.clockMs : activePresentation.startAtMs;
    return visibleBubblesFromPresentation(activePresentation, clockMs);
  }, [machineSnapshot, scopeKey, suppressed, actors, frameActorIds]);
}
