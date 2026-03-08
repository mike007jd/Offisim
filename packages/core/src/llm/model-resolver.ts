import type { ModelPolicyConfig, ModelProfile, ResolvedModel } from '@aics/shared-types';

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

  constructor(policy: ModelPolicyConfig | null | undefined, fallback?: ResolvedModel) {
    this.policy = policy ?? null;
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

    if (this.policy && roleSlug && this.policy.overrides?.[roleSlug]) {
      return this.toResolved(this.policy.overrides[roleSlug]!);
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
