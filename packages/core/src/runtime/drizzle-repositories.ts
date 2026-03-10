import * as schema from '@aics/db-local';
import type {
  AssetBindingRow,
  InstallTransactionRow,
  InstalledAssetRow,
  InstalledPackageRow,
  NewEmployee,
} from '@aics/install-core';
import type { BindingStatus, InstallState } from '@aics/shared-types';
import { and, desc, eq } from 'drizzle-orm';
import type { BetterSQLite3Database } from 'drizzle-orm/better-sqlite3';
import type { AssetBindingRepository } from '../repos/asset-binding-repository.js';
import type { InstallTransactionRepository } from '../repos/install-transaction-repository.js';
import type { InstalledAssetRepository } from '../repos/installed-asset-repository.js';
import type { InstalledPackageRepository } from '../repos/installed-package-repository.js';
import type {
  CheckpointRepository,
  CompanyRepository,
  EmployeeRepository,
  EmployeeRow,
  EventRepository,
  GraphCheckpointRow,
  GraphThreadRow,
  HandoffEventRow,
  HandoffRepository,
  LlmCallRepository,
  LlmCallRow,
  MeetingRepository,
  MeetingSessionRow,
  NewGraphCheckpoint,
  NewGraphThread,
  NewHandoffEvent,
  NewLlmCall,
  NewMeetingSession,
  NewRuntimeEvent,
  NewTaskRun,
  NewToolCall,
  RuntimeRepositories,
  TaskRunRepository,
  TaskRunRow,
  ThreadRepository,
  ToolCallRepository,
  ToolCallRow,
} from './repositories.js';

type Db = BetterSQLite3Database<typeof schema>;

function now(): string {
  return new Date().toISOString();
}

