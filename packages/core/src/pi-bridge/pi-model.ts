/**
 * Build a pi `Model<Api>` from an Offisim resolved model + provider profile.
 *
 * Offisim does not use pi's generated model catalog — models come from runtime
 * provider profiles (z.ai Coding Plan / MiniMax). This maps the two Offisim
 * provider lanes onto pi's two retained APIs:
 *   - 'anthropic'      → api 'anthropic-messages'   (z.ai glm via Claude-compat)
 *   - 'openai-compat'  → api 'openai-completions'   (MiniMax via OpenAI-compat)
 *
 * Cost is left at zero: Offisim budgets by token count, not pi's cost field.
 */

import type { Model } from '@offisim/pi-ai';
import type { LlmProvider } from '@offisim/shared-types';

const ZERO_COST = { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 } as const;

export interface PiModelInput {
  /** Offisim provider lane. */
  readonly provider: LlmProvider;
  /** Concrete model id (e.g. 'glm-4.6', 'MiniMax-M2.7'). */
  readonly model: string;
  /** Canonical endpoint base (the Rust transport rewrites the path per lane). */
  readonly baseUrl: string;
  /** Provider context window (tokens). Falls back to a conservative default. */
  readonly contextWindow?: number;
  /** Provider max output tokens. */
  readonly maxTokens?: number;
  /** Whether this model exposes extended thinking / reasoning content. */
  readonly reasoning?: boolean;
  /** Optional pi provider id override (affects compat auto-detection). */
  readonly piProvider?: string;
}

/** Map an Offisim provider lane to a pi API id. */
export function laneToPiApi(provider: LlmProvider): 'anthropic-messages' | 'openai-completions' {
  return provider === 'anthropic' ? 'anthropic-messages' : 'openai-completions';
}

/**
 * pi's openai-completions auto-detect (detectCompat) has no MiniMax branch, so
 * MiniMax inherits generic-OpenAI defaults that its API rejects: it expects
 * `max_tokens` (not `max_completion_tokens`) and does not implement `store`, the
 * `developer` role, `reasoning_effort`, or strict-mode tool schemas. Pin those.
 */
const MINIMAX_COMPAT = {
  maxTokensField: 'max_tokens',
  supportsStore: false,
  supportsDeveloperRole: false,
  supportsReasoningEffort: false,
  supportsStrictMode: false,
} as const;

function isMiniMax(input: PiModelInput): boolean {
  return /minimax/i.test(input.piProvider ?? '') || /minimax/i.test(input.baseUrl);
}

export function buildPiModel(input: PiModelInput): Model<'anthropic-messages' | 'openai-completions'> {
  const api = laneToPiApi(input.provider);
  const piProvider = input.piProvider ?? (api === 'anthropic-messages' ? 'anthropic' : 'openai');
  const model: Model<'anthropic-messages' | 'openai-completions'> = {
    id: input.model,
    name: input.model,
    api,
    provider: piProvider,
    baseUrl: input.baseUrl,
    reasoning: input.reasoning ?? false,
    input: ['text', 'image'],
    cost: { ...ZERO_COST },
    contextWindow: input.contextWindow && input.contextWindow > 0 ? input.contextWindow : 128000,
    maxTokens: input.maxTokens && input.maxTokens > 0 ? input.maxTokens : 8192,
  };
  if (api === 'openai-completions' && isMiniMax(input)) {
    return { ...model, compat: { ...MINIMAX_COMPAT } } as Model<'openai-completions'>;
  }
  return model;
}
