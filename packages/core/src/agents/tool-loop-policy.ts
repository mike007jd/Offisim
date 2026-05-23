import type { LlmProvider, RoleSlug, RuntimeToolLoopPolicy } from '@offisim/shared-types';

export interface ToolLoopLimitTarget {
  readonly roleSlug: RoleSlug;
  readonly provider: LlmProvider;
  readonly model: string;
}

export function resolveToolLoopMaxRounds(
  policy: RuntimeToolLoopPolicy | undefined,
  target: ToolLoopLimitTarget,
  defaultMaxRounds: number,
): number {
  const configured =
    resolveModelRoundLimit(policy?.modelMaxRounds, target.provider, target.model) ??
    policy?.roleMaxRounds?.[target.roleSlug] ??
    policy?.maxRounds ??
    defaultMaxRounds;
  return normalizeRoundLimit(configured, defaultMaxRounds);
}

function resolveModelRoundLimit(
  limits: RuntimeToolLoopPolicy['modelMaxRounds'] | undefined,
  provider: LlmProvider,
  model: string,
): number | undefined {
  if (!limits) return undefined;
  const candidates = [
    `${provider}/${model}`,
    model,
    `${provider}/${model}`.toLowerCase(),
    model.toLowerCase(),
  ];
  for (const candidate of candidates) {
    const value = limits[candidate];
    if (value !== undefined) return value;
  }
  return undefined;
}

function normalizeRoundLimit(value: number, fallback: number): number {
  if (!Number.isFinite(value)) return Math.max(1, Math.floor(fallback));
  return Math.max(1, Math.floor(value));
}
