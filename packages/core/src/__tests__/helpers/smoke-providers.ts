import { createGateway } from '../../llm/gateway-factory.js';
import type { LlmGateway } from '../../llm/gateway.js';
import { requiredEnv } from './fixtures.js';

export const HAS_MINIMAX = !!process.env.MINIMAX_API_KEY;
export const MINIMAX_MODEL = process.env.MINIMAX_MODEL ?? 'MiniMax-M2.7-highspeed';

export function createMiniMaxGateway(): LlmGateway {
  return createGateway({
    provider: 'anthropic',
    apiKey: requiredEnv('MINIMAX_API_KEY'),
    baseURL: process.env.MINIMAX_BASE_URL ?? 'https://api.minimax.io/anthropic',
  });
}
