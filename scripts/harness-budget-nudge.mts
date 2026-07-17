import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import {
  BUDGET_NUDGE_THRESHOLD_RATIO,
  OneShotBudgetNudge,
  decideBoundedLoop,
} from '../packages/core/dist/runtime/bounded-loop.js';
import { buildVerificationRepairPrompt } from './pi-child-supervisor.mjs';

assert.equal(BUDGET_NUDGE_THRESHOLD_RATIO, 0.88, 'the convergence threshold is exactly 88%');

const tracker = new OneShotBudgetNudge();
assert.equal(
  tracker.next({ tokenBudget: 100, tokenRemaining: 13 }),
  null,
  '87% usage stays below the nudge threshold',
);

const nudge = tracker.next({ tokenBudget: 100, tokenRemaining: 12 });
assert.ok(nudge, '88% usage emits a convergence nudge');
assert.equal(nudge.tokenRemaining, 12);
assert.equal(nudge.tokenBudget, 100);
assert.equal(nudge.usedPercent, 88);
assert.match(nudge.instruction, /12 tokens remain/);
assert.match(nudge.instruction, /finish and deliver/i);
assert.match(nudge.instruction, /do not start new work/i);
const delegatedRepairPrompt = buildVerificationRepairPrompt({
  attemptNumber: 2,
  maxAttempts: 4,
  command: 'pnpm verify',
  verifySummary: 'Exit 1',
  budgetNudge: nudge,
});
assert.match(delegatedRepairPrompt, /Project verification failed on attempt 2\/4/);
assert.match(delegatedRepairPrompt, /# Budget convergence/);
assert.match(delegatedRepairPrompt, /12 tokens remain/);
assert.equal(
  tracker.next({ tokenBudget: 100, tokenRemaining: 5 }),
  null,
  'one run receives the nudge exactly once',
);

const exhausted = new OneShotBudgetNudge();
assert.equal(
  exhausted.next({ tokenBudget: 100, tokenRemaining: 0 }),
  null,
  'an exhausted budget does not replace the hard stop with a soft nudge',
);
assert.deepEqual(
  decideBoundedLoop({
    attemptNumber: 1,
    maxAttempts: 6,
    failureSignature: 'failure-1',
    tokenRemaining: 0,
  }),
  { action: 'stop', reason: 'token_budget' },
  'budget exhaustion retains the existing hard-stop decision',
);

const missionControllerSource = readFileSync(
  new URL('../packages/core/dist/runtime/mission/mission-loop-controller.js', import.meta.url),
  'utf8',
);
const missionRunnerSource = readFileSync(
  new URL(
    '../apps/desktop/renderer/src/runtime/mission/mission-run-controller.ts',
    import.meta.url,
  ),
  'utf8',
);
const childSupervisorSource = readFileSync(
  new URL('./pi-child-supervisor.mjs', import.meta.url),
  'utf8',
);
assert.match(
  missionControllerSource,
  /budgetNudge:\s*pendingBudgetNudge/,
  'Mission passes the one-shot nudge into the next attempt',
);
assert.match(
  missionRunnerSource,
  /# Budget convergence[\s\S]*budgetNudge\.instruction/,
  'Mission renders the convergence instruction into the agent prompt',
);
assert.match(childSupervisorSource, /new OneShotBudgetNudge\(\)/);
assert.match(childSupervisorSource, /buildVerificationRepairPrompt\(\{/);
assert.match(
  childSupervisorSource,
  /terminationReason === 'token_budget' \? 'budget' : 'tool'/,
  'delegated exhaustion still emits failureKind=budget',
);

console.log(
  '[harness-budget-nudge] 88% -> exactly one remaining-budget convergence prompt; 100% -> hard stop with budget failure unchanged',
);
