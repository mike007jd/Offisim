import type {
  CheckpointRepository,
  CompanyRepository,
  CompanyRow,
  EventRepository,
  GraphCheckpointRow,
  GraphThreadRow,
  NewGraphCheckpoint,
  NewGraphThread,
  NewRuntimeEvent,
  NewTaskRun,
  RuntimeEventRow,
  TaskRunRepository,
  TaskRunRow,
  ThreadRepository,
} from '../../repositories.js';
import type { MemoryRepositoriesSnapshot } from '../memory-types.js';

function now(): string {
  return new Date().toISOString();
}

function cloneRows<T extends object>(rows: Iterable<T>): T[] {
  return [...rows].map((row) => ({ ...row }));
}

export class MemoryCompanyRepository implements CompanyRepository {
  private readonly rows = new Map<string, CompanyRow>();

  constructor(initial?: Iterable<CompanyRow>) {
    if (initial) {
      for (const row of initial) this.rows.set(row.company_id, { ...row });
    }
  }

  async findById(id: string): Promise<CompanyRow | null> {
    return this.rows.get(id) ?? null;
  }

  async findAll(): Promise<CompanyRow[]> {
    return [...this.rows.values()];
  }

  async create(company: CompanyRow): Promise<CompanyRow> {
    this.rows.set(company.company_id, company);
    return company;
  }

  async update(
    companyId: string,
    fields: Partial<
      Pick<
        CompanyRow,
        'name' | 'status' | 'template_id' | 'template_label' | 'description_json'
      >
    >,
  ): Promise<void> {
    const row = this.rows.get(companyId);
    if (row) {
      this.rows.set(companyId, { ...row, ...fields, updated_at: now() });
    }
  }

  async delete(companyId: string): Promise<void> {
    this.rows.delete(companyId);
  }

  seed(rows: CompanyRow[]): void {
    for (const row of rows) this.rows.set(row.company_id, row);
  }

  snapshot(): CompanyRow[] {
    return cloneRows(this.rows.values());
  }
}

function withThreadDefaults(row: GraphThreadRow): GraphThreadRow {
  return {
    ...row,
    interaction_mode: row.interaction_mode ?? 'boss_proxy',
  };
}

export class MemoryThreadRepository implements ThreadRepository {
  private readonly rows = new Map<string, GraphThreadRow>();

  constructor(initial?: Iterable<GraphThreadRow>) {
    if (initial) {
      for (const row of initial) this.rows.set(row.thread_id, { ...row });
    }
  }

  async create(t: NewGraphThread): Promise<GraphThreadRow> {
    const row: GraphThreadRow = {
      ...t,
      project_id: t.project_id ?? null,
      interaction_mode: t.interaction_mode ?? 'boss_proxy',
      synopsis_json: t.synopsis_json ?? null,
      compact_baseline_json: t.compact_baseline_json ?? null,
      created_at: now(),
      updated_at: now(),
    };
    this.rows.set(row.thread_id, row);
    return row;
  }

  async findById(id: string): Promise<GraphThreadRow | null> {
    const row = this.rows.get(id);
    return row ? withThreadDefaults(row) : null;
  }

  async findByCompany(
    companyId: string,
    opts?: { limit?: number; status?: string },
  ): Promise<GraphThreadRow[]> {
    let results = [...this.rows.values()]
      .map(withThreadDefaults)
      .filter((t) => t.company_id === companyId);
    if (opts?.status) results = results.filter((t) => t.status === opts.status);
    results.sort((a, b) => b.created_at.localeCompare(a.created_at));
    if (opts?.limit) results = results.slice(0, opts.limit);
    return results;
  }

  async findByCompanyAndStatus(companyId: string, status: string): Promise<GraphThreadRow[]> {
    return [...this.rows.values()]
      .map(withThreadDefaults)
      .filter((t) => t.company_id === companyId && t.status === status)
      .sort((a, b) => b.created_at.localeCompare(a.created_at));
  }

  async updateStatus(id: string, status: string): Promise<void> {
    const row = this.rows.get(id);
    if (row) {
      this.rows.set(id, { ...row, status, updated_at: now() });
    }
  }

  async updateInteractionMode(
    id: string,
    interactionMode: GraphThreadRow['interaction_mode'],
  ): Promise<void> {
    const row = this.rows.get(id);
    if (row) {
      this.rows.set(id, { ...row, interaction_mode: interactionMode, updated_at: now() });
    }
  }

  async updateSynopsis(id: string, synopsisJson: string | null): Promise<void> {
    const row = this.rows.get(id);
    if (row) {
      this.rows.set(id, { ...row, synopsis_json: synopsisJson, updated_at: now() });
    }
  }

  async updateCompactBaseline(id: string, compactBaselineJson: string | null): Promise<void> {
    const row = this.rows.get(id);
    if (row) {
      this.rows.set(id, {
        ...row,
        compact_baseline_json: compactBaselineJson,
        updated_at: now(),
      });
    }
  }

  async updateProject(id: string, projectId: string | null): Promise<void> {
    const row = this.rows.get(id);
    if (row) {
      this.rows.set(id, { ...row, project_id: projectId, updated_at: now() });
    }
  }

