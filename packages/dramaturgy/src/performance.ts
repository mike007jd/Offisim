/**
 * Layered character performance state (Phase 3, source plan §8).
 *
 * Replaces the single coarse action enum (idle | working | active | dragging)
 * with composable layers so a small set of V1 fragments — driven by semantic
 * beats, never authored by the model — yields a large range of expression.
 * Both the 2D and 3D scenes consume this same state, so a beat looks consistent
 * across render modes.
 */
import type {
  AmbientRoutineKind,
  CharacterPerformanceState,
  CharacterStatus,
  Posture,
  RoutinePerformanceKind,
  SceneBeat,
  WorkGesture,
} from '@offisim/shared-types';
export type {
  CharacterPerformanceState,
  CharacterStatus,
  Expression,
  Locomotion,
  Posture,
  Prop,
  RoutinePerformanceKind,
  RoutineWorkGesture,
  SocialGesture,
  WorkGesture,
} from '@offisim/shared-types';

type AmbientMicroRoutineKind = Extract<
  AmbientRoutineKind,
  'desk-fidget' | 'look-around' | 'stretch'
>;

/** Stable loop-diversification lane carried by every performance state. */
export type PerformanceVariant = CharacterPerformanceState['variant'];

/**
 * Bounded projection of a beat's seed-derived variant onto the four-lane
 * performance variant. Pure and stable: the same beat always projects the
 * same lane, and the lane never escapes 0–3.
 */
function projectBeatVariant(variant: number): PerformanceVariant {
  return (((variant % 4) + 4) % 4) as PerformanceVariant;
}

/** A neutral resting state (used as the base layer / idle default). */
export const IDLE_PERFORMANCE: CharacterPerformanceState = {
  locomotion: 'idle',
  posture: 'sit',
  workGesture: 'none',
  socialGesture: 'none',
  expression: 'neutral',
  intensity: 0,
  variant: 0,
};

/**
 * Total fallback when an actor has status truth but no currently staged beat.
 * This keeps the diegetic layer truthful for beatless active/waiting snapshots
 * and lets non-office previews render without the removed CharacterAction lane.
 */
export function performanceForStatus(
  status: CharacterStatus,
  posture: Posture,
): CharacterPerformanceState {
  switch (status) {
    case 'working':
      return {
        locomotion: 'idle',
        posture,
        workGesture: posture === 'sit' ? 'type' : 'inspect-terminal',
        socialGesture: 'none',
        expression: 'focus',
        prop: posture === 'sit' ? 'laptop' : 'terminal',
        intensity: 1,
        variant: 0,
      };
    case 'approval':
      return {
        locomotion: 'idle',
        posture: 'stand',
        workGesture: 'approval-wait',
        socialGesture: 'none',
        expression: 'thinking',
        prop: 'document',
        intensity: 1,
        variant: 0,
      };
    case 'blocked':
      return {
        locomotion: 'idle',
        posture: 'stand',
        workGesture: 'none',
        socialGesture: 'none',
        expression: 'worried',
        intensity: 2,
        variant: 0,
      };
    case 'idle':
      return { ...IDLE_PERFORMANCE, posture };
  }
}

/**
 * Map a staged beat to the destination performance state (the at-anchor pose).
 * Locomotion is always `idle` here — the walk to the anchor is a transient the
 * scene animates during relocation, not part of the resting performance.
 *
 * This is a pure, total function: every BeatKind yields a defined state, so the
 * 2D and 3D scenes never diverge on how a beat looks.
 */
export function performanceForBeat(beat: SceneBeat): CharacterPerformanceState {
  const variant = projectBeatVariant(beat.variant);
  switch (beat.kind) {
    case 'receive-task':
      return { ...IDLE_PERFORMANCE, expression: 'focus', intensity: 1, variant };
    case 'plan':
      return {
        locomotion: 'idle',
        posture: 'stand',
        workGesture: 'write-board',
        socialGesture: 'none',
        expression: 'thinking',
        prop: 'pointer',
        intensity: 1,
        variant,
      };
    case 'delegate':
      return {
        locomotion: 'idle',
        posture: 'stand',
        workGesture: 'handoff',
        socialGesture: 'none',
        expression: 'focus',
        prop: 'document',
        intensity: 1,
        variant,
      };
    case 'review':
      return {
        locomotion: 'idle',
        posture: 'stand',
        workGesture: 'annotate',
        socialGesture: 'discuss',
        expression: 'focus',
        prop: 'pointer',
        intensity: 1,
        variant,
      };
    case 'research':
      return {
        locomotion: 'idle',
        posture: 'sit',
        workGesture: 'read',
        socialGesture: 'none',
        expression: 'focus',
        prop: 'document',
        intensity: 1,
        variant,
      };
    case 'compute':
      return {
        locomotion: 'idle',
        posture: 'stand',
        workGesture: 'inspect-terminal',
        socialGesture: 'none',
        expression: 'focus',
        prop: 'terminal',
        intensity: 1,
        variant,
      };
    case 'produce':
      return performanceForActivity(beat);
    case 'activity':
      return performanceForActivity(beat);
    case 'approval':
      return {
        locomotion: 'idle',
        posture: 'stand',
        workGesture: 'approval-wait',
        socialGesture: 'none',
        expression: 'thinking',
        prop: 'document',
        intensity: 1,
        variant,
      };
    case 'failure':
      return {
        locomotion: 'idle',
        posture: 'stand',
        workGesture: 'none',
        socialGesture: 'none',
        expression: 'worried',
        intensity: 2,
        variant,
      };
    case 'cancelled':
      // Neutral stopped state (PRD): the actor simply returns to rest — no
      // worried/blocked tell, no celebration.
      return { ...IDLE_PERFORMANCE, variant };
    case 'join':
      return {
        locomotion: 'idle',
        posture: 'stand',
        workGesture: 'handoff',
        socialGesture: 'nod',
        expression: 'neutral',
        prop: 'document',
        intensity: 1,
        variant,
      };
    case 'complete':
      return {
        locomotion: 'idle',
        posture: 'stand',
        workGesture: 'point',
        socialGesture: 'none',
        expression: 'happy',
        // Most completions use a restrained affirmative gesture; one seeded
        // variant gets the short dance. Both shipped clips therefore
        // have a real deterministic producer without making celebration noisy.
        intensity: beat.variant % 4 === 0 ? 2 : 1,
        variant,
      };
    default:
      return { ...IDLE_PERFORMANCE, variant };
  }
}

