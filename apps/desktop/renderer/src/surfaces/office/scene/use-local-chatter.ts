/**
 * 3D office local-chatter integration.
 *
 * Sole owner of chatter history, active presentation state, Date.now reads,
 * and timeout handles. Consumes the authoritative SceneCueFrame + ambient
 * actor ids from useSceneCueFrame; never subscribes to ambient directions,
 * never calls a model/network/persistence layer, and never invents runtime
 * truth. Selection remains the pure foundation `selectLocalChatter`.
 *
 * Pure helpers below take a structural frame slice so the integration harness
 * can import them without pulling the full scene-cue / data-layer graph.
 */
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  CHATTER_MAX_VISIBLE_DEFAULT,
  type LocalChatterActor,
  type LocalChatterHistory,
  type LocalChatterResult,
  emptyLocalChatterHistory,
  selectLocalChatter,
} from './local-chatter.js';

export type LocalChatterPresentation = Extract<
  LocalChatterResult,
  { status: 'chatter' }
>['presentation'];

export interface LocalChatterVisibleBubble {
  readonly actorId: string;
  readonly text: string;
  readonly copyKey: string;
  readonly kind: LocalChatterPresentation['kind'];
  readonly motion: LocalChatterPresentation['motion'];
  readonly presentationId: string;
}

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

/** First selector attempt after a quiet scene becomes eligible. */
export const LOCAL_CHATTER_FIRST_ATTEMPT_MS = 1_750;

/** Bounded one-shot retry spacing while the scene stays quiet but suppressed. */
export const LOCAL_CHATTER_RETRY_MS = 4_000;

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
    // Non-idle, non-status-explanation operational status.
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

/** Project the single visible utterance at an exact clock (pure; no timers). */
export function projectLocalChatterAt(
  presentation: LocalChatterPresentation,
  nowMs: number,
): LocalChatterVisibleBubble | null {
  const elapsed = nowMs - presentation.startAtMs;
  if (elapsed < 0) return null;

  if (presentation.kind === 'pair-dialogue') {
    const hold = presentation.holdMs;
    const gap = presentation.utteranceGapMs;
    const firstEnd = hold;
    const secondStart = hold + gap;
    const secondEnd = secondStart + hold;
    if (elapsed < firstEnd) {
      return bubbleFromUtterance(presentation, presentation.utterances[0]);
    }
    // Gap: neither turn is visible.
    if (elapsed < secondStart) return null;
    if (elapsed < secondEnd) {
      return bubbleFromUtterance(presentation, presentation.utterances[1]);
    }
    return null;
  }

  if (elapsed < presentation.holdMs) {
    return bubbleFromUtterance(presentation, presentation.utterances[0]);
  }
  return null;
}

function bubbleFromUtterance(
  presentation: LocalChatterPresentation,
  utterance: LocalChatterPresentation['utterances'][number] | undefined,
): LocalChatterVisibleBubble | null {
  if (!utterance) return null;
  return {
    actorId: utterance.actorId,
    text: utterance.text,
    copyKey: utterance.copyKey,
    kind: presentation.kind,
    motion: presentation.motion,
    presentationId: presentation.id,
  };
}

export function localChatterPresentationEndAtMs(presentation: LocalChatterPresentation): number {
  if (presentation.kind === 'pair-dialogue') {
    return (
      presentation.startAtMs +
      presentation.holdMs +
      presentation.utteranceGapMs +
      presentation.holdMs
    );
  }
  return presentation.startAtMs + presentation.holdMs;
}

/** Next timeline boundary where visibility may change, or null when ended. */
export function nextLocalChatterBoundaryMs(
  presentation: LocalChatterPresentation,
  nowMs: number,
): number | null {
  const endAt = localChatterPresentationEndAtMs(presentation);
  if (nowMs >= endAt) return null;
  if (presentation.kind !== 'pair-dialogue') return endAt;

  const firstEnd = presentation.startAtMs + presentation.holdMs;
  const secondStart = firstEnd + presentation.utteranceGapMs;
  const secondEnd = secondStart + presentation.holdMs;
  if (nowMs < firstEnd) return firstEnd;
  if (nowMs < secondStart) return secondStart;
  if (nowMs < secondEnd) return secondEnd;
  return null;
}

export function presentationSpeakersEligible(
  presentation: LocalChatterPresentation,
  actors: readonly LocalChatterActor[],
  frameActorIds: ReadonlySet<string>,
): boolean {
  const byId = new Map(actors.map((actor) => [actor.actorId, actor]));
  for (const actorId of presentation.actorIds) {
    if (!frameActorIds.has(actorId)) return false;
    const actor = byId.get(actorId);
    if (!actor) return false;
    if (actor.presentationState !== 'idle' && actor.presentationState !== 'ambient') {
      return false;
    }
    if (!actor.safeVisualWindow) return false;
  }
  return true;
}

