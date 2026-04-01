import { matchCostRate } from '../utils/glob-match.js';
import type { ModelCostRateRepository, ModelCostRateRow } from './repositories.js';

export type PricingConfidence = 'exact' | 'catalog' | 'fallback' | 'unknown';

export interface PricingResolution {
  readonly inputCostPerMTok: number;
  readonly outputCostPerMTok: number;
  readonly source: string;
  readonly confidence: Exclude<PricingConfidence, 'unknown'>;
  readonly matchedPattern?: string;
}

export interface UsageEstimateInput {
  readonly provider: string;
  readonly model: string;
  readonly inputTokens: number;
  readonly outputTokens: number;
}

export interface UsageEstimate {
  readonly inputCost: number;
  readonly outputCost: number;
  readonly totalCost: number;
  readonly rateFound: boolean;
  readonly source: string;
  readonly confidence: PricingConfidence;
  readonly matchedPattern?: string;
}

export interface PricingSource {
  resolve(provider: string, model: string): Promise<PricingResolution | null>;
}

export class PricingSourceRegistry {
  constructor(private readonly sources: readonly PricingSource[]) {}

  async resolve(provider: string, model: string): Promise<PricingResolution | null> {
    for (const source of this.sources) {
      const resolution = await source.resolve(provider, model);
      if (resolution) return resolution;
    }
    return null;
  }

  async estimateUsage(input: UsageEstimateInput): Promise<UsageEstimate> {
    const resolution = await this.resolve(input.provider, input.model);
    if (!resolution) {
      return {
        inputCost: 0,
        outputCost: 0,
        totalCost: 0,
        rateFound: false,
        source: 'unknown',
        confidence: 'unknown',
      };
    }

    const inputCost = (input.inputTokens / 1_000_000) * resolution.inputCostPerMTok;
    const outputCost = (input.outputTokens / 1_000_000) * resolution.outputCostPerMTok;
    return {
      inputCost,
      outputCost,
      totalCost: inputCost + outputCost,
      rateFound: true,
      source: resolution.source,
      confidence: resolution.confidence,
      matchedPattern: resolution.matchedPattern,
    };
  }
}

export class ModelCostRatePricingSource implements PricingSource {
  constructor(
    private readonly repo: ModelCostRateRepository,
    private readonly source = 'configured_rates',
    private readonly confidence: Exclude<PricingConfidence, 'unknown'> = 'exact',
  ) {}

  async resolve(provider: string, model: string): Promise<PricingResolution | null> {
    const match = await this.repo.findByProviderModel(provider, model);
    if (!match) return null;
    return {
      inputCostPerMTok: match.input_cost_per_mtok,
      outputCostPerMTok: match.output_cost_per_mtok,
      source: this.source,
      confidence: this.confidence,
      matchedPattern: match.model_pattern,
    };
  }
}

type StaticRateLike = Pick<
  ModelCostRateRow,
  'provider' | 'model_pattern' | 'input_cost_per_mtok' | 'output_cost_per_mtok'
>;

export class StaticPricingSource implements PricingSource {
  constructor(
    private readonly rates: readonly StaticRateLike[],
    private readonly source: string,
    private readonly confidence: Exclude<PricingConfidence, 'unknown'>,
  ) {}

  async resolve(provider: string, model: string): Promise<PricingResolution | null> {
    const match = matchCostRate(this.rates as readonly ModelCostRateRow[], provider, model);
    if (!match) return null;
    return {
      inputCostPerMTok: match.input_cost_per_mtok,
      outputCostPerMTok: match.output_cost_per_mtok,
      source: this.source,
      confidence: this.confidence,
      matchedPattern: match.model_pattern,
    };
  }
}