/**
 * Typed P5 seam for routine micro-actions. Keeping this in dramaturgy means the
 * ambient scheduler requests semantic behavior, never a renderer clip. Every
 * routine maps to an unambiguous explicit state; the variant lane is supplied
 * by the caller (seeded in ambient, projected for beats) and never inferred.
 */
export function performanceForRoutine(
  kind: RoutinePerformanceKind | AmbientMicroRoutineKind,
  variant: PerformanceVariant,
): CharacterPerformanceState {
  if (kind === 'social') {
    return {
      locomotion: 'idle',
      posture: 'stand',
      workGesture: 'none',
      socialGesture: 'discuss',
      expression: 'neutral',
      intensity: 0,
      variant,
    };
  }
  if (kind === 'seated-shift') {
    return {
      locomotion: 'idle',
      posture: 'sit',
      workGesture: 'seated-shift',
      socialGesture: 'none',
      expression: 'neutral',
      intensity: 0,
      variant,
    };
  }
  if (kind === 'desk-fidget') {
    return {
      locomotion: 'idle',
      posture: 'sit',
      workGesture: 'desk-fidget',
      socialGesture: 'none',
      expression: 'neutral',
      intensity: 0,
      variant,
    };
  }
  if (kind === 'look-around') {
    return {
      locomotion: 'idle',
      posture: 'stand',
      workGesture: 'look-around',
      socialGesture: 'none',
      expression: 'neutral',
      intensity: 0,
      variant,
    };
  }
  if (kind === 'stretch') {
    return {
      locomotion: 'idle',
      posture: 'stand',
      workGesture: 'stretch',
      socialGesture: 'none',
      expression: 'neutral',
      intensity: 0,
      variant,
    };
  }
  const workGesture: WorkGesture = kind === 'inspect' ? 'read' : kind;
  return {
    locomotion: 'idle',
    posture: 'stand',
    workGesture,
    socialGesture: kind === 'phone' ? 'listen' : 'none',
    expression: kind === 'phone' || kind === 'inspect' ? 'focus' : 'neutral',
    ...(kind === 'inspect' ? { prop: 'document' as const } : {}),
    intensity: 0,
    variant,
  };
}

/** Activity/produce beats refine the work gesture from the tool-fact activity kind. */
function performanceForActivity(beat: SceneBeat): CharacterPerformanceState {
  const variant = projectBeatVariant(beat.variant);
  // Artifact milestones are delivery choreography, never another workstation
  // typing beat. At rest this plays the handoff/pickup gesture; while the scene
  // is relocating the actor, the same document-bearing state selects `carry`.
  if (beat.artifact) {
    return {
      locomotion: 'idle',
      posture: 'stand',
      workGesture: 'handoff',
      socialGesture: 'none',
      expression: 'focus',
      prop: 'document',
      intensity: 1,
      variant,
    };
  }
  switch (beat.activityKind) {
    case 'read':
    case 'search':
      return {
        locomotion: 'idle',
        posture: 'sit',
        workGesture: 'read',
        socialGesture: 'none',
        expression: 'focus',
        prop: 'document',
        intensity: 1,
        variant,
      };
    case 'shell':
    case 'build':
    case 'test':
      return {
        locomotion: 'idle',
        posture: 'stand',
        workGesture: 'inspect-terminal',
        socialGesture: 'none',
        expression: 'focus',
        prop: 'terminal',
        intensity: 1,
        variant,
      };
    case 'inspect':
      return {
        locomotion: 'idle',
        posture: 'sit',
        workGesture: 'inspect-terminal',
        socialGesture: 'none',
        expression: 'focus',
        prop: 'terminal',
        intensity: 1,
        variant,
      };
    case 'wait':
      return { ...IDLE_PERFORMANCE, expression: 'thinking', intensity: 0, variant };
    default:
      // write / edit / artifact / unknown → typing at the workstation.
      return {
        locomotion: 'idle',
        posture: 'sit',
        workGesture: 'type',
        socialGesture: 'none',
        expression: 'focus',
        prop: 'laptop',
        intensity: 1,
        variant,
      };
  }
}
