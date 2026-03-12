import type { ModelCostRateRow } from '../runtime/repositories.js';

/**
 * Convert a simple glob pattern (with `*` and `?` wildcards) to a RegExp.
 * Case-insensitive by default.
 */
export function globToRegex(pattern: string): RegExp {
  return new RegExp('^' + pattern.replace(/\*/g, '.*').replace(/\?/g, '.') + '$', 'i');
}

/**
 * Find the best-matching cost rate from an array, using glob pattern matching
 * on `model_pattern`. Returns the most specific match (longest pattern string)
 * or null if nothing matches.
 */
export function matchCostRate(
  rates: readonly ModelCostRateRow[],
  provider: string,
  model: string,
): ModelCostRateRow | null {
  const matching = rates.filter((r) => {
    if (r.provider !== provider) return false;
    return globToRegex(r.model_pattern).test(model);
  });
  if (matching.length === 0) return null;
  // Prefer the most specific pattern (longest pattern string)
  matching.sort((a, b) => b.model_pattern.length - a.model_pattern.length);
  return matching[0]!;
}
