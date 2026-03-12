import { matchCostRate } from '../utils/glob-match.js';
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
  byModel: CostAggregate[];
  byEmployee: CostAggregate[];
}

/**
 * Service for computing LLM usage costs.
 *
 * Reads cost rates from {@link ModelCostRateRepository} and LLM call history
 * from {@link LlmCallRepository}. Thread lookups use {@link ThreadRepository}
 * to resolve company → thread → call relationships.
 */
export class CostCalculationService {
  constructor(
    private costRateRepo: ModelCostRateRepository,
    private llmCallRepo: LlmCallRepository,
    private threadRepo: ThreadRepository,
  ) {}

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
  }> {
    const rate = await this.findRate(call.provider, call.model);
    if (!rate) {
      return { inputCost: 0, outputCost: 0, totalCost: 0, rateFound: false };
    }

    const inputCost = (call.input_tokens / 1_000_000) * rate.input_cost_per_mtok;
    const outputCost = (call.output_tokens / 1_000_000) * rate.output_cost_per_mtok;
    return {
      inputCost,
      outputCost,
      totalCost: inputCost + outputCost,
      rateFound: true,
    };
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
    // 1. Fetch all threads for the company
    const threads = await this.threadRepo.findByCompany(companyId);
    if (threads.length === 0) return [];

    // 2. Batch-fetch all LLM calls across those threads (single query)
    const threadIds = threads.map((t) => t.thread_id);
    const allCalls = await this.llmCallRepo.findByThreadIds(threadIds);

    // 3. Apply time filters
    let filtered = allCalls;
    if (opts.from) {
      filtered = filtered.filter((c) => c.created_at >= opts.from!);
    }
    if (opts.to) {
      filtered = filtered.filter((c) => c.created_at <= opts.to!);
    }

    if (filtered.length === 0) return [];

    // 4. Pre-fetch all cost rates once to avoid N+1 queries
    const allRates = await this.costRateRepo.findAll();

    // 5. Group
    const groupBy = opts.groupBy ?? 'model';
    const groups = new Map<
      string,
      { inputTokens: number; outputTokens: number; totalCost: number; callCount: number }
    >();

    for (const call of filtered) {
      const key = this.resolveGroupKey(call, groupBy);
      const existing = groups.get(key) ?? {
        inputTokens: 0,
        outputTokens: 0,
        totalCost: 0,
        callCount: 0,
      };

      const rate = CostCalculationService.matchRate(allRates, call.provider, call.model);
      const totalCost = rate
        ? (call.input_tokens / 1_000_000) * rate.input_cost_per_mtok +
          (call.output_tokens / 1_000_000) * rate.output_cost_per_mtok
        : 0;

      existing.inputTokens += call.input_tokens;
      existing.outputTokens += call.output_tokens;
      existing.totalCost += totalCost;
      existing.callCount += 1;

      groups.set(key, existing);
    }

    // 6. Convert to array, sorted by totalCost descending
    const result: CostAggregate[] = [];
    for (const [groupKey, data] of groups) {
      result.push({ groupKey, ...data });
    }
    result.sort((a, b) => b.totalCost - a.totalCost);

    return result;
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
      return {
        totalCost: 0,
        todayCost: 0,
        totalCalls: 0,
        todayCalls: 0,
        byModel: [],
        byEmployee: [],
      };
    }

    const threadIds = threads.map((t) => t.thread_id);
    const allCalls = await this.llmCallRepo.findByThreadIds(threadIds);
    if (allCalls.length === 0) {
      return {
        totalCost: 0,
        todayCost: 0,
        totalCalls: 0,
        todayCalls: 0,
        byModel: [],
        byEmployee: [],
      };
    }

    const allRates = await this.costRateRepo.findAll();
    const today = new Date().toISOString().slice(0, 10); // YYYY-MM-DD
    const todayPrefix = `${today}T`;

    let totalCost = 0;
    let todayCost = 0;
    let totalCalls = 0;
    let todayCalls = 0;
    const modelGroups = new Map<
      string,
      { inputTokens: number; outputTokens: number; totalCost: number; callCount: number }
    >();
    const employeeGroups = new Map<
      string,
      { inputTokens: number; outputTokens: number; totalCost: number; callCount: number }
    >();

    for (const call of allCalls) {
      const rate = CostCalculationService.matchRate(allRates, call.provider, call.model);
      const cost = rate
        ? (call.input_tokens / 1_000_000) * rate.input_cost_per_mtok +
          (call.output_tokens / 1_000_000) * rate.output_cost_per_mtok
        : 0;

      totalCost += cost;
      totalCalls += 1;

      if (call.created_at >= todayPrefix) {
        todayCost += cost;
        todayCalls += 1;
      }

      // By model
      const modelKey = `${call.provider}/${call.model}`;
      const mg = modelGroups.get(modelKey) ?? {
        inputTokens: 0,
        outputTokens: 0,
        totalCost: 0,
        callCount: 0,
      };
      mg.inputTokens += call.input_tokens;
      mg.outputTokens += call.output_tokens;
      mg.totalCost += cost;
      mg.callCount += 1;
      modelGroups.set(modelKey, mg);

      // By employee (node_name)
      const eg = employeeGroups.get(call.node_name) ?? {
        inputTokens: 0,
        outputTokens: 0,
        totalCost: 0,
        callCount: 0,
      };
      eg.inputTokens += call.input_tokens;
      eg.outputTokens += call.output_tokens;
      eg.totalCost += cost;
      eg.callCount += 1;
      employeeGroups.set(call.node_name, eg);
    }

    const toAggArray = (
      groups: Map<
        string,
        { inputTokens: number; outputTokens: number; totalCost: number; callCount: number }
      >,
    ): CostAggregate[] => {
      const arr: CostAggregate[] = [];
      for (const [groupKey, data] of groups) {
        arr.push({ groupKey, ...data });
      }
      arr.sort((a, b) => b.totalCost - a.totalCost);
      return arr;
    };

    return {
      totalCost,
      todayCost,
      totalCalls,
      todayCalls,
      byModel: toAggArray(modelGroups),
      byEmployee: toAggArray(employeeGroups),
    };
  }

  /**
   * Match a cost rate from a pre-fetched array using glob pattern matching.
   * Static so it can be tested independently of repository wiring.
   */
  static matchRate(
    rates: readonly ModelCostRateRow[],
    provider: string,
    model: string,
  ): ModelCostRateRow | null {
    return matchCostRate(rates, provider, model);
  }

  private resolveGroupKey(call: LlmCallRow, groupBy: 'model' | 'employee' | 'day'): string {
    switch (groupBy) {
      case 'model':
        return `${call.provider}/${call.model}`;
      case 'employee':
        return call.node_name;
      case 'day':
        return call.created_at.slice(0, 10); // YYYY-MM-DD
      default:
        return 'unknown';
    }
  }
}
