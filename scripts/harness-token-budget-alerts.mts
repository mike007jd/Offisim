import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { computeTokenBudgetAlerts } from '../apps/desktop/renderer/src/data/token-budget-policy.ts';

const budgets = { monthlyTokenBudget: 100_000, sessionTokenBudget: 10_000 };
const completeUsage = (monthlyTokens: number, sessionTokens: number) => ({
  monthlyTokens,
  monthlyKnownTokens: monthlyTokens,
  monthlyTokenCoverage: 'complete' as const,
  sessionTokens,
  sessionKnownTokens: sessionTokens,
  sessionTokenCoverage: 'complete' as const,
});
assert.deepEqual(
  computeTokenBudgetAlerts({ ...completeUsage(79_999, 7_999), budgets }),
  [],
  'below 80% is quiet',
);
const warning = computeTokenBudgetAlerts({
  ...completeUsage(80_000, 8_000),
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
  ...completeUsage(100_000, 10_001),
  budgets,
});
assert.ok(
  critical.every((item) => item.level === 'critical'),
  '100% is critical',
);
assert.deepEqual(
  computeTokenBudgetAlerts({
    ...completeUsage(999_999, 999_999),
    budgets: { monthlyTokenBudget: null, sessionTokenBudget: null },
  }),
  [],
  'no configured budget never warns',
);
const partialLowerBound = computeTokenBudgetAlerts({
  monthlyTokens: null,
  monthlyKnownTokens: 100_000,
  monthlyTokenCoverage: 'partial',
  sessionTokens: null,
  sessionKnownTokens: 8_000,
  sessionTokenCoverage: 'partial',
  budgets,
});
assert.ok(partialLowerBound.every((item) => item.lowerBound));
assert.deepEqual(
  partialLowerBound.map((item) => [item.scope, item.level]),
  [
    ['monthly', 'critical'],
    ['session', 'warning'],
  ],
  'a known partial subtotal that crosses a threshold remains actionable as a lower bound',
);

const budgetSource = readFileSync(
  new URL('../apps/desktop/renderer/src/data/token-budgets.ts', import.meta.url),
  'utf8',
);
const appFrameSource = readFileSync(
  new URL('../apps/desktop/renderer/src/design-system/shell/AppFrame.tsx', import.meta.url),
  'utf8',
);
const officeStageSource = readFileSync(
  new URL('../apps/desktop/renderer/src/surfaces/office/OfficeStage.tsx', import.meta.url),
  'utf8',
);
const usageCoverageSource = readFileSync(
  new URL('../apps/desktop/renderer/src/data/usage-token-coverage.ts', import.meta.url),
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
assert.doesNotMatch(
  appFrameSource,
  /useRunCost|off-topbar-cost|Advisory only — this run continues\./,
  'the global AppFrame must not duplicate task Usage, Cost, or budget alerts',
);
assert.match(officeStageSource, /Advisory only — this run continues\./);
assert.match(officeStageSource, /openSettings\('runtime'\)/);
assert.match(officeStageSource, /selectedThreadId/);
assert.doesNotMatch(officeStageSource, /toast\.error\(message/);
assert.match(officeStageSource, /taskAccountingPresentation\(runCost\.data\)/);
assert.match(usageCoverageSource, /≥/);

console.log('token-budget-alerts: 13 checks passed');
