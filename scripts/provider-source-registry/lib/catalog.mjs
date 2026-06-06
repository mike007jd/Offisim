import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { detectDefaultDrift } from './latest-models.mjs';

const ROOT = fileURLToPath(new URL('../../../', import.meta.url));
export const CATALOG_DIR = resolve(ROOT, 'catalog/provider-source-registry');

const TRUST_RANK = {
  community: 0,
  official: 1,
  override: 2,
};

function isRecord(value) {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value);
}

function clone(value) {
  return value == null ? value : structuredClone(value);
}

function sortStrings(values) {
  return [...new Set(values.filter((value) => typeof value === 'string' && value.trim()))].sort();
}

function sortValueDeep(value) {
  if (Array.isArray(value)) {
    return value.map(sortValueDeep);
  }
  if (!isRecord(value)) {
    return value;
  }
  const out = {};
  for (const key of Object.keys(value).sort()) {
    out[key] = sortValueDeep(value[key]);
  }
  return out;
}

function stableStringify(value) {
  return JSON.stringify(sortValueDeep(value));
}

function valuesEqual(left, right) {
  return stableStringify(left) === stableStringify(right);
}

function hasNumber(value) {
  return typeof value === 'number' && Number.isFinite(value);
}

function hasValue(value) {
  if (value == null) return false;
  if (typeof value === 'string') return value.trim().length > 0;
  if (Array.isArray(value)) return value.length > 0;
  if (isRecord(value)) return Object.keys(value).length > 0;
  return true;
}

export async function readJson(path) {
  return JSON.parse(await readFile(path, 'utf8'));
}

async function writeJson(path, value) {
  await mkdir(dirname(path), { recursive: true });
  await writeFile(path, `${JSON.stringify(sortValueDeep(value), null, 2)}\n`);
}

function makeSourceMeta(source) {
  return {
    sourceId: source.sourceId,
    sourceKind: source.sourceKind,
    trustTier: source.trustTier,
    refreshMode: source.refreshMode,
  };
}

function normalizeRegistryShape(registry) {
  const errors = [];
  if (!isRecord(registry)) {
    return ['registry document must be an object'];
  }
  if (registry.version !== 1) {
    errors.push('registry.version must equal 1');
  }
  if (!Array.isArray(registry.sources) || registry.sources.length === 0) {
    errors.push('registry.sources must be a non-empty array');
    return errors;
  }

  const seenSourceIds = new Set();
  for (const source of registry.sources) {
    if (!isRecord(source)) {
      errors.push('every registry source must be an object');
      continue;
    }
    for (const requiredKey of [
      'sourceId',
      'sourceKind',
      'trustTier',
      'refreshMode',
      'ownedFields',
      'supportsProviders',
    ]) {
      if (!(requiredKey in source)) {
        errors.push(`source is missing "${requiredKey}"`);
      }
    }
    if (typeof source.sourceId !== 'string' || !source.sourceId.trim()) {
      errors.push('source.sourceId must be a non-empty string');
      continue;
    }
    if (seenSourceIds.has(source.sourceId)) {
      errors.push(`duplicate sourceId "${source.sourceId}"`);
    }
    seenSourceIds.add(source.sourceId);
    if (!Array.isArray(source.ownedFields) || source.ownedFields.length === 0) {
      errors.push(`source "${source.sourceId}" must declare ownedFields`);
    }
    if (!Array.isArray(source.supportsProviders)) {
      errors.push(`source "${source.sourceId}" must declare supportsProviders`);
    }
    if (!(source.trustTier in TRUST_RANK)) {
      errors.push(`source "${source.sourceId}" has unsupported trustTier "${source.trustTier}"`);
    }
  }

  return errors;
}

const ISO_DATE_RE = /^\d{4}-\d{2}-\d{2}$/u;
const MODEL_STATUSES = new Set(['current', 'legacy', 'retired']);

// Closed key sets — anything outside them is a typo (`retiredOn` for
// `retiresOn`, `defautModel`) and must fail, not be silently ignored. This is
// the `additionalProperties: false` the old (dead) registry schema only
// promised. `REQUIRED_*` are the subset that must also be present + well-typed.
const FIXTURES_KEYS = new Set(['version', 'verification', 'providers']);
const VERIFICATION_KEYS = new Set(['checkedAt', 'staleAfterDays', 'note', 'modelStatus']);
const PROVIDER_KEYS = new Set([
  'productName',
  'vendor',
  'region',
  'compatibility',
  'surface',
  'providerTransport',
  'authMode',
  'baseURL',
  'defaultModel',
  'communityAliases',
  'supportedEndpoints',
  'lastVerifiedAt',
  'sourceUrl',
  'models',
]);
const MODEL_KEYS = new Set([
  'displayName',
  'status',
  'retiresOn',
  'sourceUrl',
  'notes',
  'communityAliases',
]);
// Provider scalar fields every shipped provider must carry. `defaultModel`,
// `baseURL`, `lastVerifiedAt`, `sourceUrl`, `communityAliases` are intentionally
// optional here (the user-defined `custom` passthrough has no default/url).
const REQUIRED_PROVIDER_FIELDS = [
  'productName',
  'vendor',
  'region',
  'compatibility',
  'surface',
  'providerTransport',
  'authMode',
];

