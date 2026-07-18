export type Locomotion = 'idle' | 'walk';
export type Posture = 'stand' | 'sit';
export type CharacterStatus = 'idle' | 'working' | 'approval' | 'blocked';
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
