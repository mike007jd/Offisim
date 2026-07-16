import assert from 'node:assert/strict';
import { defaultApiModelForAccount, projectApiAccountCatalog } from './ai-account-catalog.mjs';

const CHECKED_AT = '2026-07-14T21:56:24+10:00';
const ACCOUNT_A = 'api:openrouter:0123456789abcdef';
const ACCOUNT_B = 'api:openrouter:fedcba9876543210';
const SECRET_SENTINEL = 'sk-secret-must-never-project';

const provider = (overrides = {}) => ({
  providerId: 'runtime-openrouter-a',
  displayName: 'Implementation account from auth.json',
  baseUrl: 'https://openrouter.ai/api/v1/',
  api: 'openai-completions',
  configured: true,
  authMode: 'api-key',
  accountId: ACCOUNT_A,
  apiKey: SECRET_SENTINEL,
  rawCredentialSource: '~/.pi/agent/models.json',
  ...overrides,
});

const model = (id, overrides = {}) => ({
  provider: 'runtime-openrouter-a',
  id,
  name: `Registry label for ${id}`,
  api: 'openai-completions',
  ...overrides,
});

const availableModels = [
  model('cohere/north-mini-code:free'),
  model('openai/gpt-oss-20b:free'),
  model('nvidia/nemotron-3-ultra-550b-a55b:free'),
  model('qwen/qwen3-coder:free'),
  model('qwen/qwen3-next-80b-a3b-instruct:free'),
  model('openrouter/free'),
  model('openai/gpt-oss-120b:free'),
  model('Qwen3'),
  model('vendor/unverified-model'),
];

const status = projectApiAccountCatalog({
  providerAccounts: [
    provider(),
    provider({
      providerId: 'runtime-unconfigured',
      configured: false,
      accountId: 'api:unconfigured:0123456789abcdef',
    }),
    provider({
      providerId: 'runtime-subscription',
      authMode: 'subscription',
      accountId: 'subscription:native:0123456789abcdef',
    }),
  ],
  availableModels,
  checkedAt: CHECKED_AT,
  now: new Date('2026-07-15T00:00:00Z'),
});

assert.equal(status.checkedAt, CHECKED_AT);
assert.equal(status.accounts.length, 1, 'only configured API accounts are projected');
assert.equal(status.accounts[0].accountId, ACCOUNT_A);
assert.equal(status.accounts[0].displayName, 'OpenRouter API');
assert.equal(status.accounts[0].billingMode, 'api');
assert.equal(status.accounts[0].status, 'available');
assert.equal(status.models.length, 5, 'only independently verified exact leaves are projected');

const projectedIds = new Set(status.models.map((entry) => entry.modelId));
assert.equal(projectedIds.has('openrouter/free'), false, 'routers are never selectable models');
assert.equal(
  projectedIds.has('openai/gpt-oss-120b:free'),
  false,
  'unavailable leaf aliases are rejected',
);
assert.equal(projectedIds.has('Qwen3'), false, 'family names are never selectable models');
assert.equal(projectedIds.has('vendor/unverified-model'), false, 'unverified leaves are rejected');

for (const entry of status.models) {
  assert.equal(entry.accountId, ACCOUNT_A, 'each model remains owned by its source account');
  assert.equal(entry.engineId, 'api');
  assert.equal(entry.billingMode, 'api');
  assert.match(entry.runtimeModelRef, /^runtime-openrouter-a\//u);
  assert.ok(entry.displayName && entry.displayName !== entry.modelId, 'display name is friendly');
  assert.equal(
    entry.source.sourceUrl,
    `https://openrouter.ai/api/v1/models/${entry.modelId}/endpoints`,
  );
  assert.ok(entry.source.checkedAt);
  assert.ok(entry.pricing?.sourceUrl, 'pricing has independent source provenance');
  assert.ok(entry.pricing?.checkedAt, 'pricing has an independent freshness timestamp');
  assert.notStrictEqual(entry.pricing, entry.source);
}

const qwenCoder = status.models.find((entry) => entry.modelId === 'qwen/qwen3-coder:free');
assert.equal(qwenCoder?.contextWindow, 262_000, 'effective endpoint context stays authoritative');
assert.equal(qwenCoder?.availability, 'expiring');
const qwenNext = status.models.find(
  (entry) => entry.modelId === 'qwen/qwen3-next-80b-a3b-instruct:free',
);
assert.equal(qwenNext?.availability, 'expiring');
assert.equal(qwenNext?.maxOutputTokens, undefined, 'unknown output limits stay absent');
assert.equal(
  status.models.filter((entry) => entry.availability === 'expiring').length,
  2,
  'both time-limited choices are explicit',
);
assert.equal(
  defaultApiModelForAccount(status, ACCOUNT_A)?.modelId,
  'cohere/north-mini-code:free',
  'an expiring model is never selected implicitly',
);

const multiAccountStatus = projectApiAccountCatalog({
  providerAccounts: [
    provider(),
    provider({ providerId: 'runtime-openrouter-b', accountId: ACCOUNT_B }),
  ],
  availableModels: [
    model('cohere/north-mini-code:free'),
    model('cohere/north-mini-code:free', { provider: 'runtime-openrouter-b' }),
  ],
  checkedAt: CHECKED_AT,
  now: new Date('2026-07-15T00:00:00Z'),
});
assert.equal(multiAccountStatus.accounts.length, 2);
assert.deepEqual(
  new Set(multiAccountStatus.models.map((entry) => entry.accountId)),
  new Set([ACCOUNT_A, ACCOUNT_B]),
  'the same exact leaf remains partitioned by opaque account ownership',
);

const expiredStatus = projectApiAccountCatalog({
  providerAccounts: [provider()],
  availableModels: [model('qwen/qwen3-coder:free')],
  checkedAt: CHECKED_AT,
  now: new Date('2026-07-20T00:00:00Z'),
});
assert.equal(expiredStatus.models[0]?.availability, 'unavailable');
assert.match(expiredStatus.models[0]?.availabilityReason ?? '', /Expired/u);
assert.equal(defaultApiModelForAccount(expiredStatus, ACCOUNT_A), undefined);
assert.equal(expiredStatus.accounts[0]?.status, 'unavailable');

const unconfiguredStatus = projectApiAccountCatalog({
  providerAccounts: [provider({ configured: false })],
  availableModels,
  checkedAt: CHECKED_AT,
  now: new Date('2026-07-15T00:00:00Z'),
});
assert.deepEqual(unconfiguredStatus.accounts, []);
assert.deepEqual(unconfiguredStatus.models, []);

const serialized = JSON.stringify(status);
assert.doesNotMatch(serialized, new RegExp(SECRET_SENTINEL, 'u'));
assert.doesNotMatch(serialized, /(?:apiKey|rawCredentialSource|auth\.json|models\.json|~\/\.pi)/iu);
assert.doesNotMatch(serialized, /(?:pi[ -]?agent|stored provider|oauth)/iu);
assert.doesNotMatch(serialized, /runtime-unconfigured|runtime-subscription/u);

console.log('PASS AI account catalog projection (account/model isolation and safe payload)');