// Parse a strict `YYYY-MM-DD` string to its UTC-midnight epoch ms, or null.
// Strict (no trim) so a stray space reads as the typo it is. The single date
// helper for this subsystem — shared by the fixture validator (`isIsoDate`)
// and the freshness gate's day math (check-freshness.mjs imports it).
export function asUtcDate(value) {
  if (typeof value !== 'string' || !ISO_DATE_RE.test(value)) return null;
  const ms = Date.parse(`${value}T00:00:00Z`);
  return Number.isFinite(ms) ? ms : null;
}

function isIsoDate(value) {
  return asUtcDate(value) != null;
}

function reportUnknownKeys(errors, label, object, allowed) {
  for (const key of Object.keys(object)) {
    if (!allowed.has(key)) {
      errors.push(`${label} has unknown field "${key}" (possible typo)`);
    }
  }
}

/**
 * Structural validation of `official-fixtures.json` — the model truth source.
 * Returns a list of error strings (empty = valid), same idiom as
 * `normalizeRegistryShape`.
 *
 * This is the data-layer half of the freshness mechanism: it makes a typo
 * (`retiredOn` instead of `retiresOn`, `status: "currnet"`, `staleAfterDays` as
 * a string) a HARD failure instead of letting the freshness gate read past it
 * and silently lose its baseline. Closed key sets catch misspelled field names;
 * type/format/enum checks catch malformed values. Temporal checks (default
 * retired, date in the past) and cross-references (default points at a real
 * model) stay in the freshness gate, so neither layer's logic becomes dead.
 */
export function normalizeFixturesShape(fixtures) {
  const errors = [];
  if (!isRecord(fixtures)) {
    return ['official-fixtures document must be an object'];
  }
  reportUnknownKeys(errors, 'fixtures', fixtures, FIXTURES_KEYS);
  if (fixtures.version !== 1) {
    errors.push('fixtures.version must equal 1');
  }

  const verification = fixtures.verification;
  if (!isRecord(verification)) {
    errors.push('fixtures.verification must be an object (the freshness baseline)');
  } else {
    reportUnknownKeys(errors, 'fixtures.verification', verification, VERIFICATION_KEYS);
    if (!isIsoDate(verification.checkedAt)) {
      errors.push(
        `fixtures.verification.checkedAt "${verification.checkedAt}" must be a YYYY-MM-DD date`,
      );
    }
    if (!Number.isInteger(verification.staleAfterDays) || verification.staleAfterDays <= 0) {
      errors.push(
        `fixtures.verification.staleAfterDays "${verification.staleAfterDays}" must be a positive integer`,
      );
    }
  }

  if (!isRecord(fixtures.providers)) {
    errors.push('fixtures.providers must be an object');
    return errors;
  }

  for (const providerId of Object.keys(fixtures.providers).sort()) {
    const provider = fixtures.providers[providerId];
    const at = `provider "${providerId}"`;
    if (!isRecord(provider)) {
      errors.push(`${at} must be an object`);
      continue;
    }
    reportUnknownKeys(errors, at, provider, PROVIDER_KEYS);
    for (const field of REQUIRED_PROVIDER_FIELDS) {
      if (typeof provider[field] !== 'string' || !provider[field].trim()) {
        errors.push(`${at} is missing required string field "${field}"`);
      }
    }
    if (
      'defaultModel' in provider &&
      (typeof provider.defaultModel !== 'string' || !provider.defaultModel.trim())
    ) {
      errors.push(`${at}.defaultModel must be a non-empty string when present`);
    }
    if ('lastVerifiedAt' in provider && !isIsoDate(provider.lastVerifiedAt)) {
      errors.push(`${at}.lastVerifiedAt "${provider.lastVerifiedAt}" must be a YYYY-MM-DD date`);
    }
    if ('supportedEndpoints' in provider) {
      if (!Array.isArray(provider.supportedEndpoints) || provider.supportedEndpoints.length === 0) {
        errors.push(`${at}.supportedEndpoints must be a non-empty string array when present`);
      } else {
        for (const endpoint of provider.supportedEndpoints) {
          if (typeof endpoint !== 'string' || !endpoint.trim()) {
            errors.push(`${at}.supportedEndpoints must contain only non-empty strings`);
            break;
          }
        }
      }
    }
    if (!isRecord(provider.models)) {
      errors.push(`${at}.models must be an object`);
      continue;
    }
    for (const modelId of Object.keys(provider.models).sort()) {
      const model = provider.models[modelId];
      const at2 = `${at} / model "${modelId}"`;
      if (!isRecord(model)) {
        errors.push(`${at2} must be an object`);
        continue;
      }
      reportUnknownKeys(errors, at2, model, MODEL_KEYS);
      if (!MODEL_STATUSES.has(model.status)) {
        errors.push(
          `${at2} has invalid status "${model.status}" (expected current|legacy|retired)`,
        );
      }
      if ('retiresOn' in model && !isIsoDate(model.retiresOn)) {
        errors.push(`${at2}.retiresOn "${model.retiresOn}" must be a YYYY-MM-DD date`);
      }
    }
  }

  return errors;
}

