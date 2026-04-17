import { byteLength } from '../../../utils/byte-length.js';
import type {
  DeliverableRepository,
  DeliverableRow,
  DeliverableSummaryRow,
  NewDeliverable,
} from '../../repositories.js';
import { coerceDeliverableKind } from '../../repositories.js';
import type { MemoryRepositoriesSnapshot } from '../memory-types.js';

const DEFAULT_LIST_LIMIT = 100;

function cloneRows<T extends object>(rows: Iterable<T>): T[] {
  return [...rows].map((row) => ({ ...row }));
}

function sanitize(row: DeliverableRow): DeliverableRow {
  return { ...row, kind: coerceDeliverableKind(row.kind) };
}

export class MemoryDeliverableRepository implements DeliverableRepository {
  private readonly store = new Map<string, DeliverableRow>();
  private readonly sizeCache = new Map<string, number>();

  constructor(initialRows?: Iterable<DeliverableRow>) {
    if (!initialRows) return;
    for (const row of cloneRows(initialRows)) {
      if (!this.store.has(row.deliverable_id)) {
        const clean = sanitize(row);
        this.store.set(clean.deliverable_id, clean);
        this.sizeCache.set(clean.deliverable_id, byteLength(clean.content));
      }
    }
  }

  async insert(row: NewDeliverable): Promise<void> {
    if (this.store.has(row.deliverable_id)) return;
    const clean = sanitize({ ...row });
    this.store.set(clean.deliverable_id, clean);
    this.sizeCache.set(clean.deliverable_id, byteLength(clean.content));
  }

  async findById(deliverableId: string): Promise<DeliverableRow | null> {
    const found = this.store.get(deliverableId);
    return found ? { ...found } : null;
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
    return filtered.slice(0, limit).map((row) => {
      const { content, ...rest } = row;
      return {
        ...rest,
        content_size: this.sizeCache.get(row.deliverable_id) ?? byteLength(content),
      };
    });
  }

  snapshot(): DeliverableRow[] {
    return cloneRows(this.store.values());
  }

  seed(rows: Iterable<DeliverableRow>): void {
    this.store.clear();
    this.sizeCache.clear();
    for (const row of cloneRows(rows)) {
      const clean = sanitize(row);
      this.store.set(clean.deliverable_id, clean);
      this.sizeCache.set(clean.deliverable_id, byteLength(clean.content));
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
