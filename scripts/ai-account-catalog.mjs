const API_ENGINE_ID = 'api';

const available = Object.freeze({ status: 'available' });
const unavailable = (reason) => Object.freeze({ status: 'unavailable', reason });

function nonEmpty(value) {
  return typeof value === 'string' && value.trim().length > 0 ? value.trim() : undefined;
}

function positiveInteger(value) {
  const number = Number(value);
  return Number.isFinite(number) && number > 0 ? Math.floor(number) : undefined;
}

function opaqueAccountId(value) {
  const normalized = nonEmpty(value);
  if (!normalized || normalized.length < 8 || /\s/u.test(normalized)) return undefined;
  if (/(?:^|[:_-])(?:sk|secret|token|bearer)(?:[:_-]|$)/iu.test(normalized)) return undefined;
  return normalized;
}

function configuredApiAccount(provider) {
  if (!provider || typeof provider !== 'object' || provider.configured !== true) return undefined;
  if (provider.authMode !== 'api-key' && provider.authMode !== 'api') return undefined;

  const providerId = nonEmpty(provider.providerId);
  const accountId = opaqueAccountId(provider.accountId);
  if (!providerId || !accountId) return undefined;
  return {
    providerId,
    accountId,
    displayName: nonEmpty(provider.displayName) ?? providerId,
  };
}

function officialModelSource(model) {
  const candidate = model?.source;
  if (candidate === undefined || candidate === null) return undefined;
  if (!candidate || typeof candidate !== 'object' || candidate.kind !== 'official-api') {
    return null;
  }
  const sourceUrl = nonEmpty(candidate.sourceUrl);
  const checkedAt = nonEmpty(candidate.checkedAt);
  try {
    if (
      !sourceUrl ||
      new URL(sourceUrl).protocol !== 'https:' ||
      !checkedAt ||
      !Number.isFinite(Date.parse(checkedAt))
    ) {
      return null;
    }
  } catch {
    return null;
  }
  return Object.freeze({ kind: 'official-api', sourceUrl, checkedAt });
}

function projectModel({ accountId, providerId, model }) {
  if (!model || typeof model !== 'object' || model.provider !== providerId) return undefined;
  const modelId = nonEmpty(model.id);
  if (!modelId) return undefined;

  // A user-configured Pi model is authoritative without pretending it has an
  // official catalog record. When an official source is supplied, it remains
  // strict: complete HTTPS provenance or the entry is rejected.
  const source = officialModelSource(model);
  if (source === null) return undefined;

  const contextWindow = positiveInteger(model.contextWindow);
  const maxOutputTokens = positiveInteger(model.maxTokens ?? model.maxOutputTokens);
  const input = Array.isArray(model.input) ? model.input : [];
  return Object.freeze({
    engineId: API_ENGINE_ID,
    accountId,
    billingMode: 'api',
    modelId,
    displayName: nonEmpty(model.name) ?? modelId,
    runtimeModelRef: `${providerId}/${modelId}`,
    availability: 'available',
    ...(contextWindow ? { contextWindow } : {}),
    ...(maxOutputTokens ? { maxOutputTokens } : {}),
    capabilities: Object.freeze({
      textInput: true,
      imageInput: input.includes('image'),
      tools: true,
      reasoning: model.reasoning === true,
    }),
    ...(source ? { source } : {}),
  });
}

function projectAccount(account, models) {
  const hasRunnableModel = models.length > 0;
  const modelCapability = hasRunnableModel
    ? available
    : unavailable('No model is configured for this API account.');
  return Object.freeze({
    engineId: API_ENGINE_ID,
    accountId: account.accountId,
    billingMode: 'api',
    displayName: account.displayName,
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
 * Pure safe projection from host-resolved account facts. Every configured Pi
 * provider/model pair is eligible; this layer never reads files, credentials,
 * or a product-owned allowlist.
 */
export function projectApiAccountCatalog({
  providerAccounts = [],
  availableModels = [],
  checkedAt,
  now = new Date(),
} = {}) {
  const capturedAt = typeof checkedAt === 'string' ? checkedAt : now.toISOString();
  const accounts = [];
  const models = [];
  const seenAccounts = new Set();

  for (const provider of providerAccounts) {
    const account = configuredApiAccount(provider);
    if (!account || seenAccounts.has(account.accountId)) continue;
    seenAccounts.add(account.accountId);

    const accountModels = availableModels
      .map((model) => projectModel({ ...account, model }))
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

/** Preserve the existing implicit fallback: first available registry model. */
export function defaultApiModelForAccount(status, accountId) {
  return status?.models?.find(
    (model) =>
      model.engineId === API_ENGINE_ID &&
      model.accountId === accountId &&
      model.availability === 'available',
  );
}
