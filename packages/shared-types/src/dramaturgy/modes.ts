export type DramaturgyMode = 'focus' | 'office' | 'cinematic';

export interface DramaturgyModeOptions {
  readonly mode: DramaturgyMode;
  /** Accessibility: suppress all relocation regardless of mode. */
  readonly reducedMotion?: boolean;
  /** Office-mode cap on simultaneous relocations. */
  readonly maxWalkers?: number;
}

/** Independent density budget for the non-AI P5 ambient-life layer. */
export interface AmbientModePolicy {
  readonly enabled: boolean;
  readonly maxAway: number;
  readonly maxActiveActors: number;
}
