/**
 * Pure presentation pace projection.
 *
 * Declared fast is trusted input from an engine lane. Observed cadence is only
 * a neutral choreography signal derived from real event timestamps; it can
 * tighten presentation but can never label a run as fast.
 */
export type DeclaredPaceMode = 'normal' | 'fast';

export interface PaceSignal {
  readonly declaredMode: DeclaredPaceMode;
  readonly beatHoldMultiplier: number;
  readonly transitionMultiplier: number;
  readonly animationTempoMultiplier: number;
}

export const NEUTRAL_PACE: PaceSignal = Object.freeze({
  declaredMode: 'normal',
  beatHoldMultiplier: 1,
  transitionMultiplier: 1,
  animationTempoMultiplier: 1,
});

const CADENCE_WINDOW_MS = 30_000;
const CADENCE_STALE_MS = 12_000;
const DECLARED_PACE_STALE_MS = 12_000;

function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value));
}

/**
 * Return a hold multiplier in [0.68, 1]. Sparse or stale streams are exactly 1.
 * The median interval makes the result resistant to one burst or long pause.
 */
export function observedCadenceMultiplier(timestamps: readonly number[], now: number): number {
  if (!Number.isFinite(now)) return 1;
  const recent = [...new Set(timestamps.filter((at) => Number.isFinite(at)))]
    .filter((at) => at <= now && now - at <= CADENCE_WINDOW_MS)
    .sort((a, b) => a - b);
  if (recent.length < 3 || now - (recent.at(-1) ?? 0) > CADENCE_STALE_MS) return 1;

  const intervals: number[] = [];
  for (let index = 1; index < recent.length; index += 1) {
    const gap = (recent[index] ?? 0) - (recent[index - 1] ?? 0);
    if (gap > 0) intervals.push(gap);
  }
  if (intervals.length < 2) return 1;
  intervals.sort((a, b) => a - b);
  const middle = Math.floor(intervals.length / 2);
  const median =
    intervals.length % 2 === 0
      ? ((intervals[middle - 1] ?? 0) + (intervals[middle] ?? 0)) / 2
      : (intervals[middle] ?? 0);

  if (median <= 1_000) return 0.68;
  if (median <= 2_500) return 0.78;
  if (median <= 5_000) return 0.9;
  return 1;
}

/**
 * Keep an engine-reported speed mode only while its terminal performance is
 * still on stage. Missing, future, or stale usage is normal by construction.
 */
export function activeDeclaredPaceMode(
  reportedMode: 'standard' | 'fast' | undefined,
  reportedAt: number | undefined,
  now: number,
): DeclaredPaceMode {
  if (
    reportedMode !== 'fast' ||
    !Number.isFinite(reportedAt) ||
    !Number.isFinite(now) ||
    (reportedAt ?? now) > now ||
    now - (reportedAt ?? now) > DECLARED_PACE_STALE_MS
  ) {
    return 'normal';
  }
  return 'fast';
}

export function composePaceSignal(input: {
  readonly declaredMode?: DeclaredPaceMode;
  readonly observedCadence?: number;
}): PaceSignal {
  const declaredMode = input.declaredMode === 'fast' ? 'fast' : 'normal';
  const observed = clamp(
    Number.isFinite(input.observedCadence) ? (input.observedCadence ?? 1) : 1,
    0.68,
    1,
  );
  const declaredHold = declaredMode === 'fast' ? 0.76 : 1;
  const declaredTransition = declaredMode === 'fast' ? 0.72 : 1;
  const declaredTempo = declaredMode === 'fast' ? 1.24 : 1;

  return Object.freeze({
    declaredMode,
    beatHoldMultiplier: clamp(observed * declaredHold, 0.55, 1),
    transitionMultiplier: clamp(observed * declaredTransition, 0.55, 1),
    animationTempoMultiplier: clamp(declaredTempo * (1 + (1 - observed) * 0.75), 1, 1.48),
  });
}

/** Compose role flavor after presentation pace, within readable clip bounds. */
export function animationTempoForPace(roleTempo: number, pace: PaceSignal): number {
  const safeRoleTempo = Number.isFinite(roleTempo) ? roleTempo : 1;
  return clamp(safeRoleTempo * pace.animationTempoMultiplier, 0.72, 1.72);
}
