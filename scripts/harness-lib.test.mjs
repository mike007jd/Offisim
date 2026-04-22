import assert from 'node:assert/strict';
import test from 'node:test';
import { classifyHarnessFailure } from './harness-lib.mjs';

test('classifyHarnessFailure marks invalid lane/configuration errors', () => {
  const failure = classifyHarnessFailure(
    new Error('Execution lane "openai-agents-sdk" is not yet verified for preset "openrouter".'),
  );
  assert.deepEqual(
    { source: failure.source, category: failure.category, statusCode: failure.statusCode },
    {
      source: 'configuration',
      category: 'configuration.invalid',
      statusCode: null,
    },
  );
});

test('classifyHarnessFailure marks queue depth as offisim runtime failure', () => {
  const failure = classifyHarnessFailure(
    new Error('Thread "abc" has 3 queued requests — rejecting to prevent unbounded wait.'),
  );
  assert.equal(failure.source, 'offisim-runtime');
  assert.equal(failure.category, 'runtime.queue-depth');
});

test('classifyHarnessFailure marks timeout errors distinctly', () => {
  const failure = classifyHarnessFailure(new Error('Claude Agent SDK timed out after 5ms.'));
  assert.equal(failure.source, 'offisim-runtime');
  assert.equal(failure.category, 'runtime.timeout');
});

test('classifyHarnessFailure marks cancellation errors distinctly', () => {
  const failure = classifyHarnessFailure(new Error('Request aborted by harness cancel case.'));
  assert.equal(failure.source, 'offisim-runtime');
  assert.equal(failure.category, 'runtime.cancellation');
});

test('classifyHarnessFailure marks authentication failures distinctly', () => {
  const failure = classifyHarnessFailure(
    Object.assign(new Error('Incorrect API key provided.'), { statusCode: 401 }),
  );
  assert.equal(failure.source, 'provider');
  assert.equal(failure.category, 'provider.authentication');
});

test('classifyHarnessFailure marks quota failures distinctly', () => {
  const failure = classifyHarnessFailure(
    Object.assign(new Error('Rate limit exceeded for this workspace.'), { statusCode: 429 }),
  );
  assert.equal(failure.source, 'provider');
  assert.equal(failure.category, 'provider.quota');
});

test('classifyHarnessFailure marks protocol/tool incompatibilities distinctly', () => {
  const failure = classifyHarnessFailure(
    new Error('Provider tool execution is not supported on this protocol surface.'),
  );
  assert.equal(failure.source, 'provider');
  assert.equal(failure.category, 'provider.protocol');
});
