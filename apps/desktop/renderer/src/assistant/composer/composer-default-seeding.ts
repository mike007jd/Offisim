import type { ConversationTargetRunDefaults } from '@/runtime/conversation-target-defaults-store.js';
import type { PermissionMode } from '@/runtime/pi-thread-mode-store.js';
import type { ThinkingLevel } from '@/runtime/pi-thread-thinking-store.js';
import { resolveComposerDefaultOption } from './composer-default-selection.js';
import type { AgentRuntimeModelOption } from './usePiAgentModels.js';

export interface ConversationRunDefaultSeedPlan {
  readonly model?: string;
  readonly thinking?: ThinkingLevel;
  readonly speed?: 'fast';
  readonly mode?: PermissionMode;
}

/**
 * Pure seed decision for a brand-new conversation: which of the target's four
 * last-used axes apply to the given thread. Axes the thread already picked are
 * never touched; a stale target model (no longer in the catalog) skips only
 * the model axis while the remaining axes land on the resolved landing model.
 * Returns `undefined` when no landing model resolves — the caller must treat
 * that as "seed not consumed" so a later catalog refresh can still seed.
 */
export function planConversationRunDefaultSeed({
  options,
  targetDefaults,
  defaultModelSelector,
  existingModelValue,
  hasModelPick,
  hasThinkingPick,
  hasSpeedPick,
  hasModePick,
}: {
  options: readonly AgentRuntimeModelOption[];
  targetDefaults: ConversationTargetRunDefaults;
  defaultModelSelector: string | undefined;
  /** Current per-thread model value (may be set-but-empty). */
  existingModelValue: string | undefined;
  /** Whether the thread already has an entry on each axis store. */
  hasModelPick: boolean;
  hasThinkingPick: boolean;
  hasSpeedPick: boolean;
  hasModePick: boolean;
}): ConversationRunDefaultSeedPlan | undefined {
  const targetModel = targetDefaults.model
    ? options.find((option) => option.value === targetDefaults.model)
    : undefined;
  const landingModel = existingModelValue
    ? options.find((option) => option.value === existingModelValue)
    : (targetModel ??
      resolveComposerDefaultOption(
        options,
        [defaultModelSelector].filter((selector): selector is string => Boolean(selector)),
      ));
  if (!landingModel) return undefined;

  const plan: {
    model?: string;
    thinking?: ThinkingLevel;
    speed?: 'fast';
    mode?: PermissionMode;
  } = {};
  if (!hasModelPick && targetModel) plan.model = targetModel.value;
  if (
    !hasThinkingPick &&
    targetDefaults.thinking &&
    landingModel.reasoningEfforts.includes(targetDefaults.thinking)
  ) {
    plan.thinking = targetDefaults.thinking;
  }
  if (
    !hasSpeedPick &&
    targetDefaults.speed === 'fast' &&
    landingModel.speedModes.includes('fast')
  ) {
    plan.speed = 'fast';
  }
  if (
    !hasModePick &&
    targetDefaults.mode &&
    landingModel.capabilities.permissionModes.includes(targetDefaults.mode)
  ) {
    plan.mode = targetDefaults.mode;
  }
  return plan;
}
