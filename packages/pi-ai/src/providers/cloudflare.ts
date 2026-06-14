import type { Api, Model } from '../types.js';

/** Workers AI direct endpoint. */
export const CLOUDFLARE_WORKERS_AI_BASE_URL =
  'https://api.cloudflare.com/client/v4/accounts/{CLOUDFLARE_ACCOUNT_ID}/ai/v1';

/** AI Gateway Unified API. https://developers.cloudflare.com/ai-gateway/usage/unified-api/ */
export const CLOUDFLARE_AI_GATEWAY_COMPAT_BASE_URL =
  'https://gateway.ai.cloudflare.com/v1/{CLOUDFLARE_ACCOUNT_ID}/{CLOUDFLARE_GATEWAY_ID}/compat';

/** AI Gateway → OpenAI passthrough. Used until /compat supports /v1/responses. */
export const CLOUDFLARE_AI_GATEWAY_OPENAI_BASE_URL =
  'https://gateway.ai.cloudflare.com/v1/{CLOUDFLARE_ACCOUNT_ID}/{CLOUDFLARE_GATEWAY_ID}/openai';

/** AI Gateway → Anthropic passthrough. */
export const CLOUDFLARE_AI_GATEWAY_ANTHROPIC_BASE_URL =
  'https://gateway.ai.cloudflare.com/v1/{CLOUDFLARE_ACCOUNT_ID}/{CLOUDFLARE_GATEWAY_ID}/anthropic';

export function isCloudflareProvider(provider: string): boolean {
  return provider === 'cloudflare-workers-ai' || provider === 'cloudflare-ai-gateway';
}

/** Cloudflare profiles must pass a host-resolved baseUrl; providers never read env. */
export function resolveCloudflareBaseUrl(model: Model<Api>): string {
  const url = model.baseUrl;
  if (url.includes('{')) {
    throw new Error(`Provider ${model.provider} requires a fully resolved baseUrl.`);
  }
  return url;
}
