import {
  ModelCostRatePricingSource,
  type PricingConfidence,
  PricingSourceRegistry,
  StaticPricingSource,
} from './pricing-source-registry.js';
import type {
  LlmCallRepository,
  LlmCallRow,
  ModelCostRateRepository,
  ModelCostRateRow,
  ThreadRepository,
} from './repositories.js';

/**
 * Aggregated cost grouping returned by {@link CostCalculationService.aggregateCosts}.
 */
export interface CostAggregate {
  groupKey: string;
  inputTokens: number;
  outputTokens: number;
  totalCost: number;
  callCount: number;
  pricedCallCount: number;
  unpricedCallCount: number;
  pricingConfidence: PricingConfidence;
}

/**
 * Dashboard summary returned by {@link CostCalculationService.getDashboardSummary}.
 * Computes total, today, by-model, and by-employee breakdowns in a single data pass.
 */
export interface DashboardSummary {
  totalCost: number;
  todayCost: number;
  totalCalls: number;
  todayCalls: number;
  pricedCallCount: number;
  unpricedCallCount: number;
  costConfidence: PricingConfidence;
  byModel: CostAggregate[];
  byEmployee: CostAggregate[];
}

type MutableAggregate = {
  inputTokens: number;
  outputTokens: number;
  totalCost: number;
  callCount: number;
  pricedCallCount: number;
  unpricedCallCount: number;
  pricingConfidence: PricingConfidence;
};

/**
 * Service for computing LLM usage costs.
 *
 * Reads cost rates from {@link ModelCostRateRepository} and LLM call history
 * from {@link LlmCallRepository}. Thread lookups use {@link ThreadRepository}
 * to resolve company → thread → call relationships.
 */
export class CostCalculationService {
  private readonly pricing: PricingSourceRegistry;

  constructor(
    private costRateRepo: ModelCostRateRepository,
    private llmCallRepo: LlmCallRepository,
    private threadRepo: ThreadRepository,
  ) {
    this.pricing = new PricingSourceRegistry([
      new ModelCostRatePricingSource(this.costRateRepo, 'configured_rates', 'exact'),
    ]);
  }

  /**
   * Find the best matching cost rate for a provider + model.
   *
   * Strategy: fetch all rates, filter by provider, test glob patterns,
   * then prefer the most specific match (longest pattern without wildcards,
   * i.e. longest `model_pattern` string).
   */
  async findRate(provider: string, model: string): Promise<ModelCostRateRow | null> {
    return this.costRateRepo.findByProviderModel(provider, model);
  }

  /**
   * Calculate cost for a single LLM call.
   * Returns zero cost if no matching rate is found.
   */
  async calculateCallCost(call: LlmCallRow): Promise<{
    inputCost: number;
    outputCost: number;
    totalCost: number;
    rateFound: boolean;
    source: string;
    confidence: PricingConfidence;
  }> {
    return this.pricing.estimateUsage({
      provider: call.provider,
      model: call.model,
      inputTokens: call.input_tokens,
      outputTokens: call.output_tokens,
      cacheReadInputTokens: call.cache_read_input_tokens,
      cacheCreationInputTokens: call.cache_creation_input_tokens,
    });
  }

  /**
   * Aggregate costs across all LLM calls for a company.
   *
   * Uses batch `findByThreadIds` to avoid N+1 per-thread queries.
   */
  async aggregateCosts(
    companyId: string,
    opts: {
      from?: string;
      to?: string;
      groupBy?: 'model' | 'employee' | 'day';
    } = {},
  ): Promise<CostAggregate[]> {
    const threads = await this.threadRepo.findByCompany(companyId);
    if (threads.length === 0) return [];

    const threadIds = threads.map((t) => t.thread_id);
    const allCalls = await this.llmCallRepo.findByThreadIds(threadIds);

    let filtered = allCalls;
    const { from, to } = opts;
    if (from) {
      filtered = filtered.filter((c) => c.created_at >= from);
    }
    if (to) {
      filtered = filtered.filter((c) => c.created_at <= to);
    }

    if (filtered.length === 0) return [];

    const pricing = await this.createConfiguredRatesRegistry();
    const groupBy = opts.groupBy ?? 'model';
    const groups = new Map<string, MutableAggregate>();

    for (const call of filtered) {
      const key = this.resolveGroupKey(call, groupBy);
      const existing = groups.get(key) ?? createEmptyAggregate();
      const estimate = await pricing.estimateUsage({
        provider: call.provider,
        model: call.model,
        inputTokens: call.input_tokens,
        outputTokens: call.output_tokens,
        cacheReadInputTokens: call.cache_read_input_tokens,
        cacheCreationInputTokens: call.cache_creation_input_tokens,
      });

      existing.inputTokens += call.input_tokens;
      existing.outputTokens += call.output_tokens;
      existing.totalCost += estimate.totalCost;
      existing.callCount += 1;
      if (estimate.rateFound) {
        existing.pricedCallCount += 1;
      } else {
        existing.unpricedCallCount += 1;
      }
      existing.pricingConfidence = mergeConfidence(existing.pricingConfidence, estimate.confidence);

      groups.set(key, existing);
    }

    return [...groups.entries()]
      .map(([groupKey, data]) => ({ groupKey, ...data }))
      .sort((a, b) => b.totalCost - a.totalCost);
  }

