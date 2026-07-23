import type { Posture } from '@offisim/shared-types';
import type { CharacterMovementPhase } from '../character-movement.js';
import {
  type ClipName,
  type ClipSelection,
  POSTURE_TRANSITION_CLIPS,
  selectionForClip,
} from './clip-map.js';

export interface CharacterPlaybackTarget {
  readonly posture: Posture;
  readonly selection: ClipSelection;
}

interface ActivePostureTransition {
  readonly clip: ClipName;
  readonly targetPosture: Posture;
}

/** Pure state mirrored by the live Three.js mixer binding. */
export interface CharacterPlaybackState {
  readonly actualPosture: Posture;
  readonly desired: CharacterPlaybackTarget | null;
  readonly activeClip: ClipName | null;
  /** Full identity of the clip currently owned by the mixer. */
  readonly activeSelection: ClipSelection | null;
  readonly transition: ActivePostureTransition | null;
  /** One-shot already returned to rest; suppress replay until semantics change. */
  readonly completedSelection: ClipSelection | null;
}

export interface CharacterPlaybackCommand {
  readonly selection: ClipSelection;
  readonly instant: boolean;
}

export interface CharacterPlaybackResult {
  readonly state: CharacterPlaybackState;
  readonly command: CharacterPlaybackCommand | null;
  readonly completedTransition: ClipName | null;
}

interface PlaybackRequestOptions {
  readonly reducedMotion: boolean;
  readonly forceRestart?: boolean;
}

/**
 * Playback identity = clip + explicit typed semantic identity + stable variant.
 * The semantic string is opaque here: it is only ever compared for equality,
 * never interpreted to recover semantics.
 */
function sameSelectionIdentity(
  left: ClipSelection | null | undefined,
  right: ClipSelection | null | undefined,
): boolean {
  if (!left || !right) return false;
  return (
    left.clip === right.clip && left.semantic === right.semantic && left.variant === right.variant
  );
}

export function createCharacterPlaybackState(actualPosture: Posture): CharacterPlaybackState {
  return {
    actualPosture,
    desired: null,
    activeClip: null,
    activeSelection: null,
    transition: null,
    completedSelection: null,
  };
}

export function isStandingMovementMount(
  current: CharacterPlaybackState,
  movementPhase: CharacterMovementPhase,
): boolean {
  return current.activeClip === null && movementPhase === 'walk';
}

/**
 * Entry and drag-return actors start from an explicit floor position, already
 * standing. Their parent publishes `walk` from a layout effect, after this rig
 * has rendered but before its first frame. Rebase only that unstarted mount;
 * active clips and atomic posture transitions remain authoritative afterwards.
 */
export function reconcilePlaybackMount(
  current: CharacterPlaybackState,
  movementPhase: CharacterMovementPhase,
): CharacterPlaybackState {
  if (!isStandingMovementMount(current, movementPhase) || current.actualPosture === 'stand') {
    return current;
  }
  return { ...current, actualPosture: 'stand' };
}

function play(
  state: CharacterPlaybackState,
  selection: ClipSelection,
  instant: boolean,
): CharacterPlaybackResult {
  return {
    state: { ...state, activeClip: selection.clip, activeSelection: selection },
    command: { selection, instant },
    completedTransition: null,
  };
}

/**
 * Resolve a new semantic target without allowing it to cut an active posture
 * transition. Rapid stand⇄sit reversals update `desired`; the current transition
 * completes atomically and only then starts the reverse transition.
 */
export function requestCharacterPlayback(
  current: CharacterPlaybackState,
  desired: CharacterPlaybackTarget,
  options: PlaybackRequestOptions,
): CharacterPlaybackResult {
  const semanticsChanged =
    current.desired?.selection.clip !== desired.selection.clip ||
    current.desired?.selection.semantic !== desired.selection.semantic ||
    current.desired?.selection.variant !== desired.selection.variant ||
    current.desired?.posture !== desired.posture;
  let state: CharacterPlaybackState = {
    ...current,
    desired,
    completedSelection: semanticsChanged ? null : current.completedSelection,
  };

  if (options.reducedMotion) {
    state = {
      ...state,
      actualPosture: desired.posture,
      transition: null,
      completedSelection: null,
    };
    if (sameSelectionIdentity(state.activeSelection, desired.selection) && !options.forceRestart) {
      return { state, command: null, completedTransition: null };
    }
    return play(state, desired.selection, true);
  }

  if (state.transition) {
    return { state, command: null, completedTransition: null };
  }

  if (state.actualPosture !== desired.posture) {
    const transitionClip: ClipName =
      desired.posture === 'sit'
        ? POSTURE_TRANSITION_CLIPS.sitEnter
        : POSTURE_TRANSITION_CLIPS.sitExit;
    state = {
      ...state,
      transition: { clip: transitionClip, targetPosture: desired.posture },
      completedSelection: null,
    };
    return play(state, selectionForClip(transitionClip), false);
  }

  if (
    !options.forceRestart &&
    (sameSelectionIdentity(state.activeSelection, desired.selection) ||
      sameSelectionIdentity(state.completedSelection, desired.selection))
  ) {
    return { state, command: null, completedTransition: null };
  }
  return play(state, desired.selection, false);
}

/**
 * Advance only when the mixer reports the action that this machine currently
 * owns. Stale cross-faded one-shots are ignored, so they cannot consume a newer
 * posture transition or re-entry target.
 */
export function finishCharacterPlayback(
  current: CharacterPlaybackState,
  finishedClip: ClipName,
): CharacterPlaybackResult {
  if (current.activeClip !== finishedClip) {
    return { state: current, command: null, completedTransition: null };
  }

  const transition = current.transition;
  if (transition) {
    if (transition.clip !== finishedClip) {
      return { state: current, command: null, completedTransition: null };
    }
    const state: CharacterPlaybackState = {
      ...current,
      actualPosture: transition.targetPosture,
      transition: null,
    };
    return { state, command: null, completedTransition: finishedClip };
  }

  const desired = current.desired;
  if (!desired || desired.selection.clip !== finishedClip || !desired.selection.returnTo) {
    return { state: current, command: null, completedTransition: null };
  }

  const resting = selectionForClip(desired.selection.returnTo);
  return play({ ...current, completedSelection: desired.selection }, resting, false);
}
