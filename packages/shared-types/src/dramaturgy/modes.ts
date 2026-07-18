export type DramaturgyMode = 'focus' | 'office' | 'cinematic';

export interface DramaturgyModeOptions {
  readonly mode: DramaturgyMode;
  readonly reducedMotion?: boolean;
  readonly maxWalkers?: number;
}

export interface AmbientModePolicy {
  readonly enabled: boolean;
  readonly maxAway: number;
  readonly maxActiveActors: number;
}
