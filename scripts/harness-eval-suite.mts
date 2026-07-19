import { createHarness } from './lib/harness-runner.mjs';

const h = createHarness();

/**
 * Eval suite oracle (Epic H, H1) — proves the real-task eval definition is sound.
 *
 * The eval suite is the contract H2's Computer-Use driver runs against the live
 * `.app`. This gate locks: the suite is well-formed (unique ids, every category
 * covered, every task has a deterministic ground-truth + a stop condition), the
 * validator actually CATCHES malformed suites (not a tautology), and the ledger
 * summary tallies outcomes correctly.
 *
 * Pure Node via tsx — no Pi, no host, no `.app`.
 *
 * Inject-proof (run manually, then revert): make validateEvalSuite always return
 * [] → checks (2)-(5) fail. That proves the validator is load-bearing.
 */

import assert from 'node:assert/strict';
import {
  EVAL_SUITE,
  type EvalResult,
  type EvalTask,
  summarizeLedger,
  validateEvalSuite,
} from './eval-suite.mts';
const TOTAL = 8;
const check = h.checkAsync;

const baseTask: EvalTask = {
  id: 't',
  category: 'research',
  title: 't',
  prompt: 'p',
  groundTruth: [{ kind: 'tool_called', description: 'x' }],
  humanCheckpoints: ['h'],
  stopConditions: ['s'],
  requiresLive: true,
};

console.log('harness:eval-suite — real-task agent UX eval definition (H1)\n');

await check('(1) the shipped suite is well-formed (no problems)', () => {
  assert.deepEqual(validateEvalSuite(EVAL_SUITE), []);
});

await check('(2) validator catches a duplicate id', () => {
  const problems = validateEvalSuite([baseTask, { ...baseTask }]);
  assert.ok(problems.some((p) => p.includes('duplicate task id')));
});

await check('(3) validator catches a task with no ground-truth', () => {
  const problems = validateEvalSuite([{ ...baseTask, groundTruth: [] }]);
  assert.ok(problems.some((p) => p.includes('no ground-truth')));
});

await check('(4) validator catches a task with no stop condition', () => {
  const problems = validateEvalSuite([{ ...baseTask, stopConditions: [] }]);
  assert.ok(problems.some((p) => p.includes('no stop condition')));
});

await check('(5) validator catches a missing category', () => {
  // A single research task is missing the other 7 required categories.
  const problems = validateEvalSuite([baseTask]);
  assert.ok(problems.some((p) => p.includes('missing eval category "mission"')));
});

await check('(6) all 8 capability categories are covered', () => {
  const categories = new Set(EVAL_SUITE.map((t) => t.category));
  for (const cat of [
    'research',
    'file-edit',
    'artifact',
    'approval',
    'abort',
    'delegation',
    'mission',
    'recovery',
  ]) {
    assert.ok(categories.has(cat as EvalTask['category']), `missing ${cat}`);
  }
});

await check('(7) every task is ground-truth-anchored, never self-report only', () => {
  for (const t of EVAL_SUITE) {
    assert.ok(t.groundTruth.length >= 1, `${t.id} needs a deterministic check`);
    assert.equal(t.requiresLive, true);
  }
});

await check('(8) summarizeLedger tallies outcomes', () => {
  const results: EvalResult[] = [
    { taskId: 'a', outcome: 'pass', groundTruthMet: true, evidence: [] },
    { taskId: 'b', outcome: 'fail', groundTruthMet: false, evidence: [] },
    { taskId: 'c', outcome: 'blocked', groundTruthMet: false, evidence: [] },
    { taskId: 'd', outcome: 'pass', groundTruthMet: true, evidence: [] },
  ];
  const ledger = summarizeLedger(results);
  assert.equal(ledger.summary.total, 4);
  assert.equal(ledger.summary.passed, 2);
  assert.equal(ledger.summary.failed, 1);
  assert.equal(ledger.summary.blocked, 1);
  assert.equal(ledger.summary.skipped, 0);
});

console.log(`\n${(h.checks - h.failures)}/${TOTAL} checks passed${h.failures ? `, ${h.failures} FAILED` : ''}.`);
if (h.failures > 0 || (h.checks - h.failures) !== TOTAL) process.exit(1);

if (!process.exitCode) h.report();
