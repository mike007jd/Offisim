import type {
  DeliverableRepository,
  DeliverableRow,
  DeliverableSummaryRow,
  NewDeliverable,
} from '../../repositories.js';
import type { MemoryRepositoriesSnapshot } from '../memory-types.js';

const DEFAULT_LIST_LIMIT = 100;

function toSummary(row: DeliverableRow): DeliverableSummaryRow {
  const { content, ...rest } = row;
  return {
    ...rest,
    content_size:
      typeof Buffer !== 'undefined'
        ? Buffer.byteLength(content, 'utf8')
        : new TextEncoder().encode(content).length,
  };
}

function cloneRow(row: DeliverableRow): DeliverableRow {
  return { ...row };
}

export class MemoryDeliverableRepository implements DeliverableRepository {
  private readonly store = new Map<string, DeliverableRow>();

  constructor(initialRows?: Iterable<DeliverableRow>) {
    if (!initialRows) return;
    for (const row of initialRows) {
      if (!this.store.has(row.deliverable_id)) {
        this.store.set(row.deliverable_id, cloneRow(row));
      }
    }
  }

  async insert(row: NewDeliverable): Promise<void> {
    if (this.store.has(row.deliverable_id)) return;
    this.store.set(row.deliverable_id, cloneRow(row));
  }

  async findById(deliverableId: string): Promise<DeliverableRow | null> {
    const found = this.store.get(deliverableId);
    return found ? cloneRow(found) : null;
  }

  async listByCompany(
    companyId: string,
    opts?: { threadId?: string; limit?: number },
  ): Promise<DeliverableSummaryRow[]> {
    const limit = opts?.limit ?? DEFAULT_LIST_LIMIT;
    const filtered = [...this.store.values()].filter((row) => {
      if (row.company_id !== companyId) return false;
      if (opts?.threadId !== undefined && row.thread_id !== opts.threadId) return false;
      return true;
    });
    filtered.sort((a, b) => b.created_at.localeCompare(a.created_at));
    return filtered.slice(0, limit).map(toSummary);
  }

  snapshot(): DeliverableRow[] {
    return [...this.store.values()].map(cloneRow);
  }

  seed(rows: Iterable<DeliverableRow>): void {
    this.store.clear();
    for (const row of rows) {
      this.store.set(row.deliverable_id, cloneRow(row));
    }
  }
}

export interface DeliverablesMemoryRepos {
  deliverables: MemoryDeliverableRepository;
}

export function createDeliverablesMemoryRepos(
  snapshot?: Partial<MemoryRepositoriesSnapshot>,
): DeliverablesMemoryRepos {
  return {
    deliverables: new MemoryDeliverableRepository(snapshot?.deliverables),
  };
}
