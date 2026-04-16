import type {
  LlmCallRepository,
  LlmCallRow,
  ModelCostRateRepository,
  ModelCostRateRow,
  NewLlmCall,
  NewModelCostRate,
} from '../../repositories.js';
import { matchCostRate } from '../../../utils/glob-match.js';
import type { MemoryRepositoriesSnapshot } from '../memory-types.js';

function cloneRows<T extends object>(rows: Iterable<T>): T[] {
  return [...rows].map((row) => ({ ...row }));
}

export class MemoryLlmCallRepository implements LlmCallRepository {
  private readonly rows = new Map<string, LlmCallRow>();

  constructor(initial?: Iterable<LlmCallRow>) {
    if (initial) {
      for (const row of initial) this.rows.set(row.llm_call_id, { ...row });
    }
  }

  async create(c: NewLlmCall): Promise<LlmCallRow> {
    const row: LlmCallRow = { ...c };
    this.rows.set(row.llm_call_id, row);
    return row;
  }

  async findByThread(threadId: string): Promise<LlmCallRow[]> {
    return [...this.rows.values()].filter((c) => c.thread_id === threadId);
  }

  async findByThreadIds(threadIds: string[]): Promise<LlmCallRow[]> {
    const idSet = new Set(threadIds);
    return [...this.rows.values()].filter((c) => c.thread_id !== null && idSet.has(c.thread_id));
  }

  async findByTaskRun(taskRunId: string): Promise<LlmCallRow[]> {
    return [...this.rows.values()].filter((c) => c.task_run_id === taskRunId);
  }

  snapshot(): LlmCallRow[] {
    return cloneRows(this.rows.values());
  }
}

export class MemoryModelCostRateRepository implements ModelCostRateRepository {
  private readonly rows: ModelCostRateRow[] = [];

  constructor(initialRows?: Iterable<ModelCostRateRow>) {
    if (!initialRows) return;
    this.rows.push(...cloneRows(initialRows));
  }

  async create(rate: NewModelCostRate): Promise<ModelCostRateRow> {
    const row: ModelCostRateRow = {
      ...rate,
      rate_id: crypto.randomUUID(),
      created_at: new Date().toISOString(),
    };
    this.rows.push(row);
    return row;
  }

  async findByProviderModel(provider: string, model: string): Promise<ModelCostRateRow | null> {
    return matchCostRate(this.rows, provider, model);
  }

  async findAll(): Promise<ModelCostRateRow[]> {
    return [...this.rows];
  }

  async upsert(rate: NewModelCostRate): Promise<ModelCostRateRow> {
    const existing = this.rows.findIndex(
      (r) =>
        r.provider === rate.provider &&
        r.model_pattern === rate.model_pattern &&
        r.effective_from === rate.effective_from,
    );
    if (existing >= 0) {
      const current = this.rows[existing];
      if (!current) {
        return this.create(rate);
      }
      const updated: ModelCostRateRow = {
        ...current,
        ...rate,
      };
      this.rows[existing] = updated;
      return updated;
    }
    return this.create(rate);
  }

  snapshot(): ModelCostRateRow[] {
    return cloneRows(this.rows);
  }
}

export interface LlmMemoryRepos {
  llmCalls: MemoryLlmCallRepository;
  costRates: MemoryModelCostRateRepository;
}

export function createLlmMemoryRepos(
  snapshot?: Partial<MemoryRepositoriesSnapshot>,
): LlmMemoryRepos {
  const llmCalls = new MemoryLlmCallRepository(snapshot?.llmCalls);
  const costRates = new MemoryModelCostRateRepository(snapshot?.costRates);
  return { llmCalls, costRates };
}
