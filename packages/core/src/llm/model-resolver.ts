import type { ModelPolicyConfig, ModelProfile, ResolvedModel } from '@aics/shared-types';

const HARDCODED_DEFAULT: ResolvedModel = {
  provider: 'anthropic',
  model: 'claude-sonnet-4-20250514',
  temperature: 0.7,
  maxTokens: 4096,
};

const DEFAULT_TEMPERATURE = 0.7;
const DEFAULT_MAX_TOKENS = 4096;

export class ModelResolver {
  private readonly policy: ModelPolicyConfig | null;

  constructor(policy: ModelPolicyConfig | null | undefined) {
    this.policy = policy ?? null;
  }

  /**
   * Resolve a model configuration.
   * Priority: employeeProfile > roleSlug override > company default > hardcoded.
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

    return HARDCODED_DEFAULT;
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