  snapshot(): GraphThreadRow[] {
    return cloneRows(this.rows.values());
  }
}

export class MemoryTaskRunRepository implements TaskRunRepository {
  private readonly rows = new Map<string, TaskRunRow>();

  constructor(
    initial?: Iterable<TaskRunRow>,
    private readonly threads?: ThreadRepository,
  ) {
    if (initial) {
      for (const row of initial) this.rows.set(row.task_run_id, { ...row });
    }
  }

  async create(t: NewTaskRun): Promise<TaskRunRow> {
    const row: TaskRunRow = { ...t, finished_at: null };
    this.rows.set(row.task_run_id, row);
    return row;
  }

  async findById(id: string): Promise<TaskRunRow | null> {
    return this.rows.get(id) ?? null;
  }

  async findByThread(threadId: string): Promise<TaskRunRow[]> {
    return [...this.rows.values()].filter((r) => r.thread_id === threadId);
  }

  async updateStatus(id: string, status: string, outputJson?: string | null): Promise<void> {
    const row = this.rows.get(id);
    if (row) {
      this.rows.set(id, {
        ...row,
        status,
        output_json: outputJson ?? row.output_json,
        finished_at: ['completed', 'failed', 'cancelled'].includes(status)
          ? now()
          : row.finished_at,
      });
    }
  }

  async findQueue(
    companyId: string,
    opts?: { statuses?: string[]; limit?: number },
  ): Promise<TaskRunRow[]> {
    const threadRows = (await this.threads?.findByCompany(companyId)) ?? [];
    const companyThreadIds = new Set(threadRows.map((t) => t.thread_id));
    let results = [...this.rows.values()].filter((r) => companyThreadIds.has(r.thread_id));
    if (opts?.statuses) {
      const statuses = new Set(opts.statuses);
      results = results.filter((r) => statuses.has(r.status));
    }
    results.sort((a, b) => b.started_at.localeCompare(a.started_at));
    if (opts?.limit) results = results.slice(0, opts.limit);
    return results;
  }

  async countByStatus(companyId: string): Promise<Record<string, number>> {
    const threadRows = (await this.threads?.findByCompany(companyId)) ?? [];
    const companyThreadIds = new Set(threadRows.map((t) => t.thread_id));
    const counts: Record<string, number> = {};
    for (const r of this.rows.values()) {
      if (companyThreadIds.has(r.thread_id)) {
        counts[r.status] = (counts[r.status] ?? 0) + 1;
      }
    }
    return counts;
  }

  snapshot(): TaskRunRow[] {
    return cloneRows(this.rows.values());
  }
}

export class MemoryCheckpointRepository implements CheckpointRepository {
  private readonly rows = new Map<string, GraphCheckpointRow>();

  constructor(initial?: Iterable<GraphCheckpointRow>) {
    if (initial) {
      for (const row of initial) this.rows.set(row.checkpoint_id, { ...row });
    }
  }

  async save(c: NewGraphCheckpoint): Promise<void> {
    const row: GraphCheckpointRow = { ...c };
    this.rows.set(row.checkpoint_id, row);
  }

  async findLatest(threadId: string): Promise<GraphCheckpointRow | null> {
    const matching = [...this.rows.values()]
      .filter((c) => c.thread_id === threadId)
      .sort((a, b) => b.checkpoint_seq - a.checkpoint_seq);
    return matching[0] ?? null;
  }

  async findBySeq(threadId: string, seq: number): Promise<GraphCheckpointRow | null> {
    return (
      [...this.rows.values()].find((c) => c.thread_id === threadId && c.checkpoint_seq === seq) ??
      null
    );
  }

  snapshot(): GraphCheckpointRow[] {
    return cloneRows(this.rows.values());
  }
}

export class MemoryEventRepository implements EventRepository {
  private readonly store: NewRuntimeEvent[] = [];

  constructor(initial?: Iterable<NewRuntimeEvent>) {
    if (initial) {
      for (const row of initial) this.store.push({ ...row });
    }
  }

  async insert(e: NewRuntimeEvent): Promise<void> {
    this.store.push(e);
  }

  async findByThread(threadId: string): Promise<RuntimeEventRow[]> {
    return this.store.filter((event) => event.thread_id === threadId) as RuntimeEventRow[];
  }

  snapshot(): NewRuntimeEvent[] {
    return cloneRows(this.store);
  }
}

export interface OrchestrationMemoryRepos {
  companies: MemoryCompanyRepository;
  threads: MemoryThreadRepository;
  taskRuns: MemoryTaskRunRepository;
  checkpoints: MemoryCheckpointRepository;
  events: MemoryEventRepository;
}

export function createOrchestrationMemoryRepos(
  snapshot?: Partial<MemoryRepositoriesSnapshot>,
): OrchestrationMemoryRepos {
  const companies = new MemoryCompanyRepository(snapshot?.companies);
  const threads = new MemoryThreadRepository(snapshot?.threads);
  const taskRuns = new MemoryTaskRunRepository(snapshot?.taskRuns, threads);
  const checkpoints = new MemoryCheckpointRepository(snapshot?.checkpoints);
  const events = new MemoryEventRepository(snapshot?.events);
  return { companies, threads, taskRuns, checkpoints, events };
}
