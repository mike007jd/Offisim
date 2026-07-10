/**
 * Layered character performance state (Phase 3, source plan §8).
 *
 * Replaces the single coarse action enum (idle | working | active | dragging)
 * with composable layers so a small set of V1 fragments — driven by semantic
 * beats, never authored by the model — yields a large range of expression.
 * Both the 2D and 3D scenes consume this same state, so a beat looks consistent
 * across render modes.
 */
import type { SceneBeat } from './beat-composer.js';

export type Locomotion = 'idle' | 'walk';
export type Posture = 'stand' | 'sit';

/**
 * The office's operational state vocabulary. Selection is deliberately absent:
 * it is an orthogonal interaction layer and must never rewrite performance.
 * Delivery is also separate (`ActorCue.delivering`) because it is a short
 * choreography within ordinary work, not a fifth status colour.
 */
export type CharacterStatus = 'idle' | 'working' | 'approval' | 'blocked';

/** The V1 work-gesture fragments (source plan §8). */
export type WorkGesture =
  | 'none'
  | 'type'
  | 'read'
  | 'note'
  | 'inspect-terminal'
  | 'write-board'
  | 'point'
  | 'annotate'
  | 'handoff'
  | 'approval-wait'
  | 'phone'
  | 'consume';

/** Reserved deterministic micro-actions consumed by the P5 ambient scheduler. */
export type RoutineWorkGesture = Extract<WorkGesture, 'phone' | 'consume'>;
export type RoutinePerformanceKind = RoutineWorkGesture | 'inspect';

export type SocialGesture = 'none' | 'listen' | 'nod' | 'discuss';
export type Expression = 'neutral' | 'focus' | 'thinking' | 'worried' | 'happy';
export type Prop = 'laptop' | 'document' | 'tablet' | 'terminal' | 'pointer';

export interface CharacterPerformanceState {
  readonly locomotion: Locomotion;
  readonly posture: Posture;
  readonly workGesture: WorkGesture;
  readonly socialGesture: SocialGesture;
  readonly expression: Expression;
  readonly prop?: Prop;
  readonly intensity: 0 | 1 | 2;
}

/** A neutral resting state (used as the base layer / idle default). */
export const IDLE_PERFORMANCE: CharacterPerformanceState = {
  locomotion: 'idle',
  posture: 'sit',
  workGesture: 'none',
  socialGesture: 'none',
  expression: 'neutral',
  intensity: 0,
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
      };
    case 'blocked':
      return {
        locomotion: 'idle',
        posture: 'stand',
        workGesture: 'none',
        socialGesture: 'none',
        expression: 'worried',
        intensity: 2,
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
  switch (beat.kind) {
    case 'receive-task':
      return { ...IDLE_PERFORMANCE, expression: 'focus', intensity: 1 };
    case 'plan':
      return {
        locomotion: 'idle',
        posture: 'stand',
        workGesture: 'write-board',
        socialGesture: 'none',
        expression: 'thinking',
        prop: 'pointer',
        intensity: 1,
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
      };
    case 'failure':
      return {
        locomotion: 'idle',
        posture: 'stand',
        workGesture: 'none',
        socialGesture: 'none',
        expression: 'worried',
        intensity: 2,
      };
    case 'cancelled':
      // Neutral stopped state (PRD): the actor simply returns to rest — no
      // worried/blocked tell, no celebration.
      return IDLE_PERFORMANCE;
    case 'join':
      return {
        locomotion: 'idle',
        posture: 'stand',
        workGesture: 'handoff',
        socialGesture: 'nod',
        expression: 'neutral',
        prop: 'document',
        intensity: 1,
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
      };
    default:
      return IDLE_PERFORMANCE;
  }
}

/**
 * Typed P5 seam for routine micro-actions. Keeping this in dramaturgy means the
 * future ambient scheduler requests semantic behavior, never a renderer clip.
 */
export function performanceForRoutine(kind: RoutinePerformanceKind): CharacterPerformanceState {
  const workGesture: WorkGesture = kind === 'inspect' ? 'read' : kind;
  return {
    locomotion: 'idle',
    posture: 'stand',
    workGesture,
    socialGesture: kind === 'phone' ? 'listen' : 'none',
    expression: kind === 'phone' || kind === 'inspect' ? 'focus' : 'neutral',
    ...(kind === 'inspect' ? { prop: 'document' as const } : {}),
    intensity: 0,
  };
}

/** Activity/produce beats refine the work gesture from the tool-fact activity kind. */
function performanceForActivity(beat: SceneBeat): CharacterPerformanceState {
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
      };
    case 'wait':
      return { ...IDLE_PERFORMANCE, expression: 'thinking', intensity: 0 };
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
      };
  }
}
