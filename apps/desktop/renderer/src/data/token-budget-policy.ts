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
}

export function computeTokenBudgetAlerts(input: {
  monthlyTokens: number;
  sessionTokens: number;
  budgets: TokenBudgetSettings;
}): TokenBudgetAlert[] {
  const rows: Array<{ scope: TokenBudgetAlert['scope']; used: number; budget: number | null }> = [
    { scope: 'monthly', used: input.monthlyTokens, budget: input.budgets.monthlyTokenBudget },
    { scope: 'session', used: input.sessionTokens, budget: input.budgets.sessionTokenBudget },
  ];
  return rows.flatMap((row) => {
    if (!row.budget) return [];
    const percent = (row.used / row.budget) * 100;
    if (percent < 80) return [];
    return [
      {
        scope: row.scope,
        level: percent >= 100 ? 'critical' : 'warning',
        percent,
        used: row.used,
        budget: row.budget,
      } satisfies TokenBudgetAlert,
    ];
  });
}