  /**
   * Compute a full dashboard summary in ONE data pass.
   *
   * Fetches threads + calls + rates once, then computes total, today,
   * by-model, and by-employee aggregations without redundant queries.
   */
  async getDashboardSummary(companyId: string): Promise<DashboardSummary> {
    const threads = await this.threadRepo.findByCompany(companyId);
    if (threads.length === 0) {
      return emptyDashboardSummary();
    }

    const threadIds = threads.map((t) => t.thread_id);
    const allCalls = await this.llmCallRepo.findByThreadIds(threadIds);
    if (allCalls.length === 0) {
      return emptyDashboardSummary();
    }

    const pricing = await this.createConfiguredRatesRegistry();
    const today = new Date().toISOString().slice(0, 10);
    const todayPrefix = `${today}T`;

    let totalCost = 0;
    let todayCost = 0;
    let totalCalls = 0;
    let todayCalls = 0;
    let pricedCallCount = 0;
    let unpricedCallCount = 0;
    let costConfidence: PricingConfidence = 'exact';
    const modelGroups = new Map<string, MutableAggregate>();
    const employeeGroups = new Map<string, MutableAggregate>();

    for (const call of allCalls) {
      const estimate = await pricing.estimateUsage({
        provider: call.provider,
        model: call.model,
        inputTokens: call.input_tokens,
        outputTokens: call.output_tokens,
        cacheReadInputTokens: call.cache_read_input_tokens,
        cacheCreationInputTokens: call.cache_creation_input_tokens,
      });

      totalCost += estimate.totalCost;
      totalCalls += 1;
      if (estimate.rateFound) {
        pricedCallCount += 1;
      } else {
        unpricedCallCount += 1;
      }
      costConfidence = mergeConfidence(costConfidence, estimate.confidence);

      if (call.created_at >= todayPrefix) {
        todayCost += estimate.totalCost;
        todayCalls += 1;
      }

      const modelKey = `${call.provider}/${call.model}`;
      const modelAggregate = modelGroups.get(modelKey) ?? createEmptyAggregate();
      applyEstimateToAggregate(modelAggregate, call, estimate);
      modelGroups.set(modelKey, modelAggregate);

      const employeeAggregate = employeeGroups.get(call.node_name) ?? createEmptyAggregate();
      applyEstimateToAggregate(employeeAggregate, call, estimate);
      employeeGroups.set(call.node_name, employeeAggregate);
    }

    return {
      totalCost,
      todayCost,
      totalCalls,
      todayCalls,
      pricedCallCount,
      unpricedCallCount,
      costConfidence,
      byModel: toAggregateArray(modelGroups),
      byEmployee: toAggregateArray(employeeGroups),
    };
  }

  private async createConfiguredRatesRegistry(): Promise<PricingSourceRegistry> {
    const allRates = await this.costRateRepo.findAll();
    return new PricingSourceRegistry([
      new StaticPricingSource(allRates, 'configured_rates', 'exact'),
    ]);
  }

  private resolveGroupKey(call: LlmCallRow, groupBy: 'model' | 'employee' | 'day'): string {
    switch (groupBy) {
      case 'model':
        return `${call.provider}/${call.model}`;
      case 'employee':
        return call.node_name;
      case 'day':
        return call.created_at.slice(0, 10);
      default:
        return 'unknown';
    }
  }
}

function createEmptyAggregate(): MutableAggregate {
  return {
    inputTokens: 0,
    outputTokens: 0,
    totalCost: 0,
    callCount: 0,
    pricedCallCount: 0,
    unpricedCallCount: 0,
    pricingConfidence: 'exact',
  };
}

function applyEstimateToAggregate(
  aggregate: MutableAggregate,
  call: LlmCallRow,
  estimate: {
    totalCost: number;
    rateFound: boolean;
    confidence: PricingConfidence;
  },
): void {
  aggregate.inputTokens += call.input_tokens;
  aggregate.outputTokens += call.output_tokens;
  aggregate.totalCost += estimate.totalCost;
  aggregate.callCount += 1;
  if (estimate.rateFound) {
    aggregate.pricedCallCount += 1;
  } else {
    aggregate.unpricedCallCount += 1;
  }
  aggregate.pricingConfidence = mergeConfidence(aggregate.pricingConfidence, estimate.confidence);
}

function toAggregateArray(groups: Map<string, MutableAggregate>): CostAggregate[] {
  return [...groups.entries()]
    .map(([groupKey, data]) => ({ groupKey, ...data }))
    .sort((a, b) => b.totalCost - a.totalCost);
}

function emptyDashboardSummary(): DashboardSummary {
  return {
    totalCost: 0,
    todayCost: 0,
    totalCalls: 0,
    todayCalls: 0,
    pricedCallCount: 0,
    unpricedCallCount: 0,
    costConfidence: 'unknown',
    byModel: [],
    byEmployee: [],
  };
}

const CONFIDENCE_ORDER: Record<PricingConfidence, number> = {
  exact: 0,
  catalog: 1,
  fallback: 2,
  unknown: 3,
};

function mergeConfidence(current: PricingConfidence, next: PricingConfidence): PricingConfidence {
  return CONFIDENCE_ORDER[next] > CONFIDENCE_ORDER[current] ? next : current;
}
