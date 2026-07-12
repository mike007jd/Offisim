import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { computeTokenBudgetAlerts } from '../apps/desktop/renderer/src/data/token-budget-policy.ts';

const budgets = { monthlyTokenBudget: 100_000, sessionTokenBudget: 10_000 };
assert.deepEqual(
  computeTokenBudgetAlerts({ monthlyTokens: 79_999, sessionTokens: 7_999, budgets }),
  [],
  'below 80% is quiet',
);
const warning = computeTokenBudgetAlerts({
  monthlyTokens: 80_000,
  sessionTokens: 8_000,
  budgets,
});
assert.deepEqual(
  warning.map((item) => [item.scope, item.level]),
  [
    ['monthly', 'warning'],
    ['session', 'warning'],
  ],
);
const critical = computeTokenBudgetAlerts({
  monthlyTokens: 100_000,
  sessionTokens: 10_001,
  budgets,
});
assert.ok(
  critical.every((item) => item.level === 'critical'),
  '100% is critical',
);
assert.deepEqual(
  computeTokenBudgetAlerts({
    monthlyTokens: 999_999,
    sessionTokens: 999_999,
    budgets: { monthlyTokenBudget: null, sessionTokenBudget: null },
  }),
  [],
  'no configured budget never warns',
);

const budgetSource = readFileSync(
  new URL('../apps/desktop/renderer/src/data/token-budgets.ts', import.meta.url),
  'utf8',
);
const appFrameSource = readFileSync(
  new URL('../apps/desktop/renderer/src/design-system/shell/AppFrame.tsx', import.meta.url),
  'utf8',
);
assert.match(
  budgetSource,
  /monthlyTokenBudget: null,[\s\S]*sessionTokenBudget: null/,
  'persisted budget settings default to no monthly or session limit',
);
assert.doesNotMatch(
  budgetSource,
  /TokenBudget:\s*500\b/,
  'budget settings must not restore the old 500-token test residue as a default',
);
assert.match(appFrameSource, /Advisory only — this run continues\./);
assert.match(appFrameSource, /openSettings\('runtime'\)/);
assert.doesNotMatch(appFrameSource, /toast\.error\(message/);

console.log('token-budget-alerts: 9 checks passed');
