import type { LlmProvider } from '@offisim/shared-types';

export interface OpenAiAgentsSdkLanePolicyInput {
  provider: LlmProvider;
  providerVariantId?: string;
  allowExperimentalCompat?: boolean;
}

/**
 * OpenAI-compatible providers stay opt-in until backend harness evidence
 * proves that a preset can sustain the Agents SDK lane reliably.
 */
export const VERIFIED_OPENAI_AGENTS_SDK_COMPAT_PRESET_IDS = new Set<string>();

function normalizePresetId(value: string | undefined): string | null {
  return typeof value === 'string' && value.trim() ? value.trim() : null;
}

export function isVerifiedOpenAiAgentsSdkCompatPreset(
  providerVariantId: string | undefined,
): boolean {
  const presetId = normalizePresetId(providerVariantId);
  return presetId !== null && VERIFIED_OPENAI_AGENTS_SDK_COMPAT_PRESET_IDS.has(presetId);
}

export function assertOpenAiAgentsSdkLaneSupported({
  provider,
  providerVariantId,
  allowExperimentalCompat = false,
}: OpenAiAgentsSdkLanePolicyInput): void {
  if (provider === 'openai') return;

  if (provider !== 'openai-compat') {
    throw new Error(
      `Execution lane "openai-agents-sdk" currently requires provider "openai" or "openai-compat"; received "${provider}".`,
    );
  }

  const presetId = normalizePresetId(providerVariantId);
  if (presetId !== null && VERIFIED_OPENAI_AGENTS_SDK_COMPAT_PRESET_IDS.has(presetId)) {
    return;
  }
  if (allowExperimentalCompat) return;

  if (presetId) {
    throw new Error(
      `Execution lane "openai-agents-sdk" is not yet verified for preset "${presetId}". Use the gateway lane or rerun backend harness verification with --allow-experimental-openai-compat.`,
    );
  }

  throw new Error(
    'Execution lane "openai-agents-sdk" requires native OpenAI or a verified OpenAI-compatible preset. Use the gateway lane or pass --provider-variant plus --allow-experimental-openai-compat while collecting harness evidence.',
  );
}
