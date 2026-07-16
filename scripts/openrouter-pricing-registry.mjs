export const OPENROUTER_API_BASE_URL = 'https://openrouter.ai/api/v1';

const PRICING_CHECKED_AT = '2026-07-14T21:56:24+10:00';
const KNOWN_FREE_MODEL_IDS = new Set([
  'cohere/north-mini-code:free',
  'openai/gpt-oss-20b:free',
  'nvidia/nemotron-3-ultra-550b-a55b:free',
  'qwen/qwen3-coder:free',
  'qwen/qwen3-next-80b-a3b-instruct:free',
]);

/** Optional cost metadata only. This registry never controls model discovery,
 * selection, availability, or execution; Pi models.json remains authoritative. */
export function openRouterPricingFor(modelId) {
  if (!KNOWN_FREE_MODEL_IDS.has(modelId)) return undefined;
  return Object.freeze({
    currency: 'USD',
    inputPerMillion: 0,
    outputPerMillion: 0,
    sourceUrl: `${OPENROUTER_API_BASE_URL}/models/${modelId}/endpoints`,
    checkedAt: PRICING_CHECKED_AT,
  });
}
