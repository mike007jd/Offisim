import type { ProviderProductId } from '@offisim/shared-types';

const LITELLM_MODELS_URL =
  'https://raw.githubusercontent.com/BerriAI/litellm/main/model_prices_and_context_window.json';
const LITELLM_PROVIDER_SUPPORT_URL =
  'https://raw.githubusercontent.com/BerriAI/litellm/main/provider_endpoints_support.json';
const OPENROUTER_MODELS_URL = 'https://openrouter.ai/api/v1/models';
const HERMES_PROVIDER_DOC_URL =
  'https://raw.githubusercontent.com/NousResearch/hermes-agent/main/website/docs/integrations/providers.md';
const OPENCLAW_PROVIDER_DOC_URL =
  'https://raw.githubusercontent.com/openclaw/openclaw/main/docs/concepts/model-providers.md';

const PROVIDER_ALIAS_TO_PRODUCTS: Readonly<Record<string, readonly ProviderProductId[]>> = {
  alibaba: ['qwen-model-studio'],
  'alibaba-coding-plan': ['qwen-model-studio'],
  anthropic: ['anthropic-api'],
  codex: ['codex'],
  dashscope: ['qwen-model-studio'],
  deepseek: ['deepseek'],
  gemini: ['gemini'],
  google: ['gemini'],
  'google-gemini-cli': ['gemini'],
  lm_studio: ['lmstudio'],
  lmstudio: ['lmstudio'],
  kimi: ['kimi'],
  'kimi-coding': ['kimi'],
  'kimi-coding-cn': ['kimi'],
  minimax: ['minimax'],
  'minimax-cn': ['minimax'],
  moonshot: ['kimi'],
  nous: ['custom-compatible'],
  openai: ['openai-api'],
  'openai-codex': ['codex'],
  openrouter: ['openrouter'],
  qwen: ['qwen-model-studio'],
  custom: ['custom-compatible'],
  zai: ['zai-glm'],
};

const HERMES_FALLBACK_PROVIDER_IDS = [
  'openrouter',
  'nous',
  'openai-codex',
  'copilot',
  'copilot-acp',
  'anthropic',
  'gemini',
  'google-gemini-cli',
  'qwen-oauth',
  'huggingface',
  'zai',
  'kimi-coding',
  'kimi-coding-cn',
  'minimax',
  'minimax-cn',
  'minimax-oauth',
  'deepseek',
  'nvidia',
  'xai',
  'ollama-cloud',
  'bedrock',
  'ai-gateway',
  'opencode-zen',
  'opencode-go',
  'kilocode',
  'xiaomi',
  'arcee',
  'gmi',
  'stepfun',
  'alibaba',
  'tencent-tokenhub',
  'custom',
] as const;

const OPENCLAW_FALLBACK_PROVIDER_IDS = [
  'openai',
  'anthropic',
  'openai-codex',
  'opencode',
  'opencode-go',
  'google',
  'google-vertex',
  'google-gemini-cli',
  'zai',
  'minimax',
  'qwen',
  'kimi',
  'moonshot',
  'deepseek',
  'mistral',
  'nvidia',
  'openrouter',
  'qianfan',
  'stepfun',
  'stepfun-plan',
  'together',
  'venice',
  'vercel-ai-gateway',
  'volcengine',
  'volcengine-plan',
  'byteplus',
  'byteplus-plan',
  'synthetic',
  'lmstudio',
  'ollama',
  'vllm',
  'sglang',
] as const;

export interface ProviderListSourceSummary {
  readonly sourceId: string;
  readonly label: string;
  readonly url: string;
  readonly providerCount?: number;
  readonly modelCount?: number;
}

export interface ProviderListRefreshSnapshot {
  readonly fetchedAt: string;
  readonly sources: readonly ProviderListSourceSummary[];
  readonly modelsByProductId: Partial<Record<ProviderProductId, readonly string[]>>;
}

type FetchLike = typeof fetch;

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value);
}

async function fetchJson<T>(fetchImpl: FetchLike, url: string): Promise<T> {
  const response = await fetchImpl(url, { cache: 'no-store' });
  if (!response.ok) {
    throw new Error(`${url} returned ${response.status}`);
  }
  return response.json() as Promise<T>;
}

async function fetchText(fetchImpl: FetchLike, url: string): Promise<string> {
  const response = await fetchImpl(url, { cache: 'no-store' });
  if (!response.ok) {
    throw new Error(`${url} returned ${response.status}`);
  }
  return response.text();
}

function addModel(
  modelsByProductId: Map<ProviderProductId, Set<string>>,
  productId: ProviderProductId,
  modelId: string,
) {
  if (!modelId.trim()) return;
  const models = modelsByProductId.get(productId) ?? new Set<string>();
  models.add(modelId.trim());
  modelsByProductId.set(productId, models);
}

