import type { CharacterPerformanceState } from '@offisim/shared-types';

/**
 * Pure mapping from the layered {@link CharacterPerformanceState} onto the
 * neutral animation clip scheme emitted by `scripts/build-character-assets.mjs`
 * (see the rename table in that script's header). Deterministic and total:
 * every state yields a defined selection, falling back to the posture idle.
 *
 * Generic long-lived families are intentional: standing manipulation gestures
 * share `interact`, standing document inspection uses `inspect.open`, and
 * thinking rests in `wait.foldarms`. Seated typing and approval are authored
 * clips, not talk/blocked proxies. `phone` / `consume` have a typed P5 routine
 * seam; `sit.enter` / `sit.exit` are posture transitions and `tpose` is the rig
 * reference.
 */

/** Every clip emitted into animations.glb — must match manifest.json `clips`. */
export const CLIP_NAMES = [
  'approval.wait',
  'blocked.headshake',
  'carry',
  'celebrate.dance',
  'celebrate.yes',
  'consume',
  'idle',
  'idle.talk',
  'inspect.open',
  'interact',
  'phone',
  'pickup',
  'sit.enter',
  'sit.exit',
  'sit.idle',
  'sit.talk',
  'sit.type',
  'tpose',
  'wait.foldarms',
  'walk',
  'walk.formal',
] as const;

/** P0/P3 art-budget contract: future phases may not silently bloat the library. */
export const MAX_CHARACTER_CLIPS = 24;

export type ClipName = (typeof CLIP_NAMES)[number];

export interface ClipSelection {
  readonly clip: ClipName;
  /** Looping ambient clip; one-shots without `returnTo` hold their last frame. */
  readonly loop: boolean;
  /** Crossfade duration in seconds when entering this clip. */
  readonly fade: number;
  /** Stable static sample used when reduced motion freezes animation. */
  readonly reducedPoseTime: number;
  /** Optional resting clip entered once this one-shot completes. */
  readonly returnTo?: ClipName;
}

const LOCOMOTION_FADE = 0.15;
const CELEBRATE_FADE = 0.2;
const DEFAULT_FADE = 0.3;

/** Playback metadata for every shipped clip (total over CLIP_NAMES). */
export const CLIP_META: Record<ClipName, Omit<ClipSelection, 'clip'>> = {
  'approval.wait': { loop: false, fade: 0.22, reducedPoseTime: 1.6 },
  'blocked.headshake': {
    loop: false,
    fade: 0.22,
    reducedPoseTime: 1.2,
    returnTo: 'wait.foldarms',
  },
  carry: { loop: true, fade: LOCOMOTION_FADE, reducedPoseTime: 0.25 },
  'celebrate.dance': {
    loop: false,
    fade: CELEBRATE_FADE,
    reducedPoseTime: 0.5,
    returnTo: 'idle',
  },
  'celebrate.yes': {
    loop: false,
    fade: CELEBRATE_FADE,
    reducedPoseTime: 1.2,
    returnTo: 'idle',
  },
  consume: { loop: false, fade: 0.22, reducedPoseTime: 0.65, returnTo: 'idle' },
  idle: { loop: true, fade: DEFAULT_FADE, reducedPoseTime: 0 },
  'idle.talk': { loop: true, fade: DEFAULT_FADE, reducedPoseTime: 0.6 },
  'inspect.open': { loop: false, fade: 0.24, reducedPoseTime: 0.8 },
  interact: { loop: true, fade: 0.24, reducedPoseTime: 0.4 },
  phone: { loop: true, fade: 0.24, reducedPoseTime: 0.8 },
  pickup: { loop: false, fade: 0.24, reducedPoseTime: 0.7 },
  'sit.enter': { loop: false, fade: LOCOMOTION_FADE, reducedPoseTime: 0 },
  'sit.exit': { loop: false, fade: LOCOMOTION_FADE, reducedPoseTime: 0 },
  'sit.idle': { loop: true, fade: DEFAULT_FADE, reducedPoseTime: 0 },
  'sit.talk': { loop: true, fade: DEFAULT_FADE, reducedPoseTime: 0.7 },
  'sit.type': { loop: true, fade: 0.22, reducedPoseTime: 0.4 },
  tpose: { loop: false, fade: DEFAULT_FADE, reducedPoseTime: 0 },
  'wait.foldarms': { loop: true, fade: 0.24, reducedPoseTime: 0.7 },
  walk: { loop: true, fade: LOCOMOTION_FADE, reducedPoseTime: 0.2 },
  'walk.formal': { loop: true, fade: LOCOMOTION_FADE, reducedPoseTime: 0.2 },
};

