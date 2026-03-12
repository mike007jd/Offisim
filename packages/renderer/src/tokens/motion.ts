/** Motion buckets — source: DESIGN_RULES §motion */
export interface MotionBucket {
  readonly duration: number;
  readonly ease: string;
}

/** M0: static — no animation */
export const M0: MotionBucket = { duration: 0, ease: 'none' };

/** M1: slow entrance / exit */
export const M1: MotionBucket = { duration: 0.6, ease: 'power2.out' };

/** M2: standard transition */
export const M2: MotionBucket = { duration: 0.4, ease: 'power2.out' };

/** M3: snappy micro-interaction */
export const M3: MotionBucket = { duration: 0.3, ease: 'back.out(1.2)' };

/** Reduced-motion overrides */
export const M1_REDUCED: MotionBucket = { duration: 0, ease: 'none' };
export const M2_REDUCED: MotionBucket = { duration: 0, ease: 'none' };
export const M3_REDUCED: MotionBucket = { duration: 0.1, ease: 'none' };

export const MOTION = { M0, M1, M2, M3 } as const;
export const MOTION_REDUCED = { M0, M1: M1_REDUCED, M2: M2_REDUCED, M3: M3_REDUCED } as const;

// --- Performance tiers (ANIM-034) ---

export type PerformanceTier = 'A' | 'B' | 'C';

export type MotionTokens = Record<'M0' | 'M1' | 'M2' | 'M3', MotionBucket>;

export const MOTION_TIER_A: MotionTokens = MOTION;

export const MOTION_TIER_B: MotionTokens = {
  M0: { duration: 0, ease: 'none' },
  M1: { duration: 0.2, ease: 'sine.inOut' },
  M2: { duration: 0.15, ease: 'quad.inOut' },
  M3: { duration: 0.1, ease: 'power2.out' },
};

export const MOTION_TIER_C: MotionTokens = MOTION_REDUCED;

/** Get motion tokens for the given performance tier. */
export function getMotionForTier(tier: PerformanceTier): MotionTokens {
  switch (tier) {
    case 'A': return MOTION_TIER_A;
    case 'B': return MOTION_TIER_B;
    case 'C': return MOTION_TIER_C;
  }
}