export async function loadRegistryContext(options = {}) {
  const catalogDir = options.catalogDir ?? CATALOG_DIR;
  const [registry, officialFixtures, curatedOverrides] = await Promise.all([
    readJson(resolve(catalogDir, 'sources.json')),
    readJson(resolve(catalogDir, 'official-fixtures.json')),
    readJson(resolve(catalogDir, 'curated-overrides.json')),
  ]);

  const errors = normalizeRegistryShape(registry);
  if (errors.length > 0) {
    throw new Error(`Invalid provider source registry:\n- ${errors.join('\n- ')}`);
  }
  const fixtureErrors = normalizeFixturesShape(officialFixtures);
  if (fixtureErrors.length > 0) {
    throw new Error(`Invalid official-fixtures:\n- ${fixtureErrors.join('\n- ')}`);
  }

  return {
    catalogDir,
    registry,
    officialFixtures,
    curatedOverrides,
    sourceMap: new Map(registry.sources.map((source) => [source.sourceId, source])),
  };
}

function ensureProviderSnapshot(snapshot, providerId) {
  snapshot.providers[providerId] ??= {
    fields: {},
    models: {},
  };
  return snapshot.providers[providerId];
}

function ensureModelSnapshot(providerSnapshot, modelId) {
  providerSnapshot.models[modelId] ??= {
    fields: {},
  };
  return providerSnapshot.models[modelId];
}

// Trimmed-string fields carried straight from official-fixtures. status /
// retiresOn / sourceUrl are the official-tier freshness fields (see sources.json
// ownedFields) that let the generated catalog tell `current` from
// `legacy`/`retired` and surface a source.
const MODEL_STRING_FIELDS = ['displayName', 'status', 'retiresOn', 'sourceUrl', 'notes'];

function normalizeModelFixture(model) {
  const normalized = {};
  for (const field of MODEL_STRING_FIELDS) {
    if (typeof model[field] === 'string' && model[field].trim()) {
      normalized[field] = model[field].trim();
    }
  }
  if (Array.isArray(model.communityAliases) && model.communityAliases.length > 0) {
    normalized.communityAliases = sortStrings(model.communityAliases);
  }
  return normalized;
}

export function normalizeOfficialFixturesSnapshot(officialFixtures, source) {
  const snapshot = {
    ...makeSourceMeta(source),
    providers: {},
  };

  for (const providerId of Object.keys(officialFixtures.providers ?? {}).sort()) {
    const provider = officialFixtures.providers[providerId];
    if (!isRecord(provider)) continue;
    const providerSnapshot = ensureProviderSnapshot(snapshot, providerId);
    for (const field of [
      'productName',
      'vendor',
      'region',
      'compatibility',
      'surface',
      'providerTransport',
      'authMode',
      'baseURL',
      'defaultModel',
      'lastVerifiedAt',
      'sourceUrl',
      'supportedEndpoints',
    ]) {
      if (hasValue(provider[field])) {
        providerSnapshot.fields[field] =
          field === 'supportedEndpoints' ? sortStrings(provider[field]) : clone(provider[field]);
      }
    }
    if (Array.isArray(provider.communityAliases) && provider.communityAliases.length > 0) {
      providerSnapshot.fields.communityAliases = sortStrings(provider.communityAliases);
    }
    for (const modelId of Object.keys(provider.models ?? {}).sort()) {
      const model = provider.models[modelId];
      const modelSnapshot = ensureModelSnapshot(providerSnapshot, modelId);
      const normalizedModel = normalizeModelFixture(isRecord(model) ? model : {});
      for (const [field, value] of Object.entries(normalizedModel)) {
        modelSnapshot.fields[field] = value;
      }
    }
  }

  return snapshot;
}