export function createDrizzleRepositories(db: Db): RuntimeRepositories {
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
  };

  const threads: ThreadRepository = {
    async create(t: NewGraphThread) {
      const row = { ...t, created_at: now(), updated_at: now() };
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
        .orderBy(desc(schema.graphThreads.created_at));

      if (opts?.limit) {
        query = query.limit(opts.limit) as typeof query;
      }

      return query.all() as GraphThreadRow[];
    },
    async updateStatus(id, status) {
      db.update(schema.graphThreads)
        .set({ status, updated_at: now() })
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
  };

  const employees: EmployeeRepository = {
    async create(emp: NewEmployee) {
      const employee_id = crypto.randomUUID();
      const ts = now();
      db.insert(schema.employees)
        .values({
          employee_id,
          ...emp,
          created_at: ts,
          updated_at: ts,
        })
        .run();
      return { employee_id };
    },
    async findById(id) {
      const rows = db
        .select()
        .from(schema.employees)
        .where(eq(schema.employees.employee_id, id))
        .all();
      return (
        (rows[0] as unknown as ReturnType<EmployeeRepository['findById']> extends Promise<infer T>
          ? T
          : never) ?? null
      );
    },
    async findByCompany(companyId) {
      return db
        .select()
        .from(schema.employees)
        .where(eq(schema.employees.company_id, companyId))
        .all() as EmployeeRow[];
    },
    async findByRole(companyId, roleSlug) {
      return db
        .select()
        .from(schema.employees)
        .where(
          and(eq(schema.employees.company_id, companyId), eq(schema.employees.role_slug, roleSlug)),
        )
        .all() as EmployeeRow[];
    },
    async delete(employeeId) {
      db.delete(schema.employees).where(eq(schema.employees.employee_id, employeeId)).run();
    },
  };

  const toolCalls: ToolCallRepository = {
    async create(t: NewToolCall) {
      const row = { ...t, finished_at: null };
      db.insert(schema.toolCalls).values(row).run();
      return row as ToolCallRow;
    },
    async updateResult(id, status, responseJson) {
      db.update(schema.toolCalls)
        .set({ status, response_json: responseJson, finished_at: now() })
        .where(eq(schema.toolCalls.tool_call_id, id))
        .run();
    },
  };

  const handoffs: HandoffRepository = {
    async create(h: NewHandoffEvent) {
      db.insert(schema.handoffEvents).values(h).run();
      return h as HandoffEventRow;
    },
    async findByThread(threadId) {
      return db
        .select()
        .from(schema.handoffEvents)
        .where(eq(schema.handoffEvents.thread_id, threadId))
        .all() as HandoffEventRow[];
    },
  };

  const meetings: MeetingRepository = {
    async create(m: NewMeetingSession) {
      db.insert(schema.meetingSessions).values(m).run();
      return m as MeetingSessionRow;
    },
    async findById(id) {
      const rows = db
        .select()
        .from(schema.meetingSessions)
        .where(eq(schema.meetingSessions.meeting_id, id))
        .all();
      return (rows[0] as MeetingSessionRow | undefined) ?? null;
    },
    async updateStatus(id, status, summaryJson) {
      db.update(schema.meetingSessions)
        .set({ status, summary_json: summaryJson ?? undefined, updated_at: now() })
        .where(eq(schema.meetingSessions.meeting_id, id))
        .run();
    },
  };

  const checkpoints: CheckpointRepository = {
    async save(c: NewGraphCheckpoint) {
      db.insert(schema.graphCheckpoints).values(c).run();
    },
    async findLatest(threadId) {
      const rows = db
        .select()
        .from(schema.graphCheckpoints)
        .where(eq(schema.graphCheckpoints.thread_id, threadId))
        .orderBy(desc(schema.graphCheckpoints.checkpoint_seq))
        .limit(1)
        .all();
      return (rows[0] as GraphCheckpointRow | undefined) ?? null;
    },
    async findBySeq(threadId, seq) {
      const rows = db
        .select()
        .from(schema.graphCheckpoints)
        .where(
          and(
            eq(schema.graphCheckpoints.thread_id, threadId),
            eq(schema.graphCheckpoints.checkpoint_seq, seq),
          ),
        )
        .all();
      return (rows[0] as GraphCheckpointRow | undefined) ?? null;
    },
  };

  const events: EventRepository = {
    async insert(e: NewRuntimeEvent) {
      db.insert(schema.runtimeEvents).values(e).run();
    },
  };

  const llmCalls: LlmCallRepository = {
    async create(c: NewLlmCall) {
      db.insert(schema.llmCalls).values(c).run();
      return c as LlmCallRow;
    },
    async findByThread(threadId) {
      return db
        .select()
        .from(schema.llmCalls)
        .where(eq(schema.llmCalls.thread_id, threadId))
        .all() as LlmCallRow[];
    },
    async findByTaskRun(taskRunId) {
      return db
        .select()
        .from(schema.llmCalls)
        .where(eq(schema.llmCalls.task_run_id, taskRunId))
        .all() as LlmCallRow[];
    },
  };

  const installTransactions: InstallTransactionRepository = {
    async create(txn) {
      const row: InstallTransactionRow = { ...txn, finished_at: null };
      db.insert(schema.installTransactions).values(row).run();
      return row;
    },
    async findById(id) {
      const rows = db
        .select()
        .from(schema.installTransactions)
        .where(eq(schema.installTransactions.install_txn_id, id))
        .all();
      return (rows[0] as InstallTransactionRow | undefined) ?? null;
    },
    async updateState(id, state: InstallState, errorCode?: string, errorDetail?: string) {
      db.update(schema.installTransactions)
        .set({
          state,
          error_code: errorCode ?? undefined,
          error_detail: errorDetail ?? undefined,
        })
        .where(eq(schema.installTransactions.install_txn_id, id))
        .run();
    },
    async finish(id, state: InstallState) {
      db.update(schema.installTransactions)
        .set({ state, finished_at: now() })
        .where(eq(schema.installTransactions.install_txn_id, id))
        .run();
    },
  };

  const installedPackages: InstalledPackageRepository = {
    async create(pkg) {
      db.insert(schema.installedPackages).values(pkg).run();
      return pkg as InstalledPackageRow;
    },
    async findByPackageId(companyId, packageId) {
      return db
        .select()
        .from(schema.installedPackages)
        .where(
          and(
            eq(schema.installedPackages.company_id, companyId),
            eq(schema.installedPackages.package_id, packageId),
          ),
        )
        .all() as InstalledPackageRow[];
    },
  };

  const installedAssets: InstalledAssetRepository = {
    async create(asset) {
      db.insert(schema.installedAssets).values(asset).run();
      return asset as InstalledAssetRow;
    },
  };

  const assetBindings: AssetBindingRepository = {
    async create(binding) {
      db.insert(schema.assetBindings).values(binding).run();
      return binding as AssetBindingRow;
    },
    async findByTransaction(txnId) {
      return db
        .select()
        .from(schema.assetBindings)
        .where(eq(schema.assetBindings.install_txn_id, txnId))
        .all() as AssetBindingRow[];
    },
    async updateStatus(id, status: BindingStatus, valueJson?: string) {
      db.update(schema.assetBindings)
        .set({
          status,
          binding_value_json: valueJson ?? undefined,
          updated_at: now(),
        })
        .where(eq(schema.assetBindings.binding_id, id))
        .run();
    },
  };

  return {
    companies,
    threads,
    taskRuns,
    employees,
    toolCalls,
    handoffs,
    meetings,
    checkpoints,
    events,
    llmCalls,
    installTransactions,
    installedPackages,
    installedAssets,
    assetBindings,
  };
}
