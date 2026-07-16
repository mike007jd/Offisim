export const OPENROUTER_API_BASE_URL = 'https://openrouter.ai/api/v1';
export const OPENROUTER_API_CATALOG_CHECKED_AT = '2026-07-14T21:56:24+10:00';

export const openRouterModelSourceUrl = (modelId) =>
  `${OPENROUTER_API_BASE_URL}/models/${modelId}/endpoints`;

const freePricing = (modelId) =>
  Object.freeze({
    currency: 'USD',
    inputPerMillion: 0,
    outputPerMillion: 0,
    sourceUrl: openRouterModelSourceUrl(modelId),
    checkedAt: OPENROUTER_API_CATALOG_CHECKED_AT,
  });

const exactModel = ({
  modelId,
  displayName,
  contextWindow,
  maxOutputTokens,
  expiresAt,
  reasoning,
}) =>
  Object.freeze({
    modelId,
    displayName,
    contextWindow,
    ...(maxOutputTokens ? { maxOutputTokens } : {}),
    ...(expiresAt ? { expiresAt } : {}),
    capabilities: Object.freeze({
      textInput: true,
      imageInput: false,
      tools: true,
      reasoning,
    }),
    pricing: freePricing(modelId),
    sourceUrl: openRouterModelSourceUrl(modelId),
    checkedAt: OPENROUTER_API_CATALOG_CHECKED_AT,
  });

/** Maker/checker verified against OpenRouter's public exact-model endpoint API. */
export const VERIFIED_OPENROUTER_API_MODELS = Object.freeze([
  exactModel({
    modelId: 'cohere/north-mini-code:free',
    displayName: 'North Mini Code',
    contextWindow: 256_000,
    maxOutputTokens: 64_000,
    reasoning: true,
  }),
  exactModel({
    modelId: 'openai/gpt-oss-20b:free',
    displayName: 'GPT-OSS 20B',
    contextWindow: 131_072,
    maxOutputTokens: 32_768,
    reasoning: true,
  }),
  exactModel({
    modelId: 'nvidia/nemotron-3-ultra-550b-a55b:free',
    displayName: 'Nemotron 3 Ultra',
    contextWindow: 1_000_000,
    maxOutputTokens: 65_536,
    reasoning: true,
  }),
  exactModel({
    modelId: 'qwen/qwen3-coder:free',
    displayName: 'Qwen3 Coder 480B A35B',
    contextWindow: 262_000,
    maxOutputTokens: 262_000,
    expiresAt: '2026-07-19T00:00:00Z',
    reasoning: false,
  }),
  exactModel({
    modelId: 'qwen/qwen3-next-80b-a3b-instruct:free',
    displayName: 'Qwen3 Next 80B A3B Instruct',
    contextWindow: 262_144,
    expiresAt: '2026-07-19T00:00:00Z',
    reasoning: false,
  }),
]);

export const REJECTED_OPENROUTER_MODEL_IDS = Object.freeze({
  'openai/gpt-oss-120b:free': 'No exact free leaf is listed by the official API.',
  'openrouter/free': 'This is a router, not an exact leaf model.',
});

export function verifiedOpenRouterModel(modelId) {
  return VERIFIED_OPENROUTER_API_MODELS.find((entry) => entry.modelId === modelId);
}

export function catalogAvailability(entry, now = new Date()) {
  if (!entry?.expiresAt) return { status: 'available' };
  const expiresAt = Date.parse(entry.expiresAt);
  if (!Number.isFinite(expiresAt) || expiresAt <= now.getTime()) {
    return { status: 'unavailable', reason: `Expired ${entry.expiresAt}.` };
  }
  return { status: 'expiring', reason: `Expires ${entry.expiresAt}.` };
}
