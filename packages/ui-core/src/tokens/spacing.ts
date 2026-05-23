export type SpacingStep = 0 | 1 | 2 | 3 | 4 | 5 | 6 | 8 | 12 | 16;

export const SPACING_SCALE: Record<SpacingStep, number> = {
  0: 0,
  1: 4,
  2: 8,
  3: 12,
  4: 16,
  5: 20,
  6: 24,
  8: 32,
  12: 48,
  16: 64,
};

/** Tailwind class-name map per step, for code-mod / migration scripts. */
export const SPACING_TAILWIND_CLASSES: Record<SpacingStep, string> = {
  0: '0',
  1: '1',
  2: '2',
  3: '3',
  4: '4',
  5: '5',
  6: '6',
  8: '8',
  12: '12',
  16: '16',
};

export type DensityMode = 'normal' | 'compact' | 'spacious';
export type DensityStep = 1 | 2 | 3 | 4 | 5 | 6 | 7 | 8;

/**
 * V3 product density scale (`--sp-1`..`--sp-8`). `normal` is the prototype's
 * verbatim `:root` ramp; `compact`/`spacious` shift it tighter / looser. These
 * are independent of `SPACING_SCALE` (which stays Tailwind-default-compatible so
 * `p-3`/`gap-2` keep their conventional values).
 */
export const SP_DENSITY: Record<DensityMode, Record<DensityStep, number>> = {
  normal: { 1: 4, 2: 6, 3: 8, 4: 10, 5: 12, 6: 14, 7: 16, 8: 20 },
  compact: { 1: 2, 2: 4, 3: 6, 4: 8, 5: 10, 6: 12, 7: 14, 8: 18 },
  spacious: { 1: 6, 2: 8, 3: 10, 4: 12, 5: 14, 6: 18, 7: 22, 8: 28 },
};

export function getSpacingPx(step: SpacingStep): number {
  return SPACING_SCALE[step];
}
