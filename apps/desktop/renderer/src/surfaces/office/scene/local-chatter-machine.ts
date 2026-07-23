/**
 * Deterministic orchestration for office local chatter.
 *
 * The machine owns history, active presentation state, and every timer handle.
 * Wall-clock and timer behavior are injected so the same production logic can
 * run under a manual virtual clock without a DOM.
 */
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

/** First selector attempt after a quiet scene becomes eligible. */
export const LOCAL_CHATTER_FIRST_ATTEMPT_MS = 1_750;

/** Bounded one-shot retry spacing while the scene stays quiet but suppressed. */
export const LOCAL_CHATTER_RETRY_MS = 4_000;

const EMPTY_BUBBLES: ReadonlyMap<string, LocalChatterVisibleBubble> = new Map();

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

export interface LocalChatterClock<TimerHandle = unknown> {
  readonly now: () => number;
  readonly setTimeout: (callback: () => void, delayMs: number) => TimerHandle;
  readonly clearTimeout: (handle: TimerHandle) => void;
}

export interface LocalChatterMachineInput {
  readonly enabled: boolean;
  readonly scopeKey: string;
  readonly locale: string;
  readonly reducedMotion: boolean;
  readonly runtimeTruthActive: boolean;
  readonly statusExplanationActive: boolean;
  readonly actors: readonly LocalChatterActor[];
  readonly frameActorIds: ReadonlySet<string>;
}

export interface LocalChatterMachineSnapshot {
  readonly scopeKey: string | null;
  readonly history: LocalChatterHistory;
  readonly activePresentation: LocalChatterPresentation | null;
  readonly clockMs: number;
}

export interface LocalChatterMachine {
  readonly update: (input: LocalChatterMachineInput) => void;
  readonly getSnapshot: () => LocalChatterMachineSnapshot;
  readonly dispose: () => void;
}

export interface CreateLocalChatterMachineOptions<TimerHandle> {
  readonly clock: LocalChatterClock<TimerHandle>;
  readonly onChange?: (snapshot: LocalChatterMachineSnapshot) => void;
}

function isSuppressed(input: LocalChatterMachineInput): boolean {
  return !input.enabled || input.runtimeTruthActive || input.statusExplanationActive;
}

export function createLocalChatterMachine<TimerHandle>(
  options: CreateLocalChatterMachineOptions<TimerHandle>,
): LocalChatterMachine {
  const { clock, onChange } = options;
  let input: LocalChatterMachineInput | null = null;
  let disposed = false;
  let attemptTimer: TimerHandle | null = null;
  let presentationTimer: TimerHandle | null = null;
  let snapshot: LocalChatterMachineSnapshot = {
    scopeKey: null,
    history: emptyLocalChatterHistory(),
    activePresentation: null,
    clockMs: 0,
  };

  const publish = (next: LocalChatterMachineSnapshot): void => {
    snapshot = next;
    onChange?.(snapshot);
  };

  const cancelAttempt = (): void => {
    if (attemptTimer == null) return;
    clock.clearTimeout(attemptTimer);
    attemptTimer = null;
  };

  const cancelPresentation = (): void => {
    if (presentationTimer == null) return;
    clock.clearTimeout(presentationTimer);
    presentationTimer = null;
  };

  const scheduleAttempt = (delayMs: number): void => {
    if (disposed || attemptTimer != null) return;
    attemptTimer = clock.setTimeout(() => {
      attemptTimer = null;
      attempt();
    }, delayMs);
  };

  const clearActive = (scheduleNextAttempt: boolean): void => {
    cancelPresentation();
    if (snapshot.activePresentation != null) {
      publish({
        ...snapshot,
        activePresentation: null,
      });
    }
    if (scheduleNextAttempt && input != null && !isSuppressed(input)) {
      scheduleAttempt(LOCAL_CHATTER_FIRST_ATTEMPT_MS);
    }
  };

  const armPresentation = (): void => {
    if (disposed || input == null || isSuppressed(input)) return;
    const presentation = snapshot.activePresentation;
    if (!presentation) return;

    const nowMs = clock.now();
    if (snapshot.clockMs !== nowMs) {
      publish({ ...snapshot, clockMs: nowMs });
    }
    if (!presentationSpeakersEligible(presentation, input.actors, input.frameActorIds)) {
      clearActive(true);
      return;
    }

    const boundaryMs = nextLocalChatterBoundaryMs(presentation, nowMs);
    if (boundaryMs == null) {
      clearActive(true);
      return;
    }
    presentationTimer = clock.setTimeout(
      () => {
        presentationTimer = null;
        armPresentation();
      },
      Math.max(0, boundaryMs - nowMs),
    );
  };

  const attempt = (): void => {
    if (disposed || input == null || snapshot.activePresentation != null || isSuppressed(input)) {
      return;
    }

    const nowMs = clock.now();
    const result = selectLocalChatter({
      nowMs,
      seed: input.scopeKey,
      locale: input.locale,
      reducedMotion: input.reducedMotion,
      runtimeTruthActive: input.runtimeTruthActive,
      statusExplanationActive: input.statusExplanationActive,
      // Attempt timers only run with no active presentation, so the selector's
      // required scene-wide budget input is exactly zero.
      activeChatterCount: 0,
      maxVisible: CHATTER_MAX_VISIBLE_DEFAULT,
      actors: input.actors,
      history: snapshot.history,
    });

    if (result.status !== 'chatter') {
      scheduleAttempt(LOCAL_CHATTER_RETRY_MS);
      return;
    }

    publish({
      ...snapshot,
      history: result.nextHistory,
      activePresentation: result.presentation,
      clockMs: nowMs,
    });
    armPresentation();
  };

  const update = (nextInput: LocalChatterMachineInput): void => {
    if (disposed) return;
    const scopeChanged = snapshot.scopeKey !== nextInput.scopeKey;
    input = nextInput;

    if (scopeChanged) {
      cancelAttempt();
      cancelPresentation();
      publish({
        scopeKey: nextInput.scopeKey,
        history: emptyLocalChatterHistory(),
        activePresentation: null,
        clockMs: 0,
      });
    }

    if (isSuppressed(nextInput)) {
      cancelAttempt();
      clearActive(false);
      return;
    }

    if (snapshot.activePresentation != null) {
      if (
        !presentationSpeakersEligible(
          snapshot.activePresentation,
          nextInput.actors,
          nextInput.frameActorIds,
        )
      ) {
        clearActive(true);
      } else if (presentationTimer == null) {
        armPresentation();
      }
      return;
    }

    cancelPresentation();
    if (attemptTimer == null) {
      scheduleAttempt(LOCAL_CHATTER_FIRST_ATTEMPT_MS);
    }
  };

  const dispose = (): void => {
    if (disposed) return;
    disposed = true;
    cancelAttempt();
    cancelPresentation();
    input = null;
    snapshot = {
      ...snapshot,
      activePresentation: null,
    };
  };

  return {
    update,
    getSnapshot: () => snapshot,
    dispose,
  };
}
