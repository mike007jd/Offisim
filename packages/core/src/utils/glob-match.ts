import type { ModelCostRateRow } from '../runtime/repositories.js';

/**
 * Convert a simple glob pattern (with `*` and `?` wildcards) to a RegExp.
 * Case-insensitive by default.
 *
 * Security (the actual fix): all regex metacharacters in the pattern are
 * escaped FIRST, so a cost pattern like `gpt-4.1` matches the literal dot (not
 * any char) and a permission rule like `tool.read` cannot be silently widened
 * by an injected `.`, `(`, `|`, etc. Without this, `gpt-4.1` would also match
 * `gpt-4X1`, and a crafted pattern could over- or under-match identities.
 *
 * Wildcards are translated only AFTER escaping:
 *  - `*` → `.*` (greedy, crosses `:`)
 *  - `?` → `.`
 *
 * NOTE on segment scoping: we deliberately keep `*` greedy (`.*`) rather than
 * a segment-scoped `[^:]*`. Permission/deny identities are multi-segment
 * (`mcp:<server>:<tool>` — see buildRuntimeIdentities). A segment-scoped `*`
 * would make a broad DENY rule like `mcp:*` stop matching `mcp:server:tool`,
 * silently *weakening* the deny — a security regression. Greedy `*` preserves
 * deny breadth and matches the historical/expected glob behavior; the escaping
 * above is what closes the real injection hole. The file-glob builtin
 * (search-tools.ts) keeps its own `[^/]*` semantics for path patterns.
 */
export function globToRegex(pattern: string): RegExp {
  const escaped = pattern.replace(/[.+^${}()|[\]\\]/g, '\\$&');
  const translated = escaped.replace(/\*/g, '.*').replace(/\?/g, '.');
  return new RegExp(`^${translated}$`, 'i');
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
  return matching[0] ?? null;
}
