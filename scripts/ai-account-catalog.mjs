import {
  OPENROUTER_API_BASE_URL,
  catalogAvailability,
  verifiedOpenRouterModel,
} from './ai-model-catalog.mjs';

const API_ENGINE_ID = 'api';
const OPENROUTER_ACCOUNT_NAME = 'OpenRouter API';
const OPENAI_COMPLETIONS_API = 'openai-completions';

const available = Object.freeze({ status: 'available' });
const unavailable = (reason) => Object.freeze({ status: 'unavailable', reason });

function normalizedBaseUrl(value) {
  if (typeof value !== 'string' || value.trim().length === 0) return undefined;
  try {
    const parsed = new URL(value);
    if (parsed.protocol !== 'https:') return undefined;
    if (parsed.search || parsed.hash) return undefined;
    return parsed.href.replace(/\/$/u, '');
  } catch {
    return undefined;
  }
}

function opaqueAccountId(value) {
  if (typeof value !== 'string') return undefined;
  const normalized = value.trim();
  if (normalized.length < 8 || /\s/u.test(normalized)) return undefined;
  if (/(?:^|[:_-])(?:sk|secret|token|bearer)(?:[:_-]|$)/iu.test(normalized)) return undefined;
  return normalized;
}

function configuredOpenRouterApiAccount(provider) {
  if (!provider || typeof provider !== 'object' || provider.configured !== true) return undefined;
  if (provider.authMode !== 'api-key' && provider.authMode !== 'api') return undefined;
  if (normalizedBaseUrl(provider.baseUrl) !== OPENROUTER_API_BASE_URL) return undefined;
  if (provider.api !== OPENAI_COMPLETIONS_API) return undefined;

  const providerId = typeof provider.providerId === 'string' ? provider.providerId.trim() : '';
  const accountId = opaqueAccountId(provider.accountId);
  if (!providerId || !accountId) return undefined;
  return { providerId, accountId };
}

function projectModel({ accountId, providerId, model, now }) {
  if (!model || typeof model !== 'object' || model.provider !== providerId) return undefined;
  if (model.api && model.api !== OPENAI_COMPLETIONS_API) return undefined;
  const catalog = verifiedOpenRouterModel(model.id);
  if (!catalog) return undefined;

  const availability = catalogAvailability(catalog, now);
  return Object.freeze({
    engineId: API_ENGINE_ID,
    accountId,
    billingMode: 'api',
    modelId: catalog.modelId,
    displayName: catalog.displayName,
    runtimeModelRef: `${providerId}/${catalog.modelId}`,
    availability: availability.status,
    ...(availability.reason ? { availabilityReason: availability.reason } : {}),
    ...(catalog.expiresAt ? { expiresAt: catalog.expiresAt } : {}),
    contextWindow: catalog.contextWindow,
    ...(catalog.maxOutputTokens ? { maxOutputTokens: catalog.maxOutputTokens } : {}),
    capabilities: catalog.capabilities,
    pricing: catalog.pricing,
    source: Object.freeze({
      kind: 'official-api',
      sourceUrl: catalog.sourceUrl,
      checkedAt: catalog.checkedAt,
    }),
  });
}

function projectAccount(account, models) {
  const hasRunnableModel = models.some((model) => model.availability !== 'unavailable');
  const modelCapability = hasRunnableModel
    ? available
    : unavailable('No verified exact model is currently available.');
  return Object.freeze({
    engineId: API_ENGINE_ID,
    accountId: account.accountId,
    billingMode: 'api',
    displayName: OPENROUTER_ACCOUNT_NAME,
    status: hasRunnableModel ? 'available' : 'unavailable',
    ...(!hasRunnableModel ? { statusReason: modelCapability.reason } : {}),
    capabilities: Object.freeze({
      execute: modelCapability,
      models: modelCapability,
      usage: available,
      cost: available,
    }),
  });
}

/**
 * Pure safe projection from host-resolved account facts. It does not discover
 * files, environment variables, credentials, or provider configuration.
 */
export function projectApiAccountCatalog({
  providerAccounts = [],
  availableModels = [],
  checkedAt,
  now = new Date(),
} = {}) {
  const capturedAt = typeof checkedAt === 'string' ? checkedAt : now.toISOString();
  const clock = now instanceof Date ? now : new Date(now);
  const accounts = [];
  const models = [];
  const seenAccounts = new Set();

  for (const provider of providerAccounts) {
    const account = configuredOpenRouterApiAccount(provider);
    if (!account || seenAccounts.has(account.accountId)) continue;
    seenAccounts.add(account.accountId);

    const accountModels = availableModels
      .map((model) => projectModel({ ...account, model, now: clock }))
      .filter(Boolean)
      .filter(
        (model, index, projected) =>
          projected.findIndex((candidate) => candidate.modelId === model.modelId) === index,
      );
    models.push(...accountModels);
    accounts.push(projectAccount(account, accountModels));
  }

  return Object.freeze({
    accounts: Object.freeze(accounts),
    models: Object.freeze(models),
    checkedAt: capturedAt,
  });
}

/** Expiring models remain explicit choices but are never selected implicitly. */
export function defaultApiModelForAccount(status, accountId) {
  return status?.models?.find(
    (model) =>
      model.engineId === API_ENGINE_ID &&
      model.accountId === accountId &&
      model.availability === 'available',
  );
}
