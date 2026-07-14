export interface TokenBudgetSettings {
  monthlyTokenBudget: number | null;
  sessionTokenBudget: number | null;
}

export interface TokenBudgetAlert {
  scope: 'monthly' | 'session';
  level: 'warning' | 'critical';
  percent: number;
  used: number;
  budget: number;
  /** True when `used` is only a proven lower bound because provider fields are missing. */
  lowerBound: boolean;
}

export function computeTokenBudgetAlerts(input: {
  monthlyTokens: number | null;
  monthlyKnownTokens: number;
  monthlyTokenCoverage: TokenCoverage;
  sessionTokens: number | null;
  sessionKnownTokens: number;
  sessionTokenCoverage: TokenCoverage;
  budgets: TokenBudgetSettings;
}): TokenBudgetAlert[] {
  const rows: Array<{
    scope: TokenBudgetAlert['scope'];
    exact: number | null;
    known: number;
    coverage: TokenCoverage;
    budget: number | null;
  }> = [
    {
      scope: 'monthly',
      exact: input.monthlyTokens,
      known: input.monthlyKnownTokens,
      coverage: input.monthlyTokenCoverage,
      budget: input.budgets.monthlyTokenBudget,
    },
    {
      scope: 'session',
      exact: input.sessionTokens,
      known: input.sessionKnownTokens,
      coverage: input.sessionTokenCoverage,
      budget: input.budgets.sessionTokenBudget,
    },
  ];
  return rows.flatMap((row) => {
    if (!row.budget || row.coverage === 'unavailable') return [];
    const used = row.exact ?? row.known;
    const percent = (used / row.budget) * 100;
    if (percent < 80) return [];
    return [
      {
        scope: row.scope,
        level: percent >= 100 ? 'critical' : 'warning',
        percent,
        used,
        budget: row.budget,
        lowerBound: row.coverage !== 'complete',
      } satisfies TokenBudgetAlert,
    ];
  });
}
import type { TokenCoverage } from './usage-token-coverage.js';
