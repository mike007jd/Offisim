import { InMemoryMemoryRepository } from '../../../repositories/memory-memory-repository.js';
import type {
  CompactSummaryRepository,
  CompactSummaryRow,
  NewCompactSummary,
  NewNodeSummary,
  NodeSummaryRepository,
  NodeSummaryRow,
} from '../../repositories.js';
import type { MemoryRepositoriesSnapshot } from '../memory-types.js';

function cloneRows<T extends object>(rows: Iterable<T>): T[] {
  return [...rows].map((row) => ({ ...row }));
}

export class MemoryNodeSummaryRepository implements NodeSummaryRepository {
  private readonly rows: NodeSummaryRow[] = [];

  constructor(initialRows?: Iterable<NodeSummaryRow>) {
    if (!initialRows) return;
    this.rows.push(...cloneRows(initialRows));
  }

  async create(summary: NewNodeSummary): Promise<NodeSummaryRow> {
    this.rows.push(summary);
    return summary;
  }

  async listByThread(threadId: string, opts?: { limit?: number }): Promise<NodeSummaryRow[]> {
    const rows = this.rows
      .filter((row) => row.thread_id === threadId)
      .sort((a, b) => b.created_at.localeCompare(a.created_at));
    return opts?.limit ? rows.slice(0, opts.limit) : rows;
  }

  async countByThread(threadId: string): Promise<number> {
    return this.rows.filter((row) => row.thread_id === threadId).length;
  }

  async deleteByThread(threadId: string): Promise<void> {
    for (let index = this.rows.length - 1; index >= 0; index--) {
      if (this.rows[index]?.thread_id === threadId) {
        this.rows.splice(index, 1);
      }
    }
  }

  async trimByThread(threadId: string, keepLatest: number): Promise<void> {
    if (keepLatest < 0) return;
    const keepIds = new Set(
      (await this.listByThread(threadId, { limit: keepLatest })).map((row) => row.summary_id),
    );
    for (let index = this.rows.length - 1; index >= 0; index--) {
      const row = this.rows[index];
      if (row?.thread_id === threadId && !keepIds.has(row.summary_id)) {
        this.rows.splice(index, 1);
      }
    }
  }

  snapshot(): NodeSummaryRow[] {
    return cloneRows(this.rows);
  }
}

export class MemoryCompactSummaryRepository implements CompactSummaryRepository {
  private readonly rows: CompactSummaryRow[] = [];

  constructor(initialRows?: Iterable<CompactSummaryRow>) {
    if (!initialRows) return;
    this.rows.push(...cloneRows(initialRows));
  }

  async create(summary: NewCompactSummary): Promise<CompactSummaryRow> {
    this.rows.push(summary);
    return summary;
  }

  async listByThread(threadId: string, opts?: { limit?: number }): Promise<CompactSummaryRow[]> {
    const rows = this.rows
      .filter((row) => row.thread_id === threadId)
      .sort((a, b) => b.created_at.localeCompare(a.created_at));
    return opts?.limit ? rows.slice(0, opts.limit) : rows;
  }

  async deleteByThread(threadId: string): Promise<void> {
    for (let index = this.rows.length - 1; index >= 0; index--) {
      if (this.rows[index]?.thread_id === threadId) {
        this.rows.splice(index, 1);
      }
    }
  }

  snapshot(): CompactSummaryRow[] {
    return cloneRows(this.rows);
  }
}

export interface MemorySystemMemoryRepos {
  memories: InMemoryMemoryRepository;
  nodeSummaries: MemoryNodeSummaryRepository;
  compactSummaries: MemoryCompactSummaryRepository;
}

export function createMemorySystemMemoryRepos(
  snapshot?: Partial<MemoryRepositoriesSnapshot>,
): MemorySystemMemoryRepos {
  const memories = new InMemoryMemoryRepository(snapshot?.memories);
  const nodeSummaries = new MemoryNodeSummaryRepository(snapshot?.nodeSummaries);
  const compactSummaries = new MemoryCompactSummaryRepository(snapshot?.compactSummaries);
  return { memories, nodeSummaries, compactSummaries };
}
