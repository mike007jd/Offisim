import assert from 'node:assert/strict';
import test from 'node:test';

import { verifyCompletion } from './completion-verifier.ts';

test('verifyCompletion blocks when no evidence tool ran', () => {
  const outcome = verifyCompletion({
    recentToolResults: [{ toolName: 'read_file', success: true, bytes: 10 }],
  });

  assert.equal(outcome.ok, false);
});

test('verifyCompletion allows a successful pnpm-test in the window', () => {
  const outcome = verifyCompletion({
    recentToolResults: [{ toolName: 'pnpm-test', success: true, bytes: 120 }],
  });

  assert.deepEqual(outcome, { ok: true });
});

test('verifyCompletion blocks when pnpm-test failed', () => {
  const outcome = verifyCompletion({
    recentToolResults: [{ toolName: 'pnpm-test', success: false, bytes: 120 }],
  });

  assert.equal(outcome.ok, false);
});