/** Posture transition clips (played by GltfCharacter between stand ⇄ sit). */
export const POSTURE_TRANSITION_CLIPS = {
  sitEnter: 'sit.enter',
  sitExit: 'sit.exit',
} as const satisfies Record<string, ClipName>;

function select(clip: ClipName): ClipSelection {
  return { clip, ...CLIP_META[clip] };
}

/** Explicit clip selection for the release QA sequencer; shares production playback metadata. */
export function selectionForClip(clip: ClipName): ClipSelection {
  return select(clip);
}

function walkClip(perf: CharacterPerformanceState): ClipName {
  const carrying =
    perf.workGesture === 'handoff' ||
    perf.prop === 'laptop' ||
    perf.prop === 'document' ||
    perf.prop === 'tablet';
  if (carrying) return 'carry';
  if (perf.intensity === 2) return 'walk.formal';
  return 'walk';
}

function sitClip(perf: CharacterPerformanceState): ClipName {
  switch (perf.workGesture) {
    case 'type':
    case 'note':
    case 'annotate':
      return 'sit.type';
    case 'read':
    case 'inspect-terminal':
    case 'write-board':
    case 'point':
    case 'handoff':
    case 'approval-wait':
    case 'phone':
    case 'consume':
      return 'sit.idle';
    default:
      break;
  }
  if (perf.socialGesture === 'nod' || perf.socialGesture === 'discuss') return 'sit.talk';
  return 'sit.idle';
}

function standClip(perf: CharacterPerformanceState): ClipName {
  if (perf.workGesture === 'approval-wait') return 'approval.wait';
  if (perf.workGesture === 'phone') return 'phone';
  if (perf.workGesture === 'consume') return 'consume';
  if (perf.workGesture === 'point' && perf.expression === 'happy') {
    return perf.intensity === 2 ? 'celebrate.dance' : 'celebrate.yes';
  }
  switch (perf.workGesture) {
    case 'handoff':
      return 'pickup';
    case 'read':
      return 'inspect.open';
    case 'type':
    case 'note':
    case 'inspect-terminal':
    case 'write-board':
    case 'annotate':
      return 'interact';
    case 'point':
      return 'idle.talk';
    default:
      break;
  }
  if (perf.expression === 'worried') {
    return perf.intensity === 2 ? 'blocked.headshake' : 'wait.foldarms';
  }
  if (perf.expression === 'thinking') return 'wait.foldarms';
  if (perf.socialGesture === 'nod' || perf.socialGesture === 'discuss') return 'idle.talk';
  return 'idle';
}

/**
 * Total, deterministic clip selection for a performance state.
 * Never returns undefined; unknown combinations fall back to the posture idle.
 */
export function clipForPerformance(perf: CharacterPerformanceState): ClipSelection {
  if (perf.locomotion === 'walk') return select(walkClip(perf));
  if (perf.posture === 'sit') return select(sitClip(perf));
  return select(standClip(perf));
}

/** The resting clip for a posture — the deterministic fallback / re-entry pose. */
export function idleClipForPosture(posture: CharacterPerformanceState['posture']): ClipSelection {
  return select(posture === 'sit' ? 'sit.idle' : 'idle');
}
