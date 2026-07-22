import { matchCostRate } from '../../../utils/glob-match.js';
import type {
  ModelCostRateRepository,
  ModelCostRateRow,
  NewModelCostRate,
} from '../../repositories.js';
import type { MemoryRepositoriesSnapshot } from '../memory-types.js';
import { cloneRows } from '../memory-utils.js';

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
  costRates: MemoryModelCostRateRepository;
}

export function createLlmMemoryRepos(
  snapshot?: Partial<MemoryRepositoriesSnapshot>,
): LlmMemoryRepos {
  const costRates = new MemoryModelCostRateRepository(snapshot?.costRates);
  return { costRates };
}
