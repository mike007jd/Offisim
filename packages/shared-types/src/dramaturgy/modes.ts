/**
 * Dramaturgy presentation modes (Phase 5, source plan §13).
 *
 * A mode changes only movement DENSITY over the office staging — performance,
 * beats, actors, status, and run relations are untouched. Every mode therefore
 * renders the same semantic truth and none can invent facts.
 */
import type { EmployeeStaging } from './office-projection.js';

export type DramaturgyMode = 'focus' | 'office' | 'cinematic';

export interface DramaturgyModeOptions {
  readonly mode: DramaturgyMode;
  /** Accessibility: suppress all relocation regardless of mode. */
  readonly reducedMotion?: boolean;
  /** Office-mode cap on simultaneous relocations. */
  readonly maxWalkers?: number;
}

export const DEFAULT_MAX_WALKERS = 4;

/**
 *  - Focus / reduced-motion: nobody relocates (status + performance stay in place).
 *  - Office (default): at most `maxWalkers` relocate — the highest-priority beats
 *    win, the rest stay home with their performance.
 *  - Cinematic: every high-value movement relocates.
 *
 * Pure + deterministic: only the `staging` (relocation anchor) field is ever
 * cleared; `performance`, `beat`, and the actor set are preserved exactly.
 */
export function applyDramaturgyMode(
  staging: readonly EmployeeStaging[],
  opts: DramaturgyModeOptions,
): EmployeeStaging[] {
  if (opts.reducedMotion || opts.mode === 'focus') {
    return staging.map((s) => (s.staging === null ? s : { ...s, staging: null }));
  }
  if (opts.mode === 'cinematic') return [...staging];

  const cap = opts.maxWalkers ?? DEFAULT_MAX_WALKERS;
  const movers = staging.filter((s) => s.staging !== null);
  if (movers.length <= cap) return [...staging];

  const allowed = new Set(
    [...movers]
      .sort((a, b) => b.beat.priority - a.beat.priority || (a.employeeId < b.employeeId ? -1 : 1))
      .slice(0, cap)
      .map((s) => s.employeeId),
  );
  return staging.map((s) =>
    s.staging !== null && !allowed.has(s.employeeId) ? { ...s, staging: null } : s,
  );
}
