import * as schema from '@aics/db-local';
import type {
  AssetBindingRow,
  InstallTransactionRow,
  InstalledAssetRow,
  InstalledPackageRow,
  NewEmployee,
} from '@aics/install-core';
import type { BindingStatus, InstallState, NewProject, ProjectRow, ProjectStatus } from '@aics/shared-types';
import { and, desc, eq, inArray, like, or, sql } from 'drizzle-orm';
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
  EmployeeVersionRepository,
  EmployeeVersionRow,
  EventRepository,
  GraphCheckpointRow,
  GraphThreadRow,
  HandoffEventRow,
  HandoffRepository,
  LlmCallRepository,
  LlmCallRow,
  McpAuditRepository,
  McpAuditRow,
  MeetingRepository,
  MeetingSessionRow,
  MemoryEntryCreate,
  MemoryEntryRow,
  MemoryRepository,
  ModelCostRateRepository,
  ModelCostRateRow,
  NewEmployeeVersion,
  NewGraphCheckpoint,
  NewGraphThread,
  NewHandoffEvent,
  NewLlmCall,
  NewMcpAudit,
  NewMeetingSession,
  NewModelCostRate,
  NewOfficeLayout,
  NewRack,
  NewRuntimeEvent,
  NewSlot,
  NewSopTemplate,
  NewTaskRun,
  NewToolCall,
  NewLibraryDocument,
  LibraryDocumentRow,
  OfficeLayoutRow,
  ProjectRepository,
  RackRow,
  SlotRow,
  SopTemplateRow,
  RuntimeRepositories,
  TaskRunRepository,
  TaskRunRow,
  ThreadRepository,
  ToolCallRepository,
  ToolCallRow,
  WorkstationRackRow,
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
    async findAll() {
      return db.select().from(schema.companies).all() as Awaited<ReturnType<CompanyRepository['findAll']>>;
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
      // Get thread IDs for the company
      const threadRows = db
        .select({ thread_id: schema.graphThreads.thread_id })
        .from(schema.graphThreads)
        .where(eq(schema.graphThreads.company_id, companyId))
        .all();
      const threadIds = threadRows.map((t) => t.thread_id);
      if (threadIds.length === 0) return [];

      // Build conditions: thread_id IN (...) + optional status filter
      const conditions = [inArray(schema.taskRuns.thread_id, threadIds)];
      if (opts?.statuses && opts.statuses.length > 0) {
        conditions.push(inArray(schema.taskRuns.status, opts.statuses));
      }

      let query = db
        .select()
        .from(schema.taskRuns)
        .where(and(...conditions))
        .orderBy(desc(schema.taskRuns.started_at));

      if (opts?.limit) {
        query = query.limit(opts.limit) as typeof query;
      }

      return query.all() as TaskRunRow[];
    },
    async countByStatus(companyId) {
      const threadRows = db
        .select({ thread_id: schema.graphThreads.thread_id })
        .from(schema.graphThreads)
        .where(eq(schema.graphThreads.company_id, companyId))
        .all();
      const threadIds = threadRows.map((t) => t.thread_id);
      if (threadIds.length === 0) return {};

      const rows = db
        .select({
          status: schema.taskRuns.status,
          cnt: sql<number>`COUNT(*)`,
        })
        .from(schema.taskRuns)
        .where(inArray(schema.taskRuns.thread_id, threadIds))
        .groupBy(schema.taskRuns.status)
        .all();

      const counts: Record<string, number> = {};
      for (const r of rows) {
        counts[r.status] = r.cnt;
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
    async findByThreadIds(threadIds) {
      if (threadIds.length === 0) return [];
      return db
        .select()
        .from(schema.llmCalls)
        .where(inArray(schema.llmCalls.thread_id, threadIds))
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
      db.delete(schema.assetBindings).where(eq(schema.assetBindings.binding_id, id)).run();
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
        conditions.push(
          sql`lower(${schema.memoryEntries.content}) LIKE ${'%' + queryWords[0] + '%'}`,
        );
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
      db.delete(schema.memoryEntries).where(eq(schema.memoryEntries.memory_id, memoryId)).run();
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

  const employeeVersions: EmployeeVersionRepository = {
    async create(version: NewEmployeeVersion) {
      const row: EmployeeVersionRow = {
        ...version,
        version_id: crypto.randomUUID(),
        created_at: now(),
      };
      db.insert(schema.employeeVersions).values(row).run();
      return row;
    },
    async findByEmployee(employeeId, opts) {
      let query = db
        .select()
        .from(schema.employeeVersions)
        .where(eq(schema.employeeVersions.employee_id, employeeId))
        .orderBy(desc(schema.employeeVersions.version_num));
      if (opts?.limit) {
        query = query.limit(opts.limit) as typeof query;
      }
      return query.all() as EmployeeVersionRow[];
    },
    async findByVersion(employeeId, versionNum) {
      const rows = db
        .select()
        .from(schema.employeeVersions)
        .where(
          and(
            eq(schema.employeeVersions.employee_id, employeeId),
            eq(schema.employeeVersions.version_num, versionNum),
          ),
        )
        .all();
      return (rows[0] as EmployeeVersionRow | undefined) ?? null;
    },
    async getLatestVersionNum(employeeId) {
      const rows = db
        .select({ maxVer: sql<number>`MAX(${schema.employeeVersions.version_num})` })
        .from(schema.employeeVersions)
        .where(eq(schema.employeeVersions.employee_id, employeeId))
        .all();
      return (rows[0] as { maxVer: number | null } | undefined)?.maxVer ?? 0;
    },
  };

  const costRates: ModelCostRateRepository = {
    async create(rate: NewModelCostRate) {
      const row: ModelCostRateRow = {
        ...rate,
        rate_id: crypto.randomUUID(),
        created_at: now(),
      };
      db.insert(schema.modelCostRates).values(row).run();
      return row;
    },
    async findByProviderModel(provider, model) {
      const rows = db
        .select()
        .from(schema.modelCostRates)
        .where(eq(schema.modelCostRates.provider, provider))
        .all() as ModelCostRateRow[];
      const matching = rows.filter((r) => {
        const regex = new RegExp(
          '^' + r.model_pattern.replace(/\*/g, '.*').replace(/\?/g, '.') + '$',
          'i',
        );
        return regex.test(model);
      });
      if (matching.length === 0) return null;
      matching.sort((a, b) => b.model_pattern.length - a.model_pattern.length);
      return matching[0]!;
    },
    async findAll() {
      return db.select().from(schema.modelCostRates).all() as ModelCostRateRow[];
    },
    async upsert(rate: NewModelCostRate) {
      const ts = now();
      const rateId = `mcr-${crypto.randomUUID()}`;
      const values: ModelCostRateRow = {
        rate_id: rateId,
        ...rate,
        created_at: ts,
      };
      db.insert(schema.modelCostRates)
        .values(values)
        .onConflictDoUpdate({
          target: [
            schema.modelCostRates.provider,
            schema.modelCostRates.model_pattern,
            schema.modelCostRates.effective_from,
          ],
          set: {
            input_cost_per_mtok: rate.input_cost_per_mtok,
            output_cost_per_mtok: rate.output_cost_per_mtok,
            effective_until: rate.effective_until,
          },
        })
        .run();
      // Fetch the persisted row (rate_id may differ if conflict resolved via DO UPDATE)
      const persisted = db
        .select()
        .from(schema.modelCostRates)
        .where(
          and(
            eq(schema.modelCostRates.provider, rate.provider),
            eq(schema.modelCostRates.model_pattern, rate.model_pattern),
            eq(schema.modelCostRates.effective_from, rate.effective_from),
          ),
        )
        .all() as ModelCostRateRow[];
      return persisted[0] as ModelCostRateRow;
    },
  };

  const sopTemplates: RuntimeRepositories['sopTemplates'] = {
    async create(template: NewSopTemplate) {
      const ts = now();
      const row: SopTemplateRow = { ...template, created_at: ts, updated_at: ts };
      db.insert(schema.sopTemplates).values(row).run();
      return row;
    },
    async findById(sopTemplateId) {
      const rows = db
        .select()
        .from(schema.sopTemplates)
        .where(eq(schema.sopTemplates.sop_template_id, sopTemplateId))
        .all();
      return (rows[0] as SopTemplateRow | undefined) ?? null;
    },
    async findByCompany(companyId) {
      return db
        .select()
        .from(schema.sopTemplates)
        .where(eq(schema.sopTemplates.company_id, companyId))
        .all() as SopTemplateRow[];
    },
    async delete(sopTemplateId) {
      db.delete(schema.sopTemplates)
        .where(eq(schema.sopTemplates.sop_template_id, sopTemplateId))
        .run();
    },
  };

  const racks: RuntimeRepositories['racks'] = {
    async create(rack: NewRack) {
      const ts = now();
      const row: RackRow = { ...rack, created_at: ts, updated_at: ts };
      db.insert(schema.racks).values(row).run();
      return row;
    },
    async findById(rackId) {
      const rows = db
        .select()
        .from(schema.racks)
        .where(eq(schema.racks.rack_id, rackId))
        .all();
      return (rows[0] as RackRow | undefined) ?? null;
    },
    async findByCompany(companyId) {
      return db
        .select()
        .from(schema.racks)
        .where(eq(schema.racks.company_id, companyId))
        .all() as RackRow[];
    },
    async updateStatus(rackId, status) {
      db.update(schema.racks)
        .set({ status, updated_at: now() })
        .where(eq(schema.racks.rack_id, rackId))
        .run();
    },
    async delete(rackId) {
      db.delete(schema.racks).where(eq(schema.racks.rack_id, rackId)).run();
    },
  };

  const slots: RuntimeRepositories['slots'] = {
    async create(slot: NewSlot) {
      const ts = now();
      const row: SlotRow = { ...slot, created_at: ts, updated_at: ts };
      db.insert(schema.slots).values(row).run();
      return row;
    },
    async findByRack(rackId) {
      return db
        .select()
        .from(schema.slots)
        .where(eq(schema.slots.rack_id, rackId))
        .all() as SlotRow[];
    },
    async updateStatus(slotId, status) {
      db.update(schema.slots)
        .set({ status, updated_at: now() })
        .where(eq(schema.slots.slot_id, slotId))
        .run();
    },
    async delete(slotId) {
      db.delete(schema.slots).where(eq(schema.slots.slot_id, slotId)).run();
    },
  };

  const workstationRacks: RuntimeRepositories['workstationRacks'] = {
    async create(binding) {
      const row = { ...binding, created_at: now() };
      db.insert(schema.workstationRacks).values(row).run();
      return row;
    },
    async findByWorkstation(workstationId) {
      return db
        .select()
        .from(schema.workstationRacks)
        .where(eq(schema.workstationRacks.workstation_id, workstationId))
        .all() as WorkstationRackRow[];
    },
    async findByRack(rackId) {
      return db
        .select()
        .from(schema.workstationRacks)
        .where(eq(schema.workstationRacks.rack_id, rackId))
        .all() as WorkstationRackRow[];
    },
    async delete(workstationId, rackId) {
      db.delete(schema.workstationRacks)
        .where(
          and(
            eq(schema.workstationRacks.workstation_id, workstationId),
            eq(schema.workstationRacks.rack_id, rackId),
          ),
        )
        .run();
    },
  };

  const libraryDocuments: RuntimeRepositories['libraryDocuments'] = {
    async create(doc: NewLibraryDocument) {
      const ts = now();
      const row: LibraryDocumentRow = { ...doc, created_at: ts, updated_at: ts };
      db.insert(schema.libraryDocuments).values(row).run();
      return row;
    },
    async findById(docId) {
      const rows = db
        .select()
        .from(schema.libraryDocuments)
        .where(eq(schema.libraryDocuments.doc_id, docId))
        .all();
      return (rows[0] as LibraryDocumentRow | undefined) ?? null;
    },
    async findByCompany(companyId) {
      return db
        .select()
        .from(schema.libraryDocuments)
        .where(eq(schema.libraryDocuments.company_id, companyId))
        .all() as LibraryDocumentRow[];
    },
    async search(companyId, query, opts) {
      const pattern = `%${query}%`;
      const limit = opts?.limit ?? 20;
      return db
        .select()
        .from(schema.libraryDocuments)
        .where(
          and(
            eq(schema.libraryDocuments.company_id, companyId),
            or(
              like(sql`lower(${schema.libraryDocuments.title})`, pattern.toLowerCase()),
              like(sql`lower(${schema.libraryDocuments.content_text})`, pattern.toLowerCase()),
            ),
          ),
        )
        .limit(limit)
        .all() as LibraryDocumentRow[];
    },
    async delete(docId) {
      db.delete(schema.libraryDocuments)
        .where(eq(schema.libraryDocuments.doc_id, docId))
        .run();
    },
  };

  // ── Prefab instances ──────────────────────────────────────────────
  const prefabInstances: RuntimeRepositories['prefabInstances'] = {
    async create(instance) {
      db.insert(schema.prefabInstances).values(instance).run();
      return instance;
    },
    async findById(instanceId) {
      const rows = db.select().from(schema.prefabInstances)
        .where(eq(schema.prefabInstances.instance_id, instanceId)).all();
      return (rows[0] ?? null) as ReturnType<RuntimeRepositories['prefabInstances']['findById']> extends Promise<infer R> ? R : never;
    },
    async findByCompanyAndZone(companyId, zoneId) {
      return db.select().from(schema.prefabInstances)
        .where(and(
          eq(schema.prefabInstances.company_id, companyId),
          eq(schema.prefabInstances.zone_id, zoneId),
        )).all() as Awaited<ReturnType<RuntimeRepositories['prefabInstances']['findByCompany']>>;
    },
    async findByCompany(companyId) {
      return db.select().from(schema.prefabInstances)
        .where(eq(schema.prefabInstances.company_id, companyId))
        .all() as Awaited<ReturnType<RuntimeRepositories['prefabInstances']['findByCompany']>>;
    },
    async update(instanceId, fields) {
      db.update(schema.prefabInstances).set({
        ...fields,
        updated_at: now(),
      }).where(eq(schema.prefabInstances.instance_id, instanceId)).run();
    },
    async delete(instanceId) {
      db.delete(schema.prefabInstances)
        .where(eq(schema.prefabInstances.instance_id, instanceId)).run();
    },
    async deleteByCompany(companyId) {
      db.delete(schema.prefabInstances)
        .where(eq(schema.prefabInstances.company_id, companyId)).run();
    },
  };

  const officeLayouts: RuntimeRepositories['officeLayouts'] = {
    async create(layout: NewOfficeLayout) {
      const ts = now();
      const row: OfficeLayoutRow = { ...layout, created_at: ts, updated_at: ts };
      db.insert(schema.officeLayouts).values(row).run();
      return row;
    },
    async findById(layoutId) {
      const rows = db
        .select()
        .from(schema.officeLayouts)
        .where(eq(schema.officeLayouts.layout_id, layoutId))
        .all();
      return (rows[0] as OfficeLayoutRow | undefined) ?? null;
    },
    async findByCompany(companyId) {
      return db
        .select()
        .from(schema.officeLayouts)
        .where(eq(schema.officeLayouts.company_id, companyId))
        .all() as OfficeLayoutRow[];
    },
    async findActive(companyId) {
      const rows = db
        .select()
        .from(schema.officeLayouts)
        .where(
          and(
            eq(schema.officeLayouts.company_id, companyId),
            eq(schema.officeLayouts.is_active, 1),
          ),
        )
        .all();
      return (rows[0] as OfficeLayoutRow | undefined) ?? null;
    },
    async setActive(companyId, layoutId) {
      db.transaction((tx) => {
        tx.update(schema.officeLayouts)
          .set({ is_active: 0, updated_at: now() })
          .where(eq(schema.officeLayouts.company_id, companyId))
          .run();
        const result = tx
          .update(schema.officeLayouts)
          .set({ is_active: 1, updated_at: now() })
          .where(
            and(
              eq(schema.officeLayouts.layout_id, layoutId),
              eq(schema.officeLayouts.company_id, companyId),
            ),
          )
          .run();
        if (result.changes === 0) {
          throw new Error(`Layout ${layoutId} not found for company ${companyId}`);
        }
      });
    },
    async update(layoutId, patch) {
      db.update(schema.officeLayouts)
        .set({ ...patch, updated_at: now() })
        .where(eq(schema.officeLayouts.layout_id, layoutId))
        .run();
    },
    async delete(layoutId) {
      db.delete(schema.officeLayouts)
        .where(eq(schema.officeLayouts.layout_id, layoutId))
        .run();
    },
  };

  const projects: ProjectRepository = {
    async create(project: NewProject) {
      const ts = now();
      const row: ProjectRow = { ...project, created_at: ts, updated_at: ts };
      db.insert(schema.projects).values(row).run();
      return row;
    },
    async findById(projectId) {
      const rows = db
        .select()
        .from(schema.projects)
        .where(eq(schema.projects.project_id, projectId))
        .all();
      return (rows[0] as ProjectRow | undefined) ?? null;
    },
    async findByCompany(companyId) {
      return db
        .select()
        .from(schema.projects)
        .where(eq(schema.projects.company_id, companyId))
        .orderBy(desc(schema.projects.updated_at))
        .all() as ProjectRow[];
    },
    async findActiveByCompany(companyId) {
      return db
        .select()
        .from(schema.projects)
        .where(
          and(
            eq(schema.projects.company_id, companyId),
            eq(schema.projects.status, 'active'),
          ),
        )
        .orderBy(desc(schema.projects.updated_at))
        .all() as ProjectRow[];
    },
    async updateStatus(projectId, status: ProjectStatus) {
      db.update(schema.projects)
        .set({ status, updated_at: now() })
        .where(eq(schema.projects.project_id, projectId))
        .run();
    },
    async update(projectId, patch) {
      db.update(schema.projects)
        .set({ ...patch, updated_at: now() })
        .where(eq(schema.projects.project_id, projectId))
        .run();
    },
    async delete(projectId) {
      db.delete(schema.projects)
        .where(eq(schema.projects.project_id, projectId))
        .run();
    },
  };

  // Wraps a synchronous callback in a better-sqlite3 transaction.
  // All repo .run() calls inside fn() participate in the same transaction.
  // db.transaction(fn) for better-sqlite3 executes fn synchronously and returns T.
  const transact = <T>(fn: () => T): T => db.transaction(fn) as unknown as T;

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
    employeeVersions,
    costRates,
    sopTemplates,
    racks,
    slots,
    workstationRacks,
    libraryDocuments,
    officeLayouts,
    prefabInstances,
    projects,
    transact,
  };
}