export function normalizeCuratedOverridesSnapshot(curatedOverrides, source) {
  const snapshot = {
    ...makeSourceMeta(source),
    providers: {},
  };

  for (const providerId of Object.keys(curatedOverrides.providers ?? {}).sort()) {
    const provider = curatedOverrides.providers[providerId];
    if (!isRecord(provider)) continue;
    const providerSnapshot = ensureProviderSnapshot(snapshot, providerId);
    if (isRecord(provider.executionLaneHints)) {
      providerSnapshot.fields.executionLaneHints = clone(provider.executionLaneHints);
    }
    if (typeof provider.notes === 'string' && provider.notes.trim()) {
      providerSnapshot.fields.notes = provider.notes.trim();
    }
    for (const modelId of Object.keys(provider.models ?? {}).sort()) {
      const model = provider.models[modelId];
      if (!isRecord(model)) continue;
      const modelSnapshot = ensureModelSnapshot(providerSnapshot, modelId);
      if (typeof model.notes === 'string' && model.notes.trim()) {
        modelSnapshot.fields.notes = model.notes.trim();
      }
    }
  }

  return snapshot;
}

function normalizeProviderEndpoints(endpoints) {
  if (!isRecord(endpoints)) return [];
  return sortStrings(
    Object.entries(endpoints)
      .filter(([, enabled]) => enabled === true)
      .map(([endpoint]) => endpoint),
  );
}

function normalizeLiteLlmModelId(rawModelId, communityAlias) {
  const prefix = `${communityAlias}/`;
  if (rawModelId.startsWith(prefix)) {
    return rawModelId.slice(prefix.length);
  }
  return rawModelId;
}

function buildCommunityAliasMap(officialFixtures) {
  const aliasMap = new Map();
  const modelAliasMap = new Map();

  for (const [providerId, provider] of Object.entries(officialFixtures.providers ?? {})) {
    if (!isRecord(provider)) continue;
    for (const alias of sortStrings(provider.communityAliases ?? [])) {
      aliasMap.set(alias, [...(aliasMap.get(alias) ?? []), providerId].sort());
    }
    for (const [modelId, model] of Object.entries(provider.models ?? {})) {
      if (!isRecord(model) || !Array.isArray(model.communityAliases)) continue;
      const providerModelAliases = modelAliasMap.get(providerId) ?? new Map();
      for (const alias of sortStrings(model.communityAliases)) {
        providerModelAliases.set(alias, modelId);
      }
      modelAliasMap.set(providerId, providerModelAliases);
    }
  }

  return { aliasMap, modelAliasMap };
}

function normalizeLiteLlmModelFields(model) {
  const fields = {};
  if (hasNumber(model.max_input_tokens)) {
    fields.contextWindow = model.max_input_tokens;
  }
  if (hasNumber(model.max_output_tokens)) {
    fields.maxOutputTokens = model.max_output_tokens;
  }
  const pricing = {};
  if (hasNumber(model.input_cost_per_token)) {
    pricing.inputCostPerToken = model.input_cost_per_token;
  }
  if (hasNumber(model.output_cost_per_token)) {
    pricing.outputCostPerToken = model.output_cost_per_token;
  }
  if (Object.keys(pricing).length > 0) {
    fields.pricing = pricing;
  }
  const capabilities = {};
  if (typeof model.supports_function_calling === 'boolean') {
    capabilities.functionCalling = model.supports_function_calling;
  }
  if (typeof model.supports_reasoning === 'boolean') {
    capabilities.reasoning = model.supports_reasoning;
  }
  if (Object.keys(capabilities).length > 0) {
    fields.capabilities = capabilities;
  }
  if (Array.isArray(model.supported_endpoints) && model.supported_endpoints.length > 0) {
    fields.supportedEndpoints = sortStrings(model.supported_endpoints);
  }
  return fields;
}

