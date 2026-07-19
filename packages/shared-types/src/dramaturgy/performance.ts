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

/** Deterministic micro-actions consumed by the P5 ambient scheduler. */
export type RoutineWorkGesture = Extract<WorkGesture, 'phone' | 'consume'>;
export type RoutinePerformanceKind = RoutineWorkGesture | 'inspect' | 'social' | 'seated-shift';

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