function normalizeLiteLlmModelId(modelId: string, providerAlias: string): string {
  const prefix = `${providerAlias}/`;
  return modelId.startsWith(prefix) ? modelId.slice(prefix.length) : modelId;
}

function canonicalProviderAlias(providerAlias: string): string {
  const normalized = providerAlias.trim().toLowerCase().replace(/_/g, '-');
  switch (normalized) {
    case 'dashscope':
    case 'modelstudio':
    case 'model-studio':
      return 'qwen';
    case 'kimi-cn':
    case 'moonshot-cn':
      return 'kimi-coding-cn';
    case 'lm-studio':
      return 'lmstudio';
    default:
      return normalized;
  }
}

function collectProductsForProvider(
  providerAlias: string,
  agentProviderScope: ReadonlySet<string>,
): readonly ProviderProductId[] {
  const canonicalAlias = canonicalProviderAlias(providerAlias);
  if (!agentProviderScope.has(canonicalAlias)) return [];
  return PROVIDER_ALIAS_TO_PRODUCTS[canonicalAlias] ?? [];
}

function collectLiteLlmModels(
  modelsPayload: Record<string, unknown>,
  agentProviderScope: ReadonlySet<string>,
): {
  modelCount: number;
  modelsByProductId: Map<ProviderProductId, Set<string>>;
} {
  const modelsByProductId = new Map<ProviderProductId, Set<string>>();
  const scopedModels = new Set<string>();

  for (const [rawModelId, rawModel] of Object.entries(modelsPayload)) {
    if (rawModelId === 'sample_spec' || !isRecord(rawModel)) continue;
    const inferredProviderAlias = rawModelId.split('/')[0] ?? rawModelId;
    const providerAlias =
      typeof rawModel.litellm_provider === 'string' && rawModel.litellm_provider.trim()
        ? rawModel.litellm_provider.trim()
        : inferredProviderAlias;
    const productIds = collectProductsForProvider(providerAlias, agentProviderScope);
    for (const productId of productIds) {
      const normalizedModelId = normalizeLiteLlmModelId(rawModelId, providerAlias);
      addModel(modelsByProductId, productId, normalizedModelId);
      scopedModels.add(`${productId}:${normalizedModelId}`);
    }
  }

  return { modelCount: scopedModels.size, modelsByProductId };
}

function collectOpenRouterModels(
  modelsPayload: unknown,
  agentProviderScope: ReadonlySet<string>,
): {
  modelCount: number;
  modelsByProductId: Map<ProviderProductId, Set<string>>;
} {
  const modelsByProductId = new Map<ProviderProductId, Set<string>>();
  if (!agentProviderScope.has('openrouter')) {
    return { modelCount: 0, modelsByProductId };
  }
  if (!isRecord(modelsPayload) || !Array.isArray(modelsPayload.data)) {
    return { modelCount: 0, modelsByProductId };
  }

  let modelCount = 0;
  for (const model of modelsPayload.data) {
    if (!isRecord(model) || typeof model.id !== 'string') continue;
    modelCount += 1;
    addModel(modelsByProductId, 'openrouter', model.id);
  }

  return { modelCount, modelsByProductId };
}

function mergeModelMaps(
  target: Map<ProviderProductId, Set<string>>,
  incoming: Map<ProviderProductId, Set<string>>,
) {
  for (const [productId, modelIds] of incoming) {
    for (const modelId of modelIds) {
      addModel(target, productId, modelId);
    }
  }
}

function serializeModelMap(
  modelsByProductId: Map<ProviderProductId, Set<string>>,
): Partial<Record<ProviderProductId, readonly string[]>> {
  const output: Partial<Record<ProviderProductId, readonly string[]>> = {};
  for (const [productId, modelIds] of modelsByProductId) {
    output[productId] = [...modelIds].sort((left, right) => left.localeCompare(right));
  }
  return output;
}

function countTrackedLiteLlmProviders(
  providerSupport: { providers?: Record<string, unknown> },
  agentProviderScope: ReadonlySet<string>,
) {
  const supportedProviderAliases = new Set(Object.keys(providerSupport.providers ?? {}));
  return Object.keys(PROVIDER_ALIAS_TO_PRODUCTS).filter((alias) =>
    agentProviderScope.has(canonicalProviderAlias(alias)) && supportedProviderAliases.has(alias),
  ).length;
}

function addProviderId(target: Set<string>, providerId: string) {
  const canonicalId = canonicalProviderAlias(providerId);
  if (!canonicalId || canonicalId.includes(' ') || canonicalId.includes('$')) return;
  target.add(canonicalId);
}