export function normalizeLiteLlmSnapshot({ officialFixtures, models, providerSupport, source }) {
  const snapshot = {
    ...makeSourceMeta(source),
    providers: {},
    meta: {
      detectedProviderAliases: [],
      newProviderAliases: [],
    },
  };

  const { aliasMap, modelAliasMap } = buildCommunityAliasMap(officialFixtures);
  const detectedAliases = new Map();

  for (const alias of Object.keys(providerSupport.providers ?? {}).sort()) {
    const support = providerSupport.providers[alias];
    detectedAliases.set(alias, {
      alias,
      modelCount: 0,
      providerDisplayName:
        typeof support?.display_name === 'string' ? support.display_name.trim() : undefined,
      docsUrl: typeof support?.url === 'string' ? support.url.trim() : undefined,
    });

    for (const providerId of aliasMap.get(alias) ?? []) {
      const providerSnapshot = ensureProviderSnapshot(snapshot, providerId);
      const endpoints = normalizeProviderEndpoints(support?.endpoints);
      if (endpoints.length > 0) {
        providerSnapshot.fields.supportedEndpoints = endpoints;
      }
      if (typeof support?.display_name === 'string' && support.display_name.trim()) {
        providerSnapshot.fields.communityDisplayName = support.display_name.trim();
      }
      if (typeof support?.url === 'string' && support.url.trim()) {
        providerSnapshot.fields.communityDocsUrl = support.url.trim();
      }
    }
  }

  for (const rawModelId of Object.keys(models).sort()) {
    const model = models[rawModelId];
    if (!isRecord(model)) continue;
    const communityAlias =
      typeof model.litellm_provider === 'string' && model.litellm_provider.trim()
        ? model.litellm_provider.trim()
        : rawModelId.split('/')[0];
    const aliasDetails = detectedAliases.get(communityAlias) ?? {
      alias: communityAlias,
      modelCount: 0,
    };
    aliasDetails.modelCount += 1;
    detectedAliases.set(communityAlias, aliasDetails);

    const providerIds = aliasMap.get(communityAlias) ?? [];
    if (providerIds.length === 0) {
      continue;
    }

    const normalizedModelId = normalizeLiteLlmModelId(rawModelId, communityAlias);
    const modelFields = normalizeLiteLlmModelFields(model);
    if (Object.keys(modelFields).length === 0) {
      continue;
    }

    for (const providerId of providerIds) {
      const providerSnapshot = ensureProviderSnapshot(snapshot, providerId);
      const aliasOverrides = modelAliasMap.get(providerId);
      const resolvedModelId = aliasOverrides?.get(normalizedModelId) ?? normalizedModelId;
      const modelSnapshot = ensureModelSnapshot(providerSnapshot, resolvedModelId);
      for (const [field, value] of Object.entries(modelFields)) {
        modelSnapshot.fields[field] = clone(value);
      }
    }
  }

  const newProviderAliases = [];
  for (const alias of [...detectedAliases.keys()].sort()) {
    const details = detectedAliases.get(alias);
    if (!details) continue;
    snapshot.meta.detectedProviderAliases.push({
      alias,
      mappedProviderIds: aliasMap.get(alias) ?? [],
      modelCount: details.modelCount,
      ...(details.providerDisplayName ? { providerDisplayName: details.providerDisplayName } : {}),
      ...(details.docsUrl ? { docsUrl: details.docsUrl } : {}),
    });
    if (!aliasMap.has(alias)) {
      newProviderAliases.push({
        communityAlias: alias,
        modelCount: details.modelCount,
        ...(details.providerDisplayName
          ? { providerDisplayName: details.providerDisplayName }
          : {}),
        ...(details.docsUrl ? { docsUrl: details.docsUrl } : {}),
      });
    }
  }
  snapshot.meta.newProviderAliases = newProviderAliases;

  return snapshot;
}

export async function loadLiteLlmPayloads(source, options = {}) {
  const fixtureDir = options.fixtureDir;
  if (fixtureDir) {
    return {
      models: await readJson(resolve(fixtureDir, 'litellm-models.json')),
      providerSupport: await readJson(resolve(fixtureDir, 'litellm-provider-support.json')),
    };
  }

  const fetchImpl = options.fetchImpl ?? globalThis.fetch;
  if (typeof fetchImpl !== 'function') {
    throw new Error('fetch is unavailable; pass options.fetchImpl or use fixtureDir');
  }

  const modelCatalogUrl = source.config?.modelCatalogUrl;
  const providerSupportUrl = source.config?.providerSupportUrl;
  if (typeof modelCatalogUrl !== 'string' || typeof providerSupportUrl !== 'string') {
    throw new Error('litellm source config must include modelCatalogUrl and providerSupportUrl');
  }

  const [modelsResponse, providerSupportResponse] = await Promise.all([
    fetchImpl(modelCatalogUrl),
    fetchImpl(providerSupportUrl),
  ]);

  if (!modelsResponse.ok) {
    throw new Error(`Failed to fetch LiteLLM model catalog: ${modelsResponse.status}`);
  }
  if (!providerSupportResponse.ok) {
    throw new Error(
      `Failed to fetch LiteLLM provider support catalog: ${providerSupportResponse.status}`,
    );
  }

  const [models, providerSupport] = await Promise.all([
    modelsResponse.json(),
    providerSupportResponse.json(),
  ]);

  return { models, providerSupport };
}

function normalizeOpenRouterSupportedEndpoints(model) {
  const parameters = Array.isArray(model.supported_parameters)
    ? new Set(model.supported_parameters.filter((value) => typeof value === 'string'))
    : new Set();
  const endpoints = ['chat_completions'];
  if (parameters.has('tools')) {
    endpoints.push('responses');
  }
  return sortStrings(endpoints);
}

