import assert from 'node:assert/strict';
import { resolveApiRunUsage } from './agent-run-usage.mjs';

const provenance = Object.freeze({
  engineId: 'api',
  accountId: 'api:test:opaque',
  billingMode: 'api',
  modelId: 'cohere/north-mini-code:free',
  runId: 'run-1',
});
const model = Object.freeze({
  provider: 'openrouter-free',
  id: provenance.modelId,
  api: 'openai-completions',
  baseUrl: 'https://openrouter.ai/api/v1',
});
const modelRegistry = {
  async getApiKeyAndHeaders() {
    return { ok: true, apiKey: 'secret-for-harness', headers: { 'X-Test': 'usage' } };
  },
};
const now = () => new Date('2026-07-14T23:00:00+10:00');
const message = (overrides = {}) => ({
  role: 'assistant',
  responseId: 'gen-1',
  usage: {
    input: 80,
    output: 30,
    cacheRead: 10,
    cacheWrite: 0,
    cost: { total: 999 },
  },
  ...overrides,
});
const response = (data, status = 200) => ({
  ok: status >= 200 && status < 300,
  status,
  async json() {
    return { data };
  },
});

let calls = 0;
const actual = await resolveApiRunUsage({
  messages: [message()],
  provenance,
  model,
  modelRegistry,
  now,
  sleepImpl: async () => {},
  fetchImpl: async (url, options) => {
    calls += 1;
    assert.match(url, /generation\?id=gen-1$/u);
    assert.equal(options.headers.Authorization, 'Bearer secret-for-harness');
    return response({
      id: 'gen-1',
      model: provenance.modelId,
      native_tokens_prompt: 100,
      native_tokens_cached: 10,
      native_tokens_completion: 30,
      native_tokens_reasoning: 5,
      total_cost: 0,
    });
  },
});
assert.equal(calls, 1);
assert.deepEqual(actual, {
  scope: {
    kind: 'api-run',
    engineId: 'api',
    accountId: 'api:test:opaque',
    modelId: provenance.modelId,
  },
  input: 90,
  output: 30,
  cacheRead: 10,
  reasoning: 5,
  turns: 1,
  inputAccounting: 'excludes-cache',
  outputAccounting: 'includes-reasoning',
  usageSource: {
    kind: 'provider',
    capturedAt: '2026-07-14T13:00:00.000Z',
    reference: 'gen-1',
  },
  cost: {
    kind: 'actual',
    amountUsd: 0,
    source: 'OpenRouter generation metadata',
    capturedAt: '2026-07-14T13:00:00.000Z',
  },
});

const fast = await resolveApiRunUsage({
  messages: [message({ usage: { input: 8, output: 4, speed: 'fast' } })],
  provenance,
  model,
  modelRegistry,
  now,
  retryDelaysMs: [0],
  fetchImpl: async () =>
    response({
      id: 'gen-1',
      model: provenance.modelId,
      native_tokens_prompt: 8,
      native_tokens_cached: 0,
      native_tokens_completion: 4,
      total_cost: 0.001,
      speed: 'fast',
    }),
});
assert.deepEqual(fast.executionSpeed, {
  mode: 'fast',
  source: {
    kind: 'engine-usage',
    capturedAt: '2026-07-14T13:00:00.000Z',
    reference: 'gen-1',
  },
});

const unknownSpeed = await resolveApiRunUsage({
  messages: [message({ responseId: undefined, usage: { input: 8, output: 4, speed: 'FAST' } })],
  provenance,
  model,
  modelRegistry,
  now,
});
assert.equal('executionSpeed' in unknownSpeed, false, 'invalid speed must stay unknown');

