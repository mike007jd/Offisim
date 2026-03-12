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
   * Joins company → threads → llm_calls, then groups by the requested dimension.
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

    // 2. Fetch all LLM calls across those threads
    const allCalls: LlmCallRow[] = [];
    for (const thread of threads) {
      const calls = await this.llmCallRepo.findByThread(thread.thread_id);
      allCalls.push(...calls);
    }

    // 3. Apply time filters
    let filtered = allCalls;
    if (opts.from) {
      filtered = filtered.filter((c) => c.created_at >= opts.from!);
    }
    if (opts.to) {
      filtered = filtered.filter((c) => c.created_at <= opts.to!);
    }

    if (filtered.length === 0) return [];

    // 4. Group
    const groupBy = opts.groupBy ?? 'model';
    const groups = new Map<string, { inputTokens: number; outputTokens: number; totalCost: number; callCount: number }>();

    for (const call of filtered) {
      const key = this.resolveGroupKey(call, groupBy);
      const existing = groups.get(key) ?? { inputTokens: 0, outputTokens: 0, totalCost: 0, callCount: 0 };

      const cost = await this.calculateCallCost(call);
      existing.inputTokens += call.input_tokens;
      existing.outputTokens += call.output_tokens;
      existing.totalCost += cost.totalCost;
      existing.callCount += 1;

      groups.set(key, existing);
    }

    // 5. Convert to array, sorted by totalCost descending
    const result: CostAggregate[] = [];
    for (const [groupKey, data] of groups) {
      result.push({ groupKey, ...data });
    }
    result.sort((a, b) => b.totalCost - a.totalCost);

    return result;
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
