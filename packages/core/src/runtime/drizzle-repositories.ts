import * as schema from '@aics/db-local';
import type {
  AssetBindingRow,
  InstallTransactionRow,
  InstalledAssetRow,
  InstalledPackageRow,
  NewEmployee,
} from '@aics/install-core';
import type { BindingStatus, InstallState } from '@aics/shared-types';
import { and, desc, eq, sql } from 'drizzle-orm';
import type { BetterSQLite3Database } from 'drizzle-orm/better-sqlite3';
import type { AssetBindingRepository } from '../repos/asset-binding-repository.js';
import type { InstallTransactionRepository } from '../repos/install-transaction-repository.js';
import type { InstalledAssetRepository } from '../repos/installed-asset-repository.js';
import type { InstalledPackageRepository } from '../repos/installed-package-repository.js';
import {
  MemoryEmployeeVersionRepository,
  MemoryModelCostRateRepository,
} from './memory-repositories.js';
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
  MemoryEntryCreate,
  MemoryEntryRow,
  MemoryRepository,
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
  McpAuditRepository,
  McpAuditRow,
  NewMcpAudit,
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
    // TODO(runtime-completion): Optimize with proper SQL JOIN instead of in-memory filter
    async findQueue(companyId, opts) {
      const threadRows = db
        .select()
        .from(schema.graphThreads)
        .where(eq(schema.graphThreads.company_id, companyId))
        .all();
      const threadIds = new Set(threadRows.map((t) => t.thread_id));
      let allRuns = db.select().from(schema.taskRuns).all() as TaskRunRow[];
      allRuns = allRuns.filter((r) => threadIds.has(r.thread_id));
      if (opts?.statuses) {
        const statuses = new Set(opts.statuses);
        allRuns = allRuns.filter((r) => statuses.has(r.status));
      }
      allRuns.sort((a, b) => b.started_at.localeCompare(a.started_at));
      if (opts?.limit) allRuns = allRuns.slice(0, opts.limit);
      return allRuns;
    },
    // TODO(runtime-completion): Optimize with SQL GROUP BY
    async countByStatus(companyId) {
      const threadRows = db
        .select()
        .from(schema.graphThreads)
        .where(eq(schema.graphThreads.company_id, companyId))
        .all();
      const threadIds = new Set(threadRows.map((t) => t.thread_id));
      const allRuns = db.select().from(schema.taskRuns).all() as TaskRunRow[];
      const counts: Record<string, number> = {};
      for (const r of allRuns) {
        if (threadIds.has(r.thread_id)) {
          counts[r.status] = (counts[r.status] ?? 0) + 1;
        }
      }
      return counts;
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
    async update(employeeId, patch) {
      db.update(schema.employees)
        .set({ ...patch, updated_at: now() })
        .where(eq(schema.employees.employee_id, employeeId))
        .run();
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
    async delete(id) {
      db.delete(schema.installedPackages)
        .where(eq(schema.installedPackages.installed_package_id, id))
        .run();
    },
  };

  const installedAssets: InstalledAssetRepository = {
    async create(asset) {
      db.insert(schema.installedAssets).values(asset).run();
      return asset as InstalledAssetRow;
    },
    async delete(id) {
      db.delete(schema.installedAssets)
        .where(eq(schema.installedAssets.installed_asset_id, id))
        .run();
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
    async delete(id) {
      db.delete(schema.assetBindings)
        .where(eq(schema.assetBindings.binding_id, id))
        .run();
    },
  };

  const memories: MemoryRepository = {
    async create(entry: MemoryEntryCreate) {
      const ts = now();
      const row: MemoryEntryRow = {
        memory_id: entry.memory_id,
        company_id: entry.company_id,
        scope: entry.scope,
        owner_id: entry.owner_id,
        category: entry.category,
        content: entry.content,
        importance: entry.importance,
        source_thread_id: entry.source_thread_id ?? null,
        source_task_run_id: entry.source_task_run_id ?? null,
        created_at: ts,
        accessed_at: ts,
        access_count: 0,
      };
      db.insert(schema.memoryEntries).values(row).run();
      return row;
    },
    async findById(memoryId) {
      const row = db
        .select()
        .from(schema.memoryEntries)
        .where(eq(schema.memoryEntries.memory_id, memoryId))
        .get();
      return (row as MemoryEntryRow | undefined) ?? null;
    },
    async search(query, opts) {
      const conditions = [eq(schema.memoryEntries.company_id, opts.companyId)];
      if (opts.scope) conditions.push(eq(schema.memoryEntries.scope, opts.scope));
      if (opts.ownerId) conditions.push(eq(schema.memoryEntries.owner_id, opts.ownerId));
      // Add SQL-level LIKE conditions for each significant word (3+ chars)
      const queryWords = query
        .toLowerCase()
        .split(/\s+/)
        .filter((w) => w.length >= 3);
      if (queryWords.length > 0) {
        // At least one word must match (OR across words via a single check)
        // Use a wider candidate set first, then JS-filter for precision
        // SQL LIKE '%word%' for the first word to narrow the candidate set
        conditions.push(sql`lower(${schema.memoryEntries.content}) LIKE ${'%' + queryWords[0] + '%'}`);
      }
      const limit = opts.limit ?? 10;
      // Fetch wider candidate set, then JS-filter + limit
      const rows = db
        .select()
        .from(schema.memoryEntries)
        .where(and(...conditions))
        .orderBy(desc(schema.memoryEntries.importance))
        .limit(limit * 5)
        .all();
      // Word-based filter in JS for multi-word precision
      const filtered = (rows as MemoryEntryRow[]).filter((r) => {
        const lower = r.content.toLowerCase();
        return queryWords.some((w) => lower.includes(w));
      });
      return filtered.slice(0, limit);
    },
    async delete(memoryId) {
      db.delete(schema.memoryEntries)
        .where(eq(schema.memoryEntries.memory_id, memoryId))
        .run();
    },
    async findByOwner(ownerId, opts) {
      const conditions = [eq(schema.memoryEntries.owner_id, ownerId)];
      if (opts?.category) conditions.push(eq(schema.memoryEntries.category, opts.category));
      const rows = db
        .select()
        .from(schema.memoryEntries)
        .where(and(...conditions))
        .orderBy(desc(schema.memoryEntries.importance))
        .limit(opts?.limit ?? 50)
        .all();
      return rows as MemoryEntryRow[];
    },
    async touchAccess(memoryId) {
      db.update(schema.memoryEntries)
        .set({
          accessed_at: now(),
          access_count: sql`${schema.memoryEntries.access_count} + 1`,
        })
        .where(eq(schema.memoryEntries.memory_id, memoryId))
        .run();
    },
  };

  const mcpAudit: McpAuditRepository = {
    async create(audit: NewMcpAudit) {
      db.insert(schema.mcpAuditLog).values(audit).run();
      return audit as McpAuditRow;
    },
    async listByThread(threadId) {
      return db
        .select()
        .from(schema.mcpAuditLog)
        .where(eq(schema.mcpAuditLog.thread_id, threadId))
        .all() as McpAuditRow[];
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
    memories,
    mcpAudit,
    installTransactions,
    installedPackages,
    installedAssets,
    assetBindings,
    // TODO(runtime-completion): Replace with Drizzle-backed implementations
    employeeVersions: new MemoryEmployeeVersionRepository(),
    costRates: new MemoryModelCostRateRepository(),
  };
}
