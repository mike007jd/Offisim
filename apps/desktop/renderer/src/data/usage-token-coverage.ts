export type TokenCoverage = 'complete' | 'partial' | 'unavailable';

export interface UsageTokenSummary {
  knownTokens: number;
  coverage: TokenCoverage;
}

const TOKEN_BUCKETS = ['input', 'output', 'cacheRead', 'cacheWrite'] as const;

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value);
}

function finiteNonNegative(value: unknown): value is number {
  return typeof value === 'number' && Number.isFinite(value) && value >= 0;
}

/**
 * Summarize the only additive token buckets in AgentRunUsage. Output already
 * includes reasoning, so reasoning is intentionally excluded. Missing provider
 * fields remain partial/unavailable instead of becoming fabricated zeroes.
 */
export function summarizeUsageTokens(value: unknown): UsageTokenSummary {
  if (!isRecord(value)) return { knownTokens: 0, coverage: 'unavailable' };
  const knownTokens = TOKEN_BUCKETS.reduce(
    (sum, key) => sum + (finiteNonNegative(value[key]) ? value[key] : 0),
    0,
  );
  const scope = isRecord(value.scope) ? value.scope : undefined;
  const fieldCoverage = isRecord(value.fieldCoverage) ? value.fieldCoverage : undefined;
  const complete =
    scope?.kind === 'task-aggregate'
      ? TOKEN_BUCKETS.every((key) => {
          const coverage =
            fieldCoverage && isRecord(fieldCoverage[key]) ? fieldCoverage[key] : null;
          return (
            coverage !== null &&
            finiteNonNegative(coverage.knownContributions) &&
            finiteNonNegative(coverage.totalContributions) &&
            coverage.totalContributions > 0 &&
            coverage.knownContributions === coverage.totalContributions
          );
        })
      : TOKEN_BUCKETS.every((key) => finiteNonNegative(value[key]));
  if (complete) return { knownTokens, coverage: 'complete' };
  const hasKnownBucket = TOKEN_BUCKETS.some((key) => finiteNonNegative(value[key]));
  return {
    knownTokens,
    coverage: hasKnownBucket ? 'partial' : 'unavailable',
  };
}

export function combineUsageTokenSummaries(
  summaries: readonly UsageTokenSummary[],
): UsageTokenSummary {
  if (summaries.length === 0) return { knownTokens: 0, coverage: 'unavailable' };
  const knownTokens = summaries.reduce((sum, summary) => sum + summary.knownTokens, 0);
  if (summaries.every((summary) => summary.coverage === 'complete')) {
    return { knownTokens, coverage: 'complete' };
  }
  return {
    knownTokens,
    coverage:
      knownTokens > 0 || summaries.some((summary) => summary.coverage === 'partial')
        ? 'partial'
        : 'unavailable',
  };
}

export function exactUsageTokens(summary: UsageTokenSummary): number | null {
  return summary.coverage === 'complete' ? summary.knownTokens : null;
}

export function formatUsageTokens(summary: UsageTokenSummary): string {
  if (summary.coverage === 'complete') return `${summary.knownTokens.toLocaleString()} tok`;
  if (summary.coverage === 'partial') return `≥${summary.knownTokens.toLocaleString()} tok`;
  return 'Usage unavailable';
}