export function visibleBubblesFromPresentation(
  presentation: LocalChatterPresentation | null,
  nowMs: number,
): ReadonlyMap<string, LocalChatterVisibleBubble> {
  if (!presentation) return EMPTY_BUBBLES;
  const bubble = projectLocalChatterAt(presentation, nowMs);
  if (!bubble) return EMPTY_BUBBLES;
  return new Map([[bubble.actorId, bubble]]);
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
 * React integration owner. Returns the current per-actor visible bubble map.
 * Runtime/status suppression synchronously yields an empty map.
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

  const historyRef = useRef<LocalChatterHistory>(emptyLocalChatterHistory());
  const activeRef = useRef<LocalChatterPresentation | null>(null);
  const scopeRef = useRef(scopeKey);
  const actorsRef = useRef(actors);
  const frameActorIdsRef = useRef(frameActorIds);
  const localeRef = useRef(locale);
  const reducedMotionRef = useRef(reducedMotion);
  const suppressFlagsRef = useRef({
    suppressed,
    runtimeTruthActive,
    statusExplanationActive,
  });
  actorsRef.current = actors;
  frameActorIdsRef.current = frameActorIds;
  localeRef.current = locale;
  reducedMotionRef.current = reducedMotion;
  suppressFlagsRef.current = { suppressed, runtimeTruthActive, statusExplanationActive };

  const [activePresentation, setActivePresentation] = useState<LocalChatterPresentation | null>(
    null,
  );
  const [clockMs, setClockMs] = useState(0);

  const clearActive = useCallback(() => {
    activeRef.current = null;
    setActivePresentation(null);
  }, []);

  // Scope change resets history, presentation, and owned timers (via effect cleanups).
  useEffect(() => {
    if (scopeRef.current === scopeKey) return;
    scopeRef.current = scopeKey;
    historyRef.current = emptyLocalChatterHistory();
    clearActive();
    setClockMs(0);
  }, [scopeKey, clearActive]);

  // Runtime/status preemption and speaker ineligibility — clear owned state.
  useEffect(() => {
    if (!activeRef.current) return;
    if (suppressed) {
      clearActive();
      return;
    }
    if (!presentationSpeakersEligible(activeRef.current, actors, frameActorIds)) {
      clearActive();
    }
  }, [suppressed, actors, frameActorIds, clearActive]);

  // Occasional selector attempts while quiet. Timers are one-shot; StrictMode
  // cleanup cancels the pending attempt so sessions are not duplicated.
  useEffect(() => {
    if (suppressed || activePresentation) return;

    let cancelled = false;
    let retryTimer: number | null = null;

    const attempt = () => {
      if (cancelled || activeRef.current) return;
      const flags = suppressFlagsRef.current;
      if (flags.suppressed) return;

      const nowMs = Date.now();
      const currentActors = actorsRef.current;
      const visible = visibleBubblesFromPresentation(activeRef.current, nowMs);
      const result = selectLocalChatter({
        nowMs,
        seed: scopeKey,
        locale: localeRef.current,
        reducedMotion: reducedMotionRef.current,
        runtimeTruthActive: flags.runtimeTruthActive,
        statusExplanationActive: flags.statusExplanationActive,
        activeChatterCount: visible.size,
        maxVisible: CHATTER_MAX_VISIBLE_DEFAULT,
        actors: currentActors,
        history: historyRef.current,
      });

      if (result.status === 'chatter') {
        historyRef.current = result.nextHistory;
        activeRef.current = result.presentation;
        setActivePresentation(result.presentation);
        setClockMs(nowMs);
        return;
      }

      retryTimer = window.setTimeout(attempt, LOCAL_CHATTER_RETRY_MS);
    };

    const firstTimer = window.setTimeout(attempt, LOCAL_CHATTER_FIRST_ATTEMPT_MS);
    return () => {
      cancelled = true;
      window.clearTimeout(firstTimer);
      if (retryTimer != null) window.clearTimeout(retryTimer);
    };
  }, [suppressed, activePresentation, scopeKey]);

  // Presentation timeline: arm one-shot boundary timers (hold / gap / end).
  useEffect(() => {
    if (!activePresentation || suppressed) return;

    const pending = new Set<number>();
    let cancelled = false;

    const schedule = (fn: () => void, delayMs: number) => {
      const id = window.setTimeout(
        () => {
          pending.delete(id);
          fn();
        },
        Math.max(0, delayMs),
      );
      pending.add(id);
    };

    const arm = () => {
      if (cancelled) return;
      const now = Date.now();
      setClockMs(now);
      const presentation = activeRef.current;
      if (!presentation) return;
      if (
        !presentationSpeakersEligible(presentation, actorsRef.current, frameActorIdsRef.current)
      ) {
        clearActive();
        return;
      }
      const boundary = nextLocalChatterBoundaryMs(presentation, now);
      if (boundary == null) {
        clearActive();
        return;
      }
      schedule(arm, boundary - now);
    };

    arm();
    return () => {
      cancelled = true;
      for (const id of pending) window.clearTimeout(id);
      pending.clear();
    };
  }, [activePresentation, suppressed, clearActive]);

  // Unmount: drop active presentation ref (timer cleanups live on the effects).
  useEffect(
    () => () => {
      activeRef.current = null;
    },
    [],
  );

  return useMemo(() => {
    // Scope changes must hide the previous company's/project's bubble in the
    // render that observes the new key, before the reset effect can run.
    if (scopeRef.current !== scopeKey || suppressed || !activePresentation) {
      return EMPTY_BUBBLES;
    }
    if (!presentationSpeakersEligible(activePresentation, actors, frameActorIds)) {
      return EMPTY_BUBBLES;
    }
    const nowMs = clockMs > 0 ? clockMs : activePresentation.startAtMs;
    return visibleBubblesFromPresentation(activePresentation, nowMs);
  }, [scopeKey, suppressed, activePresentation, actors, frameActorIds, clockMs]);
}
