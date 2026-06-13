import * as schema from '@offisim/db-local/dist/schema.js';
import { and, desc, eq, inArray, sql } from 'drizzle-orm';
import type { BetterSQLite3Database } from 'drizzle-orm/better-sqlite3';
import type {
  CompanyRepository,
  EventRepository,
  GraphThreadRow,
  NewGraphThread,
  NewRuntimeEvent,
  NewTaskRun,
  RuntimeEventRow,
  TaskRunRepository,
  TaskRunRow,
  ThreadRepository,
} from '../../repositories.js';

type Db = BetterSQLite3Database<typeof schema>;

function now(): string {
  return new Date().toISOString();
}

export interface OrchestrationDrizzleRepos {
  companies: CompanyRepository;
  threads: ThreadRepository;
  taskRuns: TaskRunRepository;
  events: EventRepository;
}

export function createOrchestrationDrizzleRepos(db: Db): OrchestrationDrizzleRepos {
  const companies: CompanyRepository = {
    async findById(id) {
      const rows = db
        .select()
        .from(schema.companies)
        .where(eq(schema.companies.company_id, id))
        .all();
      return (
        (rows[0] as unknown as ReturnType<CompanyRepository['findById']> extends Promise<infer T>
          ? T
          : never) ?? null
      );
    },
    async findAll() {
      return db.select().from(schema.companies).all() as Awaited<
        ReturnType<CompanyRepository['findAll']>
      >;
    },
    async create(company) {
      db.insert(schema.companies).values(company).run();
      return company;
    },
    async update(companyId, fields) {
      db.update(schema.companies)
        .set({ ...fields, updated_at: now() })
        .where(eq(schema.companies.company_id, companyId))
        .run();
    },
    async delete(companyId) {
      db.delete(schema.companies).where(eq(schema.companies.company_id, companyId)).run();
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
      db.insert(schema.graphThreads).values(row).run();
      return row as GraphThreadRow;
    },
    async findById(id) {
      const rows = db
        .select()
        .from(schema.graphThreads)
        .where(eq(schema.graphThreads.thread_id, id))
        .all();
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
        .orderBy(desc(schema.graphThreads.created_at))
        .$dynamic();

      if (typeof opts?.limit === 'number') {
        query = query.limit(opts.limit);
      }

      return query.all() as GraphThreadRow[];
    },
    async findByCompanyAndStatus(companyId, status) {
      return db
        .select()
        .from(schema.graphThreads)
        .where(
          and(
            eq(schema.graphThreads.company_id, companyId),
            eq(schema.graphThreads.status, status),
          ),
        )
        .orderBy(desc(schema.graphThreads.created_at))
        .all() as GraphThreadRow[];
    },
    async updateStatus(id, status) {
      db.update(schema.graphThreads)
        .set({ status, updated_at: now() })
        .where(eq(schema.graphThreads.thread_id, id))
        .run();
    },
    async updateInteractionMode(id, interactionMode) {
      db.update(schema.graphThreads)
        .set({ interaction_mode: interactionMode, updated_at: now() })
        .where(eq(schema.graphThreads.thread_id, id))
        .run();
    },
    async updateSynopsis(id, synopsisJson) {
      db.update(schema.graphThreads)
        .set({ synopsis_json: synopsisJson, updated_at: now() })
        .where(eq(schema.graphThreads.thread_id, id))
        .run();
    },
    async updateCompactBaseline(id, compactBaselineJson) {
      db.update(schema.graphThreads)
        .set({ compact_baseline_json: compactBaselineJson, updated_at: now() })
        .where(eq(schema.graphThreads.thread_id, id))
        .run();
    },
    async updateProject(id, projectId) {
      db.update(schema.graphThreads)
        .set({ project_id: projectId, updated_at: now() })
        .where(eq(schema.graphThreads.thread_id, id))
        .run();
    },
  };

  const taskRuns: TaskRunRepository = {
    async create(t: NewTaskRun) {
      const row = { ...t, finished_at: null };
      db.insert(schema.taskRuns).values(row).run();
      return row as TaskRunRow;
    },
    async findById(id) {
      const rows = db
        .select()
        .from(schema.taskRuns)
        .where(eq(schema.taskRuns.task_run_id, id))
        .all();
      return (rows[0] as TaskRunRow | undefined) ?? null;
    },
    async findByThread(threadId) {
      return db
        .select()
        .from(schema.taskRuns)
        .where(eq(schema.taskRuns.thread_id, threadId))
        .all() as TaskRunRow[];
    },
    async updateStatus(id, status, outputJson) {
      const finished = ['completed', 'failed', 'cancelled'].includes(status) ? now() : null;
      db.update(schema.taskRuns)
        .set({ status, output_json: outputJson ?? undefined, finished_at: finished ?? undefined })
        .where(eq(schema.taskRuns.task_run_id, id))
        .run();
    },
    async findQueue(companyId, opts) {
      // Single inner-join over (task_runs ⨝ graph_threads) replaces the prior
      // two-step "select threads → inArray on task_runs" pattern, which became
      // an N+1 once a company accumulated many threads.
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
        .orderBy(desc(schema.taskRuns.started_at))
        .$dynamic();

      if (typeof opts?.limit === 'number') {
        query = query.limit(opts.limit);
      }

      return query.all().map((row) => row.taskRun) as TaskRunRow[];
    },
    async countByStatus(companyId) {
      const rows = db
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
        .groupBy(schema.taskRuns.status)
        .all();

      const counts: Record<string, number> = {};
      for (const r of rows) {
        counts[r.status] = r.cnt;
      }
      return counts;
    },
  };

  const events: EventRepository = {
    async insert(e: NewRuntimeEvent) {
      db.insert(schema.runtimeEvents).values(e).run();
    },
    async findByThread(threadId) {
      return db
        .select()
        .from(schema.runtimeEvents)
        .where(eq(schema.runtimeEvents.thread_id, threadId))
        .orderBy(schema.runtimeEvents.created_at)
        .all() as RuntimeEventRow[];
    },
  };

  return { companies, threads, taskRuns, events };
}
