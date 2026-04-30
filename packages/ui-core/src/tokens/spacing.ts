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

export function getSpacingPx(step: SpacingStep): number {
  return SPACING_SCALE[step];
}
