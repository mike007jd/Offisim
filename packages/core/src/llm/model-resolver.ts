import type {
  ModelPolicyConfig,
  ModelProfile,
  ResolvedModel,
  RuntimePolicyConfig,
} from '@offisim/shared-types';

/**
 * System-level fallback when no policy and no explicit fallback is provided.
 * Intentionally generic — forces callers to supply a policy or fallback.
 */
const SYSTEM_FALLBACK: ResolvedModel = {
  provider: 'openai-compat',
  model: 'default',
  temperature: 0.7,
  maxTokens: 4096,
};

const DEFAULT_TEMPERATURE = 0.7;
const DEFAULT_MAX_TOKENS = 4096;

export class ModelResolver {
  private readonly policy: ModelPolicyConfig | null;
  private readonly fallback: ResolvedModel;

  constructor(
    policy: ModelPolicyConfig | RuntimePolicyConfig | null | undefined,
    fallback?: ResolvedModel,
  ) {
    this.policy = resolveModelPolicy(policy);
    this.fallback = fallback ?? SYSTEM_FALLBACK;
  }

  /**
   * Resolve a model configuration.
   * Priority: employeeProfile > roleSlug override > company default > fallback.
   */
  resolve(employeeProfile?: ModelProfile | null, roleSlug?: string): ResolvedModel {
    if (employeeProfile) {
      return this.toResolved(employeeProfile);
    }

    const roleOverride =
      this.policy && roleSlug ? (this.policy.overrides?.[roleSlug] ?? null) : null;
    if (roleOverride) {
      return this.toResolved(roleOverride);
    }

    if (this.policy) {
      return this.toResolved(this.policy.default);
    }

    return this.fallback;
  }

  private toResolved(profile: ModelProfile): ResolvedModel {
    return {
      provider: profile.provider,
      model: profile.model,
      temperature: profile.temperature ?? DEFAULT_TEMPERATURE,
      maxTokens: profile.maxTokens ?? DEFAULT_MAX_TOKENS,
    };
  }
}

export function resolveModelPolicy(
  policy: ModelPolicyConfig | RuntimePolicyConfig | null | undefined,
): ModelPolicyConfig | null {
  if (!policy) return null;
  if ('default' in policy) {
    return policy;
  }
  return policy.modelPolicy ?? null;
}
