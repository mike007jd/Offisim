// SYNC: This file mirrors packages/core/src/runtime/drizzle-repositories.ts
// but uses `await` on all Drizzle calls (sqlite-proxy returns Promises).
// If you change repository logic in core, update this file too.

import type {
  AssetBindingRepository,
  CheckpointRepository,
  CompanyRepository,
  CompanyRow,
  EmployeeRepository,
  EmployeeRow,
  EventRepository,
  GraphCheckpointRow,
  GraphThreadRow,
  HandoffEventRow,
  HandoffRepository,
  InstallTransactionRepository,
  InstalledAssetRepository,
  InstalledPackageRepository,
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
} from '@aics/core';
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
import type { TauriDrizzleDb } from './tauri-drizzle';

function now(): string {
  return new Date().toISOString();
}

/**
 * Create RuntimeRepositories backed by Drizzle sqlite-proxy (async).
 *
 * This mirrors packages/core/src/runtime/drizzle-repositories.ts
 * but uses `await` on all Drizzle calls (sqlite-proxy returns Promises).
 */
export function createTauriRepositories(db: TauriDrizzleDb): RuntimeRepositories {
  const companies: CompanyRepository = {
    async findById(id) {
      const rows = await db
        .select()
        .from(schema.companies)
        .where(eq(schema.companies.company_id, id));
      return (rows[0] as CompanyRow | undefined) ?? null;
    },
  };

  const threads: ThreadRepository = {
    async create(t: NewGraphThread) {
      const row = { ...t, created_at: now(), updated_at: now() };
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
    async findByThread(threadId) {
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
  };

  const employees: EmployeeRepository = {
    async create(emp: NewEmployee) {
      const employee_id = crypto.randomUUID();
      const ts = now();
      const row = {
        employee_id,
        company_id: emp.company_id,
        source_asset_id: emp.source_asset_id,
        source_package_id: emp.source_package_id,
        name: emp.name,
        role_slug: emp.role_slug,
        workstation_id: null,
        persona_json: emp.persona_json ?? null,
        config_json: emp.config_json ?? null,
        enabled: 1,
        created_at: ts,
        updated_at: ts,
      };
      await db.insert(schema.employees).values(row);
      return { employee_id };
    },
    async findById(id) {
      const rows = await db
        .select()
        .from(schema.employees)
        .where(eq(schema.employees.employee_id, id));
      return (rows[0] as EmployeeRow | undefined) ?? null;
    },
    async findByCompany(companyId) {
      return (await db
        .select()
        .from(schema.employees)
        .where(eq(schema.employees.company_id, companyId))) as EmployeeRow[];
    },
    async findByRole(companyId, roleSlug) {
      return (await db
        .select()
        .from(schema.employees)
        .where(
          and(eq(schema.employees.company_id, companyId), eq(schema.employees.role_slug, roleSlug)),
        )) as EmployeeRow[];
    },
    async delete(employeeId) {
      await db.delete(schema.employees).where(eq(schema.employees.employee_id, employeeId));
    },
  };

  const toolCalls: ToolCallRepository = {
    async create(t: NewToolCall) {
      const row = { ...t, finished_at: null };
      await db.insert(schema.toolCalls).values(row);
      return row as ToolCallRow;
    },
    async updateResult(id, status, responseJson) {
      await db
        .update(schema.toolCalls)
        .set({ status, response_json: responseJson, finished_at: now() })
        .where(eq(schema.toolCalls.tool_call_id, id));
    },
  };

  const handoffs: HandoffRepository = {
    async create(h: NewHandoffEvent) {
      await db.insert(schema.handoffEvents).values(h);
      return h as HandoffEventRow;
    },
    async findByThread(threadId) {
      return (await db
        .select()
        .from(schema.handoffEvents)
        .where(eq(schema.handoffEvents.thread_id, threadId))) as HandoffEventRow[];
    },
  };

  const meetings: MeetingRepository = {
    async create(m: NewMeetingSession) {
      await db.insert(schema.meetingSessions).values(m);
      return m as MeetingSessionRow;
    },
    async findById(id) {
      const rows = await db
        .select()
        .from(schema.meetingSessions)
        .where(eq(schema.meetingSessions.meeting_id, id));
      return (rows[0] as MeetingSessionRow | undefined) ?? null;
    },
    async updateStatus(id, status, summaryJson) {
      await db
        .update(schema.meetingSessions)
        .set({ status, summary_json: summaryJson ?? undefined, updated_at: now() })
        .where(eq(schema.meetingSessions.meeting_id, id));
    },
  };

  const checkpoints: CheckpointRepository = {
    async save(c: NewGraphCheckpoint) {
      await db.insert(schema.graphCheckpoints).values(c);
    },
    async findLatest(threadId) {
      const rows = await db
        .select()
        .from(schema.graphCheckpoints)
        .where(eq(schema.graphCheckpoints.thread_id, threadId))
        .orderBy(desc(schema.graphCheckpoints.checkpoint_seq))
        .limit(1);
      return (rows[0] as GraphCheckpointRow | undefined) ?? null;
    },
    async findBySeq(threadId, seq) {
      const rows = await db
        .select()
        .from(schema.graphCheckpoints)
        .where(
          and(
            eq(schema.graphCheckpoints.thread_id, threadId),
            eq(schema.graphCheckpoints.checkpoint_seq, seq),
          ),
        );
      return (rows[0] as GraphCheckpointRow | undefined) ?? null;
    },
  };

  const events: EventRepository = {
    async insert(e: NewRuntimeEvent) {
      await db.insert(schema.runtimeEvents).values(e);
    },
  };

  const llmCalls: LlmCallRepository = {
    async create(c: NewLlmCall) {
      await db.insert(schema.llmCalls).values(c);
      return c as LlmCallRow;
    },
    async findByThread(threadId) {
      return (await db
        .select()
        .from(schema.llmCalls)
        .where(eq(schema.llmCalls.thread_id, threadId))) as LlmCallRow[];
    },
    async findByTaskRun(taskRunId) {
      return (await db
        .select()
        .from(schema.llmCalls)
        .where(eq(schema.llmCalls.task_run_id, taskRunId))) as LlmCallRow[];
    },
  };

  // Install repos — Drizzle-backed (persistent SQLite via tauri-plugin-sql)
  const installTransactions: InstallTransactionRepository = {
    async create(txn) {
      const row: InstallTransactionRow = { ...txn, finished_at: null };
      await db.insert(schema.installTransactions).values(row);
      return row;
    },
    async findById(id) {
      const rows = await db
        .select()
        .from(schema.installTransactions)
        .where(eq(schema.installTransactions.install_txn_id, id));
      return (rows[0] as InstallTransactionRow | undefined) ?? null;
    },
    async updateState(id, state: InstallState, errorCode?: string, errorDetail?: string) {
      await db
        .update(schema.installTransactions)
        .set({
          state,
          error_code: errorCode ?? undefined,
          error_detail: errorDetail ?? undefined,
        })
        .where(eq(schema.installTransactions.install_txn_id, id));
    },
    async finish(id, state: InstallState) {
      await db
        .update(schema.installTransactions)
        .set({ state, finished_at: now() })
        .where(eq(schema.installTransactions.install_txn_id, id));
    },
  };

  const installedPackages: InstalledPackageRepository = {
    async create(pkg) {
      await db.insert(schema.installedPackages).values(pkg);
      return pkg as InstalledPackageRow;
    },
    async findByPackageId(companyId, packageId) {
      return (await db
        .select()
        .from(schema.installedPackages)
        .where(
          and(
            eq(schema.installedPackages.company_id, companyId),
            eq(schema.installedPackages.package_id, packageId),
          ),
        )) as InstalledPackageRow[];
    },
    async delete(id) {
      await db
        .delete(schema.installedPackages)
        .where(eq(schema.installedPackages.installed_package_id, id));
    },
  };

  const installedAssets: InstalledAssetRepository = {
    async create(asset) {
      await db.insert(schema.installedAssets).values(asset);
      return asset as InstalledAssetRow;
    },
    async delete(id) {
      await db
        .delete(schema.installedAssets)
        .where(eq(schema.installedAssets.installed_asset_id, id));
    },
  };

  const assetBindings: AssetBindingRepository = {
    async create(binding) {
      await db.insert(schema.assetBindings).values(binding);
      return binding as AssetBindingRow;
    },
    async findByTransaction(txnId) {
      return (await db
        .select()
        .from(schema.assetBindings)
        .where(eq(schema.assetBindings.install_txn_id, txnId))) as AssetBindingRow[];
    },
    async updateStatus(id, status: BindingStatus, valueJson?: string) {
      await db
        .update(schema.assetBindings)
        .set({
          status,
          binding_value_json: valueJson ?? undefined,
          updated_at: now(),
        })
        .where(eq(schema.assetBindings.binding_id, id));
    },
    async delete(id) {
      await db.delete(schema.assetBindings).where(eq(schema.assetBindings.binding_id, id));
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
