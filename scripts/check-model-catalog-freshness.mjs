import assert from 'node:assert/strict';
import {
  OPENROUTER_API_CATALOG_CHECKED_AT,
  REJECTED_OPENROUTER_MODEL_IDS,
  VERIFIED_OPENROUTER_API_MODELS,
  catalogAvailability,
  openRouterModelSourceUrl,
} from './ai-model-catalog.mjs';

const now = new Date();
const freshnessWindowMs = 30 * 24 * 60 * 60 * 1_000;
const ids = new Set();

for (const entry of VERIFIED_OPENROUTER_API_MODELS) {
  assert.match(
    entry.modelId,
    /^[a-z0-9][a-z0-9._-]*\/[a-z0-9][a-z0-9._:-]*$/u,
    `${entry.modelId} is not an exact leaf id`,
  );
  assert.ok(!ids.has(entry.modelId), `duplicate model id ${entry.modelId}`);
  ids.add(entry.modelId);

  assert.equal(
    entry.sourceUrl,
    openRouterModelSourceUrl(entry.modelId),
    `${entry.modelId} sourceUrl must be its official exact-model endpoint`,
  );
  const checkedAt = Date.parse(entry.checkedAt);
  assert.ok(Number.isFinite(checkedAt), `${entry.modelId} checkedAt is invalid`);
  assert.ok(checkedAt <= now.getTime(), `${entry.modelId} checkedAt is in the future`);
  assert.ok(now.getTime() - checkedAt <= freshnessWindowMs, `${entry.modelId} catalog is stale`);
  assert.equal(entry.checkedAt, OPENROUTER_API_CATALOG_CHECKED_AT);

  assert.ok(entry.displayName && entry.displayName !== entry.modelId);
  assert.ok(Number.isInteger(entry.contextWindow) && entry.contextWindow > 0);
  assert.ok(entry.maxOutputTokens === undefined || entry.maxOutputTokens > 0);
  assert.ok(entry.capabilities && typeof entry.capabilities.tools === 'boolean');
  assert.equal(entry.capabilities.textInput, true);

  assert.ok(entry.pricing && entry.pricing !== entry, `${entry.modelId} pricing is not isolated`);
  assert.equal(entry.pricing.currency, 'USD');
  assert.equal(entry.pricing.sourceUrl, openRouterModelSourceUrl(entry.modelId));
  assert.equal(entry.pricing.checkedAt, entry.checkedAt, `${entry.modelId} pricing is stale`);
  assert.ok(!Object.hasOwn(REJECTED_OPENROUTER_MODEL_IDS, entry.modelId));

  const availability = catalogAvailability(entry, now);
  assert.notEqual(
    availability.status,
    'unavailable',
    `${entry.modelId} is no longer selectable: ${availability.reason}`,
  );
}

assert.equal(ids.size, 5, 'catalog must contain the five independently verified exact models');
assert.equal(
  VERIFIED_OPENROUTER_API_MODELS.filter((entry) => entry.expiresAt).length,
  2,
  'the two time-limited models must remain explicit',
);
assert.equal(
  VERIFIED_OPENROUTER_API_MODELS.find((entry) => entry.modelId === 'qwen/qwen3-coder:free')
    ?.contextWindow,
  262_000,
  'Qwen3 Coder effective endpoint context must not be replaced by model-level context',
);
assert.equal(
  VERIFIED_OPENROUTER_API_MODELS.find(
    (entry) => entry.modelId === 'qwen/qwen3-next-80b-a3b-instruct:free',
  )?.maxOutputTokens,
  undefined,
  'unknown output limits must stay absent',
);

console.log(`PASS model catalog freshness (${ids.size} exact leaf models)`);