function extractBacktickTokens(value: string): string[] {
  return [...value.matchAll(/`([^`]+)`/g)].map((match) => match[1]?.trim() ?? '').filter(Boolean);
}

function collectHermesProviderIds(markdown: string): Set<string> {
  const providerIds = new Set<string>(HERMES_FALLBACK_PROVIDER_IDS.map(canonicalProviderAlias));
  for (const match of markdown.matchAll(/provider:\s*`([^`]+)`/gi)) {
    addProviderId(providerIds, match[1] ?? '');
  }
  for (const match of markdown.matchAll(/Supported providers:[\s\S]*?(?:\n\n|$)/gi)) {
    for (const token of extractBacktickTokens(match[0])) {
      addProviderId(providerIds, token);
    }
  }
  return providerIds;
}

function normalizeOpenClawProviderToken(token: string): string | null {
  const value = token.trim();
  if (!value || value.includes('API_KEY') || value.includes('TOKEN')) return null;
  if (value.startsWith('http') || value.includes('${')) return null;
  return value.includes('/') ? (value.split('/')[0] ?? null) : value;
}

function collectOpenClawProviderIds(markdown: string): Set<string> {
  const providerIds = new Set<string>(OPENCLAW_FALLBACK_PROVIDER_IDS.map(canonicalProviderAlias));
  for (const match of markdown.matchAll(/-\s*Providers?:\s*([^\n]+)/gi)) {
    for (const token of extractBacktickTokens(match[1] ?? '')) {
      const providerId = normalizeOpenClawProviderToken(token);
      if (providerId) addProviderId(providerIds, providerId);
    }
  }
  for (const match of markdown.matchAll(/^[A-Z][^\n`]*`([^`]+)`/gm)) {
    const providerId = normalizeOpenClawProviderToken(match[1] ?? '');
    if (providerId) addProviderId(providerIds, providerId);
  }
  return providerIds;
}

function mergeProviderSets(...providerSets: readonly ReadonlySet<string>[]): Set<string> {
  const providerIds = new Set<string>();
  for (const providerSet of providerSets) {
    for (const providerId of providerSet) providerIds.add(providerId);
  }
  return providerIds;
}

export async function pullLatestProviderList(
  fetchImpl: FetchLike = globalThis.fetch.bind(globalThis),
): Promise<ProviderListRefreshSnapshot> {
  const [
    hermesProviderMarkdown,
    openClawProviderMarkdown,
    liteLlmModels,
    liteLlmProviderSupport,
    openRouterModels,
  ] = await Promise.all([
    fetchText(fetchImpl, HERMES_PROVIDER_DOC_URL),
    fetchText(fetchImpl, OPENCLAW_PROVIDER_DOC_URL),
    fetchJson<Record<string, unknown>>(fetchImpl, LITELLM_MODELS_URL),
    fetchJson<{ providers?: Record<string, unknown> }>(fetchImpl, LITELLM_PROVIDER_SUPPORT_URL),
    fetchJson<unknown>(fetchImpl, OPENROUTER_MODELS_URL),
  ]);

  const hermesProviderIds = collectHermesProviderIds(hermesProviderMarkdown);
  const openClawProviderIds = collectOpenClawProviderIds(openClawProviderMarkdown);
  const agentProviderScope = mergeProviderSets(hermesProviderIds, openClawProviderIds);
  const modelsByProductId = new Map<ProviderProductId, Set<string>>();
  const liteLlm = collectLiteLlmModels(liteLlmModels, agentProviderScope);
  const openRouter = collectOpenRouterModels(openRouterModels, agentProviderScope);
  mergeModelMaps(modelsByProductId, liteLlm.modelsByProductId);
  mergeModelMaps(modelsByProductId, openRouter.modelsByProductId);

  return {
    fetchedAt: new Date().toISOString(),
    sources: [
      {
        sourceId: 'hermes-agent',
        label: 'Hermes Agent provider docs',
        url: HERMES_PROVIDER_DOC_URL,
        providerCount: hermesProviderIds.size,
      },
      {
        sourceId: 'openclaw',
        label: 'OpenClaw model provider docs',
        url: OPENCLAW_PROVIDER_DOC_URL,
        providerCount: openClawProviderIds.size,
      },
      {
        sourceId: 'litellm',
        label: 'LiteLLM model metadata filtered to Hermes/OpenClaw providers',
        url: LITELLM_MODELS_URL,
        providerCount: countTrackedLiteLlmProviders(liteLlmProviderSupport, agentProviderScope),
        modelCount: liteLlm.modelCount,
      },
      {
        sourceId: 'openrouter-live',
        label: 'OpenRouter live models API',
        url: OPENROUTER_MODELS_URL,
        modelCount: openRouter.modelCount,
      },
    ],
    modelsByProductId: serializeModelMap(modelsByProductId),
  };
}
