import assert from 'node:assert/strict';
import test from 'node:test';

import {
  normalizeProviderConfig,
  resolveProviderConfig,
  resolveProviderHostAvailability,
} from './provider-config.ts';
import { getProviderVariant, listProviderVariantsForProduct } from './provider-product-taxonomy.ts';

test('minimax product resolves through the curated catalog variant and lane metadata', () => {
  const variants = listProviderVariantsForProduct('minimax', 'api-key');
  assert.ok(
    variants.some((variant) => variant.providerVariantId === 'minimax-intl-anthropic-coding'),
  );

  const resolved = resolveProviderConfig({
    productId: 'minimax',
    accessMode: 'api-key',
    executionLane: 'claude-agent-sdk',
    providerVariantId: 'minimax-intl-anthropic-coding',
    model: 'MiniMax-M2.7',
  });

  assert.ok(resolved);
  assert.equal(resolved.product.productId, 'minimax');
  assert.equal(resolved.product.catalogSource, 'curated-catalog');
  assert.equal(resolved.variant?.providerVariantId, 'minimax-intl-anthropic-coding');
  assert.equal(resolved.variant?.catalogSource, 'curated-catalog');
  assert.equal(resolved.variant?.modelDisplayNames['MiniMax-M2.7'], 'MiniMax M2.7');
  assert.equal(resolved.transport.provider, 'anthropic');
  assert.equal(resolved.transport.baseURL, 'https://api.minimax.io/anthropic');
  assert.equal(resolved.executionLane, 'claude-agent-sdk');
  assert.deepEqual(resolved.availability, { available: true });
});

test('qwen model studio requires an explicit endpoint override', () => {
  const resolved = resolveProviderConfig({
    productId: 'qwen-model-studio',
    accessMode: 'api-key',
    executionLane: 'gateway',
    providerVariantId: 'qwen-model-studio-manual',
    model: 'qwen-max',
  });

  assert.ok(resolved);
  assert.equal(resolved.variant?.providerVariantId, 'qwen-model-studio-manual');
  assert.equal(resolved.availability.available, false);
  assert.equal(resolved.availability.code, 'invalid-config');
  assert.match(
    resolved.availability.message ?? '',
    /requires an explicit endpoint override/i,
  );
});

test('product-centric local-auth config loads without apiKey or baseURL and then fails closed on unsupported hosts', () => {
  const normalized = normalizeProviderConfig({
    productId: 'codex',
    accessMode: 'local-auth',
    executionLane: 'gateway',
    model: 'gpt-5.4',
  });

  assert.ok(normalized);
  assert.equal(normalized.productId, 'codex');
  assert.equal(normalized.accessMode, 'local-auth');
  assert.equal(normalized.providerVariantId, 'codex-local-auth');
  assert.equal(normalized.executionLane, 'codex-agent-sdk');

  const resolved = resolveProviderConfig(normalized);
  assert.ok(resolved);
  assert.equal(resolved.executionLane, 'codex-agent-sdk');
  assert.equal(resolved.transport.authStrategy, 'trusted-local-auth');

  const browserStatus = resolveProviderHostAvailability(resolved, { tauri: false });
  assert.equal(browserStatus.available, false);
  assert.equal(browserStatus.code, 'host-unavailable');
  assert.match(browserStatus.message ?? '', /Codex/i);

  const desktopStatus = resolveProviderHostAvailability(resolved, {
    tauri: true,
    trustedHostStatus: {
      available: false,
      message: 'Codex local auth is unavailable on this trusted host.',
    },
  });
  assert.equal(desktopStatus.available, false);
  assert.equal(desktopStatus.code, 'resolver-missing');
  assert.equal(desktopStatus.message, 'Codex local auth is unavailable on this trusted host.');
});

test('legacy minimax config migrates into a product-centric record', () => {
  const normalized = normalizeProviderConfig({
    provider: 'anthropic',
    vendor: 'minimax',
    baseURL: 'https://api.minimax.io/anthropic',
    model: 'MiniMax-M2.7',
    apiKey: 'sk-minimax-test',
  });

  assert.ok(normalized);
  assert.equal(normalized.productId, 'minimax');
  assert.equal(normalized.accessMode, 'api-key');
  assert.equal(normalized.providerVariantId, 'minimax-intl-anthropic-coding');
  assert.equal(normalized.endpointOverride, undefined);
  assert.equal(normalized.migrationSource?.kind, 'legacy-provider-record');
  assert.equal(normalized.migrationSource?.legacyProvider, 'anthropic');
  assert.equal(normalized.migrationSource?.legacyVendor, 'minimax');

  const resolved = resolveProviderConfig(normalized);
  assert.ok(resolved);
  assert.equal(resolved.transport.baseURL, 'https://api.minimax.io/anthropic');
  assert.equal(resolved.transport.provider, 'anthropic');
});

test('retired subscription records migrate to a reconfigure-needed claude product', () => {
  const normalized = normalizeProviderConfig({
    provider: 'subscription',
    model: 'default',
  });

  assert.ok(normalized);
  assert.equal(normalized.productId, 'claude');
  assert.equal(normalized.accessMode, 'subscription');
  assert.equal(normalized.providerVariantId, 'claude-local-auth');
  assert.equal(normalized.requiresReconfigure, true);
  assert.equal(normalized.migrationSource?.legacyProvider, 'subscription');

  const resolved = resolveProviderConfig(normalized);
  assert.ok(resolved);
  assert.equal(resolved.availability.available, false);
  assert.equal(resolved.availability.code, 'requires-reconfigure');
});

test('stale half-records are still rejected during normalization', () => {
  assert.equal(
    normalizeProviderConfig({
      provider: 'openai',
      model: 'gpt-4o-mini',
    }),
    null,
  );
});

test('repo-owned local-auth variants remain separate from curated API variants', () => {
  const claudeVariant = getProviderVariant('claude-local-auth');
  const anthropicVariant = getProviderVariant('anthropic-default');

  assert.ok(claudeVariant);
  assert.ok(anthropicVariant);
  assert.equal(claudeVariant.productId, 'claude');
  assert.equal(claudeVariant.catalogSource, 'repo-owned');
  assert.equal(claudeVariant.authMode, 'subscription');
  assert.equal(anthropicVariant.productId, 'anthropic-api');
  assert.equal(anthropicVariant.catalogSource, 'curated-catalog');
});
