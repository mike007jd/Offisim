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
const advisories = [];

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
  assert.equal(entry.checkedAt, OPENROUTER_API_CATALOG_CHECKED_AT);
  if (checkedAt > now.getTime()) {
    advisories.push(`${entry.modelId} checkedAt is in the future (${entry.checkedAt})`);
  } else if (now.getTime() - checkedAt > freshnessWindowMs) {
    advisories.push(`${entry.modelId} catalog check is older than 30 days (${entry.checkedAt})`);
  }

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

  if (entry.expiresAt) {
    assert.ok(
      Number.isFinite(Date.parse(entry.expiresAt)),
      `${entry.modelId} expiresAt is invalid`,
    );
  }
  const availability = catalogAvailability(entry, now);
  if (availability.status !== 'available') {
    advisories.push(
      `${entry.modelId} availability is ${availability.status}: ${availability.reason}`,
    );
  }
}

for (const advisory of advisories) console.warn(`WARN model catalog advisory: ${advisory}`);
console.log(
  `PASS model catalog consistency (${ids.size} exact leaf models, ${advisories.length} advisories)`,
);
