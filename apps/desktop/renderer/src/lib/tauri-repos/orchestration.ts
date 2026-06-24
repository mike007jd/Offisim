import type {
  CompanyRepository,
  CompanyRow,
  EventRepository,
  GraphThreadRow,
  NewGraphThread,
  NewRuntimeEvent,
  NewTaskRun,
  RuntimeEventRow,
  TaskRunRepository,
  TaskRunRow,
  ThreadRepository,
} from '@offisim/core';
import * as schema from '@offisim/db-local';
import { and, desc, eq, inArray, sql } from 'drizzle-orm';
import type { TauriDrizzleDb } from '../tauri-drizzle';

function now(): string {
  return new Date().toISOString();
}

export interface OrchestrationTauriRepos {
  companies: CompanyRepository;
  threads: ThreadRepository;
  taskRuns: TaskRunRepository;
  events: EventRepository;
}

export function createOrchestrationTauriRepos(db: TauriDrizzleDb): OrchestrationTauriRepos {
  const companies: CompanyRepository = {
    async findById(id) {
      const rows = await db
        .select()
        .from(schema.companies)
        .where(eq(schema.companies.company_id, id));
      return (rows[0] as CompanyRow | undefined) ?? null;
    },
    async findAll() {
      const rows = await db.select().from(schema.companies);
      return rows as CompanyRow[];
    },
    async create(company: CompanyRow) {
      await db.insert(schema.companies).values(company);
      return company;
    },
    async update(
      companyId: string,
      fields: Partial<Pick<CompanyRow, 'name' | 'status' | 'template_id' | 'template_label'>>,
    ) {
      await db
        .update(schema.companies)
        .set({ ...fields, updated_at: now() })
        .where(eq(schema.companies.company_id, companyId));
    },
    async delete(companyId) {
      await db.delete(schema.companies).where(eq(schema.companies.company_id, companyId));
    },
  };

  const threads: ThreadRepository = {
    async create(t: NewGraphThread) {
      const row = {
        ...t,
        interaction_mode: t.interaction_mode ?? 'boss_proxy',
        synopsis_json: t.synopsis_json ?? null,
        compact_baseline_json: t.compact_baseline_json ?? null,
        created_at: now(),
        updated_at: now(),
      };
      await db.insert(schema.graphThreads).values(row);
      return row as GraphThreadRow;
    },
    async findById(id) {
      const rows = await db
        .select()
        .from(schema.graphThreads)
        .where(eq(schema.graphThreads.thread_id, id));
      return (rows[0] as GraphThreadRow | undefined) ?? null;
    },
    async findByCompany(companyId, opts) {
      let query = db
        .select()
        .from(schema.graphThreads)
        .where(
          opts?.status
            ? and(
                eq(schema.graphThreads.company_id, companyId),
                eq(schema.graphThreads.status, opts.status),
              )
            : eq(schema.graphThreads.company_id, companyId),
        )
        .orderBy(desc(schema.graphThreads.created_at));

      if (opts?.limit) {
        query = query.limit(opts.limit) as typeof query;
      }

      return (await query) as GraphThreadRow[];
    },
    async updateStatus(id, status) {
      await db
        .update(schema.graphThreads)
        .set({ status, updated_at: now() })
        .where(eq(schema.graphThreads.thread_id, id));
    },
    async updateInteractionMode(id, interactionMode) {
      await db
        .update(schema.graphThreads)
        .set({ interaction_mode: interactionMode, updated_at: now() })
        .where(eq(schema.graphThreads.thread_id, id));
    },
    async updateSynopsis(id, synopsisJson) {
      await db
        .update(schema.graphThreads)
        .set({ synopsis_json: synopsisJson, updated_at: now() })
        .where(eq(schema.graphThreads.thread_id, id));
    },
    async updateCompactBaseline(id, compactBaselineJson) {
      await db
        .update(schema.graphThreads)
        .set({ compact_baseline_json: compactBaselineJson, updated_at: now() })
        .where(eq(schema.graphThreads.thread_id, id));
    },
    async findByCompanyAndStatus(companyId, status) {
      return (await db
        .select()
        .from(schema.graphThreads)
        .where(
          and(
            eq(schema.graphThreads.company_id, companyId),
            eq(schema.graphThreads.status, status),
          ),
        )
        .orderBy(desc(schema.graphThreads.created_at))) as GraphThreadRow[];
    },
  };

  const taskRuns: TaskRunRepository = {
    async create(t: NewTaskRun) {
      const row = { ...t, finished_at: null };
      await db.insert(schema.taskRuns).values(row);
      return row as TaskRunRow;
    },
    async findById(id) {
      const rows = await db
        .select()
        .from(schema.taskRuns)
        .where(eq(schema.taskRuns.task_run_id, id));
      return (rows[0] as TaskRunRow | undefined) ?? null;
    },
    async findByThread(threadId: string) {
      return (await db
        .select()
        .from(schema.taskRuns)
        .where(eq(schema.taskRuns.thread_id, threadId))) as TaskRunRow[];
    },
    async updateStatus(id, status, outputJson) {
      const finished = ['completed', 'failed', 'cancelled'].includes(status) ? now() : null;
      await db
        .update(schema.taskRuns)
        .set({ status, output_json: outputJson ?? undefined, finished_at: finished ?? undefined })
        .where(eq(schema.taskRuns.task_run_id, id));
    },
    async findQueue(companyId, opts) {
      // Single inner-join replaces the prior two-step "select threads → inArray
      // on task_runs" pattern (A/HIGH N+1 on multi-thread companies).
      const conditions = [eq(schema.graphThreads.company_id, companyId)];
      if (opts?.statuses && opts.statuses.length > 0) {
        conditions.push(inArray(schema.taskRuns.status, opts.statuses));
      }

      let query = db
        .select({ taskRun: schema.taskRuns })
        .from(schema.taskRuns)
        .innerJoin(
          schema.graphThreads,
          eq(schema.taskRuns.thread_id, schema.graphThreads.thread_id),
        )
        .where(and(...conditions))
        .orderBy(desc(schema.taskRuns.started_at));

      if (opts?.limit) {
        query = query.limit(opts.limit) as typeof query;
      }

      return (await query).map((row) => row.taskRun) as TaskRunRow[];
    },
    async countByStatus(companyId) {
      const rows = await db
        .select({
          status: schema.taskRuns.status,
          cnt: sql<number>`COUNT(*)`,
        })
        .from(schema.taskRuns)
        .innerJoin(
          schema.graphThreads,
          eq(schema.taskRuns.thread_id, schema.graphThreads.thread_id),
        )
        .where(eq(schema.graphThreads.company_id, companyId))
        .groupBy(schema.taskRuns.status);

      const counts: Record<string, number> = {};
      for (const r of rows) {
        counts[r.status] = Number(r.cnt);
      }
      return counts;
    },
  };

  const events: EventRepository = {
    async insert(e: NewRuntimeEvent) {
      await db.insert(schema.runtimeEvents).values(e);
    },
    async findByThread(threadId) {
      return (await db
        .select()
        .from(schema.runtimeEvents)
        .where(eq(schema.runtimeEvents.thread_id, threadId))
        .orderBy(schema.runtimeEvents.created_at)) as RuntimeEventRow[];
    },
  };

  return { companies, threads, taskRuns, events };
}