let retryCalls = 0;
const retried = await resolveApiRunUsage({
  messages: [message()],
  provenance,
  model,
  modelRegistry,
  now,
  sleepImpl: async () => {},
  fetchImpl: async () => {
    retryCalls += 1;
    if (retryCalls < 3) return response(undefined, 404);
    return response({
      id: 'gen-1',
      model: provenance.modelId,
      native_tokens_prompt: 4,
      native_tokens_cached: 0,
      native_tokens_completion: 2,
      native_tokens_reasoning: 0,
      total_cost: 0.001,
    });
  },
});
assert.equal(retryCalls, 3);
assert.equal(retried.cost.kind, 'actual');
assert.equal(retried.cost.amountUsd, 0.001);
assert.equal(retried.reasoning, 0);

const estimated = await resolveApiRunUsage({
  messages: [message({ responseId: undefined })],
  provenance,
  model,
  modelRegistry,
  now,
  fetchImpl: async () => assert.fail('No generation id means no provider lookup.'),
});
assert.equal(estimated.usageSource.kind, 'adapter');
assert.equal(estimated.cost.kind, 'unavailable');
assert.equal(estimated.cost.knownAmountUsd, 0);
assert.deepEqual(
  {
    input: estimated.input,
    output: estimated.output,
    cacheRead: estimated.cacheRead,
    cacheWrite: estimated.cacheWrite,
    reasoning: estimated.reasoning,
  },
  { input: 80, output: 30, cacheRead: 10, cacheWrite: undefined, reasoning: undefined },
);

const freeEstimate = await resolveApiRunUsage({
  messages: [
    message({
      responseId: undefined,
      usage: { input: 12, output: 3, cacheRead: 0, cacheWrite: 0, cost: { total: 999 } },
    }),
  ],
  provenance,
  model,
  modelRegistry,
  now,
});
assert.deepEqual(freeEstimate.cost, {
  kind: 'estimate',
  amountUsd: 0,
  sourceUrl: 'https://openrouter.ai/api/v1/models/cohere/north-mini-code:free/endpoints',
  checkedAt: '2026-07-14T21:56:24+10:00',
});
assert.equal('cacheRead' in freeEstimate, false, 'adapter placeholder zero must stay absent');
assert.equal('reasoning' in freeEstimate, false, 'missing reasoning must stay absent');

const mixed = await resolveApiRunUsage({
  messages: [message(), message({ responseId: undefined })],
  provenance,
  model,
  modelRegistry,
  now,
  retryDelaysMs: [0],
  fetchImpl: async () =>
    response({
      id: 'gen-1',
      model: provenance.modelId,
      native_tokens_prompt: 100,
      native_tokens_cached: 10,
      native_tokens_completion: 30,
      native_tokens_reasoning: 5,
      total_cost: 0.002,
    }),
});
assert.equal(mixed.cost.kind, 'unavailable');
assert.equal(mixed.cost.knownAmountUsd, 0.002);
assert.equal(mixed.cost.knownContributions, 1);
assert.equal(mixed.cost.totalContributions, 2);

const mismatch = await resolveApiRunUsage({
  messages: [message()],
  provenance,
  model,
  modelRegistry,
  now,
  retryDelaysMs: [0],
  fetchImpl: async () =>
    response({
      id: 'gen-1',
      model: 'some/other-model',
      native_tokens_prompt: 1,
      native_tokens_cached: 0,
      native_tokens_completion: 1,
      total_cost: 99,
    }),
});
assert.equal(mismatch.cost.kind, 'unavailable');
assert.notEqual(mismatch.cost.knownAmountUsd, 99);

assert.equal(
  await resolveApiRunUsage({
    messages: [message()],
    provenance: { ...provenance, billingMode: 'subscription' },
    model,
    modelRegistry,
  }),
  undefined,
  'subscription telemetry must never enter the API cost contract',
);

console.log('PASS: provider actual cost outranks verified catalog estimate');
console.log('PASS: missing token and price fields remain absent/unavailable');
console.log('PASS: generation lookup is bounded, exact-model scoped, and failure tolerant');
console.log('PASS: execution speed is projected only from exact engine usage literals');