function normalizeOpenRouterModelFields(model) {
  const fields = {};
  if (typeof model.name === 'string' && model.name.trim()) {
    fields.displayName = model.name.trim();
  }
  if (hasNumber(model.context_length)) {
    fields.contextWindow = model.context_length;
  }
  if (hasNumber(model.top_provider?.max_completion_tokens)) {
    fields.maxOutputTokens = model.top_provider.max_completion_tokens;
  }
  const pricing = {};
  const promptCost = Number.parseFloat(model.pricing?.prompt);
  const completionCost = Number.parseFloat(model.pricing?.completion);
  if (Number.isFinite(promptCost)) {
    pricing.inputCostPerToken = promptCost;
  }
  if (Number.isFinite(completionCost)) {
    pricing.outputCostPerToken = completionCost;
  }
  if (Object.keys(pricing).length > 0) {
    fields.pricing = pricing;
  }
  const capabilities = {};
  const parameters = Array.isArray(model.supported_parameters)
    ? new Set(model.supported_parameters.filter((value) => typeof value === 'string'))
    : new Set();
  if (parameters.has('tools')) {
    capabilities.functionCalling = true;
  }
  if (parameters.has('reasoning') || parameters.has('include_reasoning')) {
    capabilities.reasoning = true;
  }
  if (Object.keys(capabilities).length > 0) {
    fields.capabilities = capabilities;
  }
  fields.supportedEndpoints = normalizeOpenRouterSupportedEndpoints(model);
  return fields;
}

export function normalizeOpenRouterSnapshot({ modelsPayload, source }) {
  const snapshot = {
    ...makeSourceMeta(source),
    providers: {},
    meta: {
      routedModelCount: 0,
      routedModelNamespaces: [],
    },
  };

  const providerSnapshot = ensureProviderSnapshot(snapshot, 'openrouter-openai-general');
  providerSnapshot.fields.communityDisplayName = 'OpenRouter';
  providerSnapshot.fields.communityDocsUrl = 'https://openrouter.ai/docs';
  providerSnapshot.fields.supportedEndpoints = ['chat_completions', 'responses'];
  const namespaces = new Set();

  for (const model of modelsPayload.data ?? []) {
    if (!isRecord(model) || typeof model.id !== 'string' || !model.id.trim()) continue;
    const modelId = model.id.trim();
    const namespace = modelId.includes('/') ? modelId.split('/')[0] : modelId;
    namespaces.add(namespace);
    snapshot.meta.routedModelCount += 1;

    const modelFields = normalizeOpenRouterModelFields(model);
    if (Object.keys(modelFields).length === 0) continue;
    const modelSnapshot = ensureModelSnapshot(providerSnapshot, modelId);
    for (const [field, value] of Object.entries(modelFields)) {
      modelSnapshot.fields[field] = clone(value);
    }
  }

  snapshot.meta.routedModelNamespaces = sortStrings([...namespaces]);
  return snapshot;
}

export async function loadOpenRouterPayloads(source, options = {}) {
  const fixtureDir = options.fixtureDir;
  if (fixtureDir) {
    return {
      modelsPayload: await readJson(resolve(fixtureDir, 'openrouter-models.json')),
    };
  }

  const fetchImpl = options.fetchImpl ?? globalThis.fetch;
  if (typeof fetchImpl !== 'function') {
    throw new Error('fetch is unavailable; pass options.fetchImpl or use fixtureDir');
  }

  const modelsUrl = source.config?.modelsUrl;
  if (typeof modelsUrl !== 'string') {
    throw new Error('openrouter-live source config must include modelsUrl');
  }

  const modelsResponse = await fetchImpl(modelsUrl);
  if (!modelsResponse.ok) {
    throw new Error(`Failed to fetch OpenRouter model catalog: ${modelsResponse.status}`);
  }

  return { modelsPayload: await modelsResponse.json() };
}

function compareSources(left, right) {
  return TRUST_RANK[left.trustTier] - TRUST_RANK[right.trustTier];
}

function ensureMergedProvider(catalog, providerId) {
  catalog.providers[providerId] ??= {
    fields: {},
    models: {},
  };
  return catalog.providers[providerId];
}

function ensureMergedModel(provider, modelId) {
  provider.models[modelId] ??= {
    fields: {},
  };
  return provider.models[modelId];
}

function applyField({ conflicts, providerId, modelId, field, value, sourceMeta, target }) {
  if (!hasValue(value)) return;
  const existing = target[field];
  const incoming = {
    value: clone(value),
    provenance: {
      sourceId: sourceMeta.sourceId,
      sourceKind: sourceMeta.sourceKind,
      trustTier: sourceMeta.trustTier,
    },
  };
  if (!existing) {
    target[field] = incoming;
    return;
  }
  if (valuesEqual(existing.value, incoming.value)) {
    return;
  }

  const existingRank = TRUST_RANK[existing.provenance.trustTier];
  const incomingRank = TRUST_RANK[incoming.provenance.trustTier];
  const winner = incomingRank >= existingRank ? incoming : existing;
  const loser = winner === incoming ? existing : incoming;
  target[field] = winner;
  conflicts.push({
    providerId,
    field,
    ...(modelId ? { modelId, scope: 'model' } : { scope: 'provider' }),
    winner,
    loser,
  });
}

