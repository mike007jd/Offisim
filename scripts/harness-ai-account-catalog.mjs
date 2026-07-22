import assert from 'node:assert/strict';
import { defaultApiModelForAccount, projectApiAccountCatalog } from './ai-account-catalog.mjs';

const CHECKED_AT = '2026-07-17T02:00:00+12:00';
const ACCOUNT_A = 'api:private-gateway:0123456789abcdef';
const ACCOUNT_B = 'api:local-lab:fedcba9876543210';
const SECRET_SENTINEL = 'sk-secret-must-never-project';

const provider = (overrides = {}) => ({
  providerId: 'private-gateway',
  displayName: 'Private Gateway',
  baseUrl: 'https://models.example.internal/v1',
  api: 'openai-completions',
  configured: true,
  authMode: 'api-key',
  accountId: ACCOUNT_A,
  apiKey: SECRET_SENTINEL,
  rawCredentialSource: '~/.pi/agent/models.json',
  ...overrides,
});

const model = (id, overrides = {}) => ({
  provider: 'private-gateway',
  id,
  name: `Configured ${id}`,
  api: 'openai-completions',
  ...overrides,
});

const status = projectApiAccountCatalog({
  providerAccounts: [
    provider(),
    provider({
      providerId: 'local-lab',
      displayName: 'Local Lab',
      baseUrl: 'http://127.0.0.1:11434/v1',
      accountId: ACCOUNT_B,
    }),
    provider({
      providerId: 'unconfigured',
      configured: false,
      accountId: 'api:unconfigured:0123456789abcdef',
    }),
    provider({
      providerId: 'subscription-provider',
      authMode: 'subscription',
      accountId: 'subscription:native:0123456789abcdef',
    }),
  ],
  availableModels: [
    model('vendor/new-leaf'),
    model('Qwen3', {
      reasoning: true,
      contextWindow: 131_072,
      maxTokens: 8_192,
      input: ['text', 'image'],
    }),
    model('official-leaf', {
      source: {
        kind: 'official-api',
        sourceUrl: 'https://models.example.com/official-leaf',
        checkedAt: CHECKED_AT,
      },
    }),
    model('malformed-official-source', {
      source: { kind: 'official-api', sourceUrl: 'http://insecure.example/model' },
    }),
    model('invalid-official-time', {
      source: {
        kind: 'official-api',
        sourceUrl: 'https://models.example.com/invalid-time',
        checkedAt: 'not-a-date',
      },
    }),
    model('vendor/new-leaf'),
    model('lab/experimental', { provider: 'local-lab', name: 'Lab Experimental' }),
    model('unconfigured-leaf', { provider: 'unconfigured' }),
  ],
  checkedAt: CHECKED_AT,
});

assert.equal(status.checkedAt, CHECKED_AT);
assert.equal(status.accounts.length, 2, 'every configured API provider is projected');
assert.deepEqual(
  status.accounts.map((account) => account.displayName),
  ['Private Gateway', 'Local Lab'],
);
assert.equal(status.models.length, 4, 'dynamic leaves are projected once per owning account');
assert.deepEqual(
  new Set(status.models.map((entry) => entry.runtimeModelRef)),
  new Set([
    'private-gateway/vendor/new-leaf',
    'private-gateway/Qwen3',
    'private-gateway/official-leaf',
    'local-lab/lab/experimental',
  ]),
  'model identity comes from Pi configuration, not a product allowlist',
);

const unverified = status.models.find((entry) => entry.modelId === 'vendor/new-leaf');
assert.equal(unverified?.availability, 'available');
assert.equal(unverified?.source, undefined, 'user-configured model provenance is optional');
const familyNamed = status.models.find((entry) => entry.modelId === 'Qwen3');
assert.equal(
  familyNamed?.availability,
  'available',
  'explicit user configuration is authoritative',
);
assert.equal(familyNamed?.contextWindow, 131_072);
assert.equal(familyNamed?.maxOutputTokens, 8_192);
assert.deepEqual(familyNamed?.capabilities, {
  textInput: true,
  imageInput: true,
  tools: true,
  reasoning: true,
});
const official = status.models.find((entry) => entry.modelId === 'official-leaf');
assert.deepEqual(official?.source, {
  kind: 'official-api',
  sourceUrl: 'https://models.example.com/official-leaf',
  checkedAt: CHECKED_AT,
});
assert.equal(
  status.models.some((entry) => entry.modelId === 'malformed-official-source'),
  false,
  'an explicitly official source remains strict',
);
assert.equal(
  status.models.some((entry) => entry.modelId === 'invalid-official-time'),
  false,
  'an official checkedAt must be parseable',
);
assert.equal(
  defaultApiModelForAccount(status, ACCOUNT_A)?.modelId,
  'vendor/new-leaf',
  'the existing first-available implicit fallback remains registry-ordered',
);

const empty = projectApiAccountCatalog({
  providerAccounts: [provider()],
  availableModels: [],
  checkedAt: CHECKED_AT,
});
assert.equal(empty.accounts[0]?.status, 'unavailable');
assert.equal(defaultApiModelForAccount(empty, ACCOUNT_A), undefined);

const serialized = JSON.stringify(status);
assert.doesNotMatch(serialized, new RegExp(SECRET_SENTINEL, 'u'));
assert.doesNotMatch(serialized, /(?:apiKey|rawCredentialSource|auth\.json|models\.json|~\/\.pi)/iu);
assert.doesNotMatch(serialized, /unconfigured|subscription-provider/u);

console.log('PASS dynamic AI account catalog (multi-provider, arbitrary leaves, safe payload)');
