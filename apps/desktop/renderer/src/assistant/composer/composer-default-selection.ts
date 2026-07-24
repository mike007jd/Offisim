import type { AgentRuntimeModelOption } from './usePiAgentModels.js';

export function resolveComposerDefaultOption(
  list: readonly AgentRuntimeModelOption[],
  preferredSelectors: readonly string[],
): AgentRuntimeModelOption | undefined {
  for (const selector of preferredSelectors) {
    const preferred = list.find((option) => option.value === selector);
    if (preferred) return preferred;
  }
  return list.find((option) => option.availability === 'available');
}
