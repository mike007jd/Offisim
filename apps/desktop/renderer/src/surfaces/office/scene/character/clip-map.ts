import type { CharacterPerformanceState } from '@offisim/shared-types';

/**
 * Pure mapping from the layered {@link CharacterPerformanceState} onto the
 * neutral animation clip scheme emitted by `scripts/build-character-assets.mjs`
 * (see the rename table in that script's header). Deterministic and total:
 * every state yields a defined selection, falling back to the posture idle.
 *
 * Documented proxy choices until custom clips are authored:
 *  - `type` / `note` / `annotate` while seated → `sit.talk` (desk-work proxy —
 *    the seated gesturing loop reads as active desk work at office camera
 *    distance; a true seated-typing clip replaces it later).
 *  - `read` while standing → `inspect.open` (open-and-hold reads as opening a
 *    document; one-shot clips clamp on their final frame).
 *  - standing `type`/`note`/`inspect-terminal`/`write-board`/`annotate` →
 *    `interact` looped (repeated manipulation reads as ongoing work).
 *  - `worried` (no work gesture) → `wait.foldarms`; escalated worry
 *    (intensity 2 — the failure beat) → `blocked.headshake`.
 *  - `thinking` while standing idle → `wait.foldarms`.
 *
 * `phone` and `consume` are shipped but not reachable from performance state
 * yet (reserved for break-room / call cues); `sit.enter` / `sit.exit` are
 * posture transitions driven by GltfCharacter; `tpose` is the rig reference.
 */

/** Every clip emitted into animations.glb — must match manifest.json `clips`. */
export const CLIP_NAMES = [
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
  'tpose',
  'wait.foldarms',
  'walk',
  'walk.formal',
] as const;

export type ClipName = (typeof CLIP_NAMES)[number];

export interface ClipSelection {
  readonly clip: ClipName;
  /** Looping ambient clip; non-looping clips play once and clamp on the last frame. */
  readonly loop: boolean;
  /** Crossfade duration in seconds when entering this clip. */
  readonly fade: number;
}

const LOCOMOTION_FADE = 0.15;
const CELEBRATE_FADE = 0.2;
const DEFAULT_FADE = 0.3;

const SEATED_OFFSET_CLIPS = new Set<ClipName>(['sit.enter', 'sit.idle', 'sit.talk']);

/** Playback metadata for every shipped clip (total over CLIP_NAMES). */
export const CLIP_META: Record<ClipName, { loop: boolean; fade: number }> = {
  'blocked.headshake': { loop: true, fade: DEFAULT_FADE },
  carry: { loop: true, fade: LOCOMOTION_FADE },
  'celebrate.dance': { loop: true, fade: CELEBRATE_FADE },
  'celebrate.yes': { loop: false, fade: CELEBRATE_FADE },
  consume: { loop: false, fade: DEFAULT_FADE },
  idle: { loop: true, fade: DEFAULT_FADE },
  'idle.talk': { loop: true, fade: DEFAULT_FADE },
  'inspect.open': { loop: false, fade: DEFAULT_FADE },
  interact: { loop: true, fade: DEFAULT_FADE },
  phone: { loop: true, fade: DEFAULT_FADE },
  pickup: { loop: false, fade: DEFAULT_FADE },
  'sit.enter': { loop: false, fade: LOCOMOTION_FADE },
  'sit.exit': { loop: false, fade: LOCOMOTION_FADE },
  'sit.idle': { loop: true, fade: DEFAULT_FADE },
  'sit.talk': { loop: true, fade: DEFAULT_FADE },
  tpose: { loop: false, fade: DEFAULT_FADE },
  'wait.foldarms': { loop: true, fade: DEFAULT_FADE },
  walk: { loop: true, fade: LOCOMOTION_FADE },
  'walk.formal': { loop: true, fade: LOCOMOTION_FADE },
};

/** Posture transition clips (played by GltfCharacter between stand ⇄ sit). */
export const POSTURE_TRANSITION_CLIPS = {
  sitEnter: 'sit.enter',
  sitExit: 'sit.exit',
} as const satisfies Record<string, ClipName>;

function select(clip: ClipName): ClipSelection {
  return { clip, loop: CLIP_META[clip].loop, fade: CLIP_META[clip].fade };
}

/** Explicit clip selection for the release QA sequencer; shares production playback metadata. */
export function selectionForClip(clip: ClipName): ClipSelection {
  return select(clip);
}

/** Whether a directly-driven clip uses the seated body/workstation alignment. */
export function clipUsesSeatedOffset(clip: ClipName): boolean {
  return SEATED_OFFSET_CLIPS.has(clip);
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
    case 'handoff':
      return 'sit.talk';
    case 'read':
    case 'inspect-terminal':
    case 'write-board':
    case 'point':
      return 'sit.idle';
    default:
      break;
  }
  if (perf.socialGesture === 'nod' || perf.socialGesture === 'discuss') return 'sit.talk';
  return 'sit.idle';
}

function standClip(perf: CharacterPerformanceState): ClipName {
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
