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

export type DeliverableContentLoader = (id: string) => Promise<string | null>;

function cloneSummary(row: DeliverableSummaryRow): DeliverableSummaryRow {
  return { ...row, kind: coerceDeliverableKind(row.kind) };
}

function rowToSummary(row: DeliverableRow): DeliverableSummaryRow {
  const { content, ...rest } = row;
  return {
    ...rest,
    kind: coerceDeliverableKind(row.kind),
    content_size: byteLength(content),
  };
}

function summaryToFull(row: DeliverableSummaryRow, content: string): DeliverableRow {
  const { content_size: _unused, ...rest } = row;
  return { ...rest, content };
}

export class MemoryDeliverableRepository implements DeliverableRepository {
  private readonly summaryStore = new Map<string, DeliverableSummaryRow>();
  private readonly contentCache = new Map<string, string>();
  private readonly missWarned = new Set<string>();
  private readonly contentLoader?: DeliverableContentLoader;

  constructor(
    initialRows?: Iterable<DeliverableSummaryRow>,
    contentLoader?: DeliverableContentLoader,
  ) {
    this.contentLoader = contentLoader;
    if (!initialRows) return;
    for (const row of initialRows) {
      if (!this.summaryStore.has(row.deliverable_id)) {
        this.summaryStore.set(row.deliverable_id, cloneSummary(row));
      }
    }
  }

  async insert(row: NewDeliverable): Promise<void> {
    if (this.summaryStore.has(row.deliverable_id)) return;
    const summary = rowToSummary({ ...row, kind: coerceDeliverableKind(row.kind) });
    this.summaryStore.set(summary.deliverable_id, summary);
    this.contentCache.set(summary.deliverable_id, row.content);
  }

  async findById(deliverableId: string): Promise<DeliverableRow | null> {
    const summary = this.summaryStore.get(deliverableId);
    if (!summary) return null;
    const content = await this.ensureContent(deliverableId);
    return summaryToFull(summary, content);
  }

  async listByCompany(
    companyId: string,
    opts?: { threadId?: string; limit?: number },
  ): Promise<DeliverableSummaryRow[]> {
    return this.filterSorted(companyId, opts).map(cloneSummary);
  }

  async listByCompanyWithContent(
    companyId: string,
    opts?: { threadId?: string; limit?: number },
  ): Promise<DeliverableRow[]> {
    const summaries = this.filterSorted(companyId, opts);
    return Promise.all(
      summaries.map(async (summary) => {
        const content = await this.ensureContent(summary.deliverable_id);
        return summaryToFull(cloneSummary(summary), content);
      }),
    );
  }

  snapshot(): DeliverableSummaryRow[] {
    return [...this.summaryStore.values()].map(cloneSummary);
  }

  seed(rows: Iterable<DeliverableSummaryRow>): void {
    this.summaryStore.clear();
    this.contentCache.clear();
    this.missWarned.clear();
    for (const row of rows) {
      this.summaryStore.set(row.deliverable_id, cloneSummary(row));
    }
  }

  private filterSorted(
    companyId: string,
    opts?: { threadId?: string; limit?: number },
  ): DeliverableSummaryRow[] {
    const limit = opts?.limit ?? DEFAULT_LIST_LIMIT;
    const filtered = [...this.summaryStore.values()].filter((row) => {
      if (row.company_id !== companyId) return false;
      if (opts?.threadId !== undefined && row.thread_id !== opts.threadId) return false;
      return true;
    });
    filtered.sort((a, b) => b.created_at.localeCompare(a.created_at));
    return filtered.slice(0, limit);
  }

  private async ensureContent(id: string): Promise<string> {
    const cached = this.contentCache.get(id);
    if (cached !== undefined) return cached;
    if (!this.contentLoader) return '';
    try {
      const loaded = await this.contentLoader(id);
      if (loaded === null) {
        if (!this.missWarned.has(id)) {
          this.missWarned.add(id);
          console.warn(
            `[MemoryDeliverableRepository] content missing for ${id} — contentLoader returned null`,
          );
        }
        return '';
      }
      this.contentCache.set(id, loaded);
      return loaded;
    } catch (err) {
      if (!this.missWarned.has(id)) {
        this.missWarned.add(id);
        console.warn(`[MemoryDeliverableRepository] contentLoader failed for ${id}`, err);
      }
      return '';
    }
  }
}

export interface DeliverablesMemoryRepos {
  deliverables: MemoryDeliverableRepository;
}

export function createDeliverablesMemoryRepos(
  snapshot?: Partial<MemoryRepositoriesSnapshot>,
  contentLoader?: DeliverableContentLoader,
): DeliverablesMemoryRepos {
  return {
    deliverables: new MemoryDeliverableRepository(snapshot?.deliverables, contentLoader),
  };
}