export function mergeCatalog({ registry, snapshots, generatedAt }) {
  const catalog = {
    version: 1,
    generatedAt,
    sources: registry.sources.map(makeSourceMeta),
    providers: {},
    conflicts: [],
  };

  for (const snapshot of snapshots) {
    const sourceMeta = makeSourceMeta(snapshot);
    for (const providerId of Object.keys(snapshot.providers ?? {}).sort()) {
      const incomingProvider = snapshot.providers[providerId];
      const mergedProvider = ensureMergedProvider(catalog, providerId);
      for (const [field, value] of Object.entries(incomingProvider.fields ?? {}).sort(([a], [b]) =>
        a.localeCompare(b),
      )) {
        applyField({
          catalog,
          conflicts: catalog.conflicts,
          providerId,
          field,
          value,
          sourceMeta,
          target: mergedProvider.fields,
        });
      }
      for (const modelId of Object.keys(incomingProvider.models ?? {}).sort()) {
        const incomingModel = incomingProvider.models[modelId];
        const mergedModel = ensureMergedModel(mergedProvider, modelId);
        for (const [field, value] of Object.entries(incomingModel.fields ?? {}).sort(([a], [b]) =>
          a.localeCompare(b),
        )) {
          applyField({
            catalog,
            conflicts: catalog.conflicts,
            providerId,
            modelId,
            field,
            value,
            sourceMeta,
            target: mergedModel.fields,
          });
        }
      }
    }
  }

  return catalog;
}

function buildAllowedCatalogScope(...snapshots) {
  const providerIds = new Set();
  const modelIdsByProvider = new Map();

  for (const snapshot of snapshots) {
    if (!snapshot) continue;
    for (const [providerId, provider] of Object.entries(snapshot.providers ?? {})) {
      providerIds.add(providerId);
      const modelIds = modelIdsByProvider.get(providerId) ?? new Set();
      for (const modelId of Object.keys(provider.models ?? {})) {
        modelIds.add(modelId);
      }
      modelIdsByProvider.set(providerId, modelIds);
    }
  }

  return { providerIds, modelIdsByProvider };
}

function addCatalogExpansionScope(scope, ...snapshots) {
  for (const snapshot of snapshots) {
    if (!snapshot) continue;
    for (const [providerId, provider] of Object.entries(snapshot.providers ?? {})) {
      if (!scope.providerIds.has(providerId)) continue;
      const modelIds = scope.modelIdsByProvider.get(providerId) ?? new Set();
      for (const modelId of Object.keys(provider.models ?? {})) {
        modelIds.add(modelId);
      }
      scope.modelIdsByProvider.set(providerId, modelIds);
    }
  }
}

export function buildCuratedCatalog({
  mergedCatalog,
  generatedAt,
  officialSnapshot,
  overrideSnapshot,
  expansionSnapshots = [],
  verification,
}) {
  const curated = {
    version: 1,
    generatedAt,
    ...(verification ? { verification: clone(verification) } : {}),
    providers: {},
  };
  const { providerIds, modelIdsByProvider } = buildAllowedCatalogScope(
    officialSnapshot,
    overrideSnapshot,
  );
  addCatalogExpansionScope({ providerIds, modelIdsByProvider }, ...expansionSnapshots);

  for (const providerId of Object.keys(mergedCatalog.providers ?? {}).sort()) {
    if (providerIds.size > 0 && !providerIds.has(providerId)) {
      continue;
    }
    const provider = mergedCatalog.providers[providerId];
    const curatedProvider = {};
    for (const [field, entry] of Object.entries(provider.fields ?? {}).sort(([a], [b]) =>
      a.localeCompare(b),
    )) {
      curatedProvider[field] = clone(entry.value);
    }
    const models = {};
    const allowedModelIds = modelIdsByProvider.get(providerId);
    for (const modelId of Object.keys(provider.models ?? {}).sort()) {
      if (allowedModelIds && allowedModelIds.size > 0 && !allowedModelIds.has(modelId)) {
        continue;
      }
      const model = provider.models[modelId];
      const curatedModel = {};
      for (const [field, entry] of Object.entries(model.fields ?? {}).sort(([a], [b]) =>
        a.localeCompare(b),
      )) {
        curatedModel[field] = clone(entry.value);
      }
      models[modelId] = curatedModel;
    }
    curatedProvider.models = models;
    curated.providers[providerId] = curatedProvider;
  }

  return curated;
}

export function buildDiffReport({
  officialSnapshot,
  communitySnapshot,
  expansionSnapshots = [],
  mergedCatalog,
  generatedAt,
}) {
  const newModels = [];
  const officialModelsByProvider = new Map();
  for (const [providerId, provider] of Object.entries(officialSnapshot.providers ?? {})) {
    officialModelsByProvider.set(providerId, new Set(Object.keys(provider.models ?? {})));
  }

  const diffSnapshots = [communitySnapshot, ...expansionSnapshots];
  for (const snapshot of diffSnapshots) {
    for (const [providerId, provider] of Object.entries(snapshot.providers ?? {})) {
      const officialModels = officialModelsByProvider.get(providerId) ?? new Set();
      for (const modelId of Object.keys(provider.models ?? {}).sort()) {
        if (officialModels.has(modelId)) continue;
        newModels.push({
          providerId,
          modelId,
          sourceId: snapshot.sourceId,
        });
      }
    }
  }

  return {
    version: 1,
    generatedAt,
    newProviderAliases: clone(communitySnapshot.meta?.newProviderAliases ?? []),
    newModels,
    conflicts: clone(mergedCatalog.conflicts ?? []),
    summary: {
      providerCount: Object.keys(mergedCatalog.providers ?? {}).length,
      newProviderAliasCount: communitySnapshot.meta?.newProviderAliases?.length ?? 0,
      newModelCount: newModels.length,
      conflictCount: mergedCatalog.conflicts?.length ?? 0,
    },
  };
}

export async function refreshProviderSourceRegistry(options = {}) {
  const context = await loadRegistryContext(options);
  const generatedAt = options.generatedAt ?? new Date().toISOString();
  const officialSource = context.sourceMap.get('official-fixtures');
  const litellmSource = context.sourceMap.get('litellm');
  const openRouterSource = context.sourceMap.get('openrouter-live');
  const overrideSource = context.sourceMap.get('offisim-curated-overrides');
  if (!officialSource || !litellmSource || !openRouterSource || !overrideSource) {
    throw new Error(
      'registry must declare official-fixtures, litellm, openrouter-live, and offisim-curated-overrides',
    );
  }

  const officialSnapshot = normalizeOfficialFixturesSnapshot(
    context.officialFixtures,
    officialSource,
  );
  const overrideSnapshot = normalizeCuratedOverridesSnapshot(
    context.curatedOverrides,
    overrideSource,
  );
  const liteLlmPayloads = await loadLiteLlmPayloads(litellmSource, options);
  const communitySnapshot = normalizeLiteLlmSnapshot({
    officialFixtures: context.officialFixtures,
    models: liteLlmPayloads.models,
    providerSupport: liteLlmPayloads.providerSupport,
    source: litellmSource,
  });
  const openRouterPayloads = await loadOpenRouterPayloads(openRouterSource, options);
  const openRouterSnapshot = normalizeOpenRouterSnapshot({
    modelsPayload: openRouterPayloads.modelsPayload,
    source: openRouterSource,
  });

  const mergedCatalog = mergeCatalog({
    registry: context.registry,
    snapshots: [officialSnapshot, communitySnapshot, openRouterSnapshot, overrideSnapshot].sort(
      (left, right) => compareSources(left, right),
    ),
    generatedAt,
  });
  const curatedCatalog = buildCuratedCatalog({
    mergedCatalog,
    generatedAt,
    officialSnapshot,
    overrideSnapshot,
    expansionSnapshots: [openRouterSnapshot],
    verification: context.officialFixtures.verification,
  });
  const diffReport = buildDiffReport({
    officialSnapshot,
    communitySnapshot,
    expansionSnapshots: [openRouterSnapshot],
    mergedCatalog,
    generatedAt,
  });
  // Automatic default-drift: compare each pinned `defaultModel` to the newest
  // in-family leaf id on the live OpenRouter list. Written into the diff report
  // so the offline `provider:check` gate can surface "behind" defaults without
  // re-fetching. Best-effort — never fail the refresh over it.
  try {
    diffReport.defaultDrift = detectDefaultDrift({
      openRouterData: openRouterPayloads.modelsPayload?.data ?? [],
      officialFixtures: context.officialFixtures,
    });
  } catch (error) {
    diffReport.defaultDrift = {
      error: String(error?.message ?? error),
      providers: [],
      summary: {},
    };
  }
  const rawSourceSnapshots = {
    version: 1,
    generatedAt,
    snapshots: {
      'official-fixtures': officialSnapshot,
      litellm: communitySnapshot,
      'openrouter-live': openRouterSnapshot,
      'offisim-curated-overrides': overrideSnapshot,
    },
  };

  return {
    context,
    rawSourceSnapshots,
    mergedCatalog,
    curatedCatalog,
    diffReport,
  };
}

export async function writeProviderSourceRegistryArtifacts({
  catalogDir = CATALOG_DIR,
  artifacts,
}) {
  const generatedDir = resolve(catalogDir, 'generated');
  await Promise.all([
    writeJson(resolve(generatedDir, 'raw-source-snapshots.json'), artifacts.rawSourceSnapshots),
    writeJson(resolve(generatedDir, 'merged-catalog.json'), artifacts.mergedCatalog),
    writeJson(resolve(generatedDir, 'curated-catalog.json'), artifacts.curatedCatalog),
    writeJson(resolve(generatedDir, 'diff-report.json'), artifacts.diffReport),
  ]);
}
