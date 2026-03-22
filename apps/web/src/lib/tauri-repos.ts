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
  McpAuditRow,
  MeetingRepository,
  MeetingSessionRow,
  MemoryEntryCreate,
  MemoryEntryRow,
  MemoryRepository,
  NewGraphCheckpoint,
  NewGraphThread,
  NewHandoffEvent,
  NewLlmCall,
  NewMcpAudit,
  NewMeetingSession,
  NewRuntimeEvent,
  NewTaskRun,
  NewToolCall,
  NewSopTemplate,
  NewRack,
  NewSlot,
  NewLibraryDocument,
  NewOfficeLayout,
  WorkstationRackRow,
  RuntimeRepositories,
  SopTemplateRow,
  RackRow,
  SlotRow,
  LibraryDocumentRow,
  OfficeLayoutRow,
  TaskRunRepository,
  TaskRunRow,
  ThreadRepository,
  ToolCallRepository,
  ToolCallRow,
  ProjectRepository,
} from '@aics/core/browser';
import type { ProjectRow, NewProject, ProjectStatus } from '@aics/shared-types';
import type {
  EmployeeVersionRepository,
  EmployeeVersionRow,
  ModelCostRateRepository,
  ModelCostRateRow,
  NewEmployeeVersion,
  NewModelCostRate,
} from '@aics/core/browser';
import * as schema from '@aics/db-local';
import type {
  AssetBindingRow,
  InstallTransactionRow,
  InstalledAssetRow,
  InstalledPackageRow,
  NewEmployee,
} from '@aics/install-core';
import type { BindingStatus, InstallState } from '@aics/shared-types';
import { and, desc, eq, inArray, like, or, sql } from 'drizzle-orm';
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
    async findAll() {
      const rows = await db.select().from(schema.companies);
      return rows as CompanyRow[];
    },
    async create(company: CompanyRow) {
      await db.insert(schema.companies).values(company);
      return company;
    },
    async update(companyId: string, fields: Partial<Pick<CompanyRow, 'name' | 'status'>>) {
      await db
        .update(schema.companies)
        .set({ ...fields, updated_at: now() })
        .where(eq(schema.companies.company_id, companyId));
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
    async findQueue(companyId, opts) {
      const threadRows = await db
        .select({ thread_id: schema.graphThreads.thread_id })
        .from(schema.graphThreads)
        .where(eq(schema.graphThreads.company_id, companyId));
      const threadIds = threadRows.map((t) => t.thread_id);
      if (threadIds.length === 0) return [];

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

      return (await query) as TaskRunRow[];
    },
    async countByStatus(companyId) {
      const threadRows = await db
        .select({ thread_id: schema.graphThreads.thread_id })
        .from(schema.graphThreads)
        .where(eq(schema.graphThreads.company_id, companyId));
      const threadIds = threadRows.map((t) => t.thread_id);
      if (threadIds.length === 0) return {};

      const rows = await db
        .select({
          status: schema.taskRuns.status,
          cnt: sql<number>`COUNT(*)`,
        })
        .from(schema.taskRuns)
        .where(inArray(schema.taskRuns.thread_id, threadIds))
        .groupBy(schema.taskRuns.status);

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
    async update(employeeId, patch) {
      await db
        .update(schema.employees)
        .set({ ...patch, updated_at: now() })
        .where(eq(schema.employees.employee_id, employeeId));
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
    async findByThreadIds(threadIds) {
      if (threadIds.length === 0) return [];
      return (await db
        .select()
        .from(schema.llmCalls)
        .where(inArray(schema.llmCalls.thread_id, threadIds))) as LlmCallRow[];
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

  // --- Memory (async Drizzle-backed, mirrors core/drizzle-repositories.ts) ---

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
      await db.insert(schema.memoryEntries).values(row);
      return row;
    },
    async findById(memoryId) {
      const rows = await db
        .select()
        .from(schema.memoryEntries)
        .where(eq(schema.memoryEntries.memory_id, memoryId));
      return (rows[0] as MemoryEntryRow | undefined) ?? null;
    },
    async search(query, opts) {
      const conditions = [eq(schema.memoryEntries.company_id, opts.companyId)];
      if (opts.scope) conditions.push(eq(schema.memoryEntries.scope, opts.scope));
      if (opts.ownerId) conditions.push(eq(schema.memoryEntries.owner_id, opts.ownerId));
      const queryWords = query
        .toLowerCase()
        .split(/\s+/)
        .filter((w) => w.length >= 3);
      if (queryWords.length > 0) {
        conditions.push(
          sql`lower(${schema.memoryEntries.content}) LIKE ${'%' + queryWords[0] + '%'}`,
        );
      }
      const limit = opts.limit ?? 10;
      const rows = await db
        .select()
        .from(schema.memoryEntries)
        .where(and(...conditions))
        .orderBy(desc(schema.memoryEntries.importance))
        .limit(limit * 5);
      const filtered = (rows as MemoryEntryRow[]).filter((r) => {
        const lower = r.content.toLowerCase();
        return queryWords.some((w) => lower.includes(w));
      });
      return filtered.slice(0, limit);
    },
    async delete(memoryId) {
      await db.delete(schema.memoryEntries).where(eq(schema.memoryEntries.memory_id, memoryId));
    },
    async findByOwner(ownerId, opts) {
      const conditions = [eq(schema.memoryEntries.owner_id, ownerId)];
      if (opts?.category) conditions.push(eq(schema.memoryEntries.category, opts.category));
      const rows = await db
        .select()
        .from(schema.memoryEntries)
        .where(and(...conditions))
        .orderBy(desc(schema.memoryEntries.importance))
        .limit(opts?.limit ?? 50);
      return rows as MemoryEntryRow[];
    },
    async touchAccess(memoryId) {
      await db
        .update(schema.memoryEntries)
        .set({
          accessed_at: now(),
          access_count: sql`${schema.memoryEntries.access_count} + 1`,
        })
        .where(eq(schema.memoryEntries.memory_id, memoryId));
    },
  };

  const employeeVersions: EmployeeVersionRepository = {
    async create(version: NewEmployeeVersion) {
      const row: EmployeeVersionRow = {
        ...version,
        version_id: crypto.randomUUID(),
        created_at: now(),
      };
      await db.insert(schema.employeeVersions).values(row);
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
      return (await query) as EmployeeVersionRow[];
    },
    async findByVersion(employeeId, versionNum) {
      const rows = await db
        .select()
        .from(schema.employeeVersions)
        .where(
          and(
            eq(schema.employeeVersions.employee_id, employeeId),
            eq(schema.employeeVersions.version_num, versionNum),
          ),
        );
      return (rows[0] as EmployeeVersionRow | undefined) ?? null;
    },
    async getLatestVersionNum(employeeId) {
      const rows = await db
        .select({ maxVer: sql<number>`MAX(${schema.employeeVersions.version_num})` })
        .from(schema.employeeVersions)
        .where(eq(schema.employeeVersions.employee_id, employeeId));
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
      await db.insert(schema.modelCostRates).values(row);
      return row;
    },
    async findByProviderModel(provider, model) {
      const rows = (await db
        .select()
        .from(schema.modelCostRates)
        .where(eq(schema.modelCostRates.provider, provider))) as ModelCostRateRow[];
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
      return (await db.select().from(schema.modelCostRates)) as ModelCostRateRow[];
    },
    async upsert(rate: NewModelCostRate) {
      const existing = (await db
        .select()
        .from(schema.modelCostRates)
        .where(
          and(
            eq(schema.modelCostRates.provider, rate.provider),
            eq(schema.modelCostRates.model_pattern, rate.model_pattern),
            eq(schema.modelCostRates.effective_from, rate.effective_from),
          ),
        )) as ModelCostRateRow[];
      if (existing.length > 0) {
        const row = existing[0]!;
        await db
          .update(schema.modelCostRates)
          .set({
            input_cost_per_mtok: rate.input_cost_per_mtok,
            output_cost_per_mtok: rate.output_cost_per_mtok,
            effective_until: rate.effective_until,
          })
          .where(eq(schema.modelCostRates.rate_id, row.rate_id));
        return { ...row, ...rate };
      }
      return this.create(rate);
    },
  };

  // --- MCP audit log (Drizzle-backed, migration 007) ---

  const mcpAudit: RuntimeRepositories['mcpAudit'] = {
    async create(audit: NewMcpAudit) {
      await db.insert(schema.mcpAuditLog).values(audit);
      return audit as McpAuditRow;
    },
    async listByThread(threadId) {
      return (await db
        .select()
        .from(schema.mcpAuditLog)
        .where(eq(schema.mcpAuditLog.thread_id, threadId))) as McpAuditRow[];
    },
  };

  // --- SOP templates (Drizzle-backed, migration 011) ---

  const sopTemplates: RuntimeRepositories['sopTemplates'] = {
    async create(template: NewSopTemplate) {
      const ts = now();
      const row: SopTemplateRow = { ...template, created_at: ts, updated_at: ts };
      await db.insert(schema.sopTemplates).values(row);
      return row;
    },
    async findById(sopTemplateId) {
      const rows = await db
        .select()
        .from(schema.sopTemplates)
        .where(eq(schema.sopTemplates.sop_template_id, sopTemplateId));
      return (rows[0] as SopTemplateRow | undefined) ?? null;
    },
    async findByCompany(companyId) {
      return (await db
        .select()
        .from(schema.sopTemplates)
        .where(eq(schema.sopTemplates.company_id, companyId))) as SopTemplateRow[];
    },
    async delete(sopTemplateId) {
      await db
        .delete(schema.sopTemplates)
        .where(eq(schema.sopTemplates.sop_template_id, sopTemplateId));
    },
  };

  // --- Racks (Drizzle-backed, migration 001 — core tables) ---

  const racks: RuntimeRepositories['racks'] = {
    async create(rack: NewRack) {
      const ts = now();
      const row: RackRow = { ...rack, created_at: ts, updated_at: ts };
      await db.insert(schema.racks).values(row);
      return row;
    },
    async findById(rackId) {
      const rows = await db
        .select()
        .from(schema.racks)
        .where(eq(schema.racks.rack_id, rackId));
      return (rows[0] as RackRow | undefined) ?? null;
    },
    async findByCompany(companyId) {
      return (await db
        .select()
        .from(schema.racks)
        .where(eq(schema.racks.company_id, companyId))) as RackRow[];
    },
    async updateStatus(rackId, status) {
      await db
        .update(schema.racks)
        .set({ status, updated_at: now() })
        .where(eq(schema.racks.rack_id, rackId));
    },
    async delete(rackId) {
      await db.delete(schema.racks).where(eq(schema.racks.rack_id, rackId));
    },
  };

  // --- Slots (Drizzle-backed, migration 001 — core tables) ---

  const slots: RuntimeRepositories['slots'] = {
    async create(slot: NewSlot) {
      const ts = now();
      const row: SlotRow = { ...slot, created_at: ts, updated_at: ts };
      await db.insert(schema.slots).values(row);
      return row;
    },
    async findByRack(rackId) {
      return (await db
        .select()
        .from(schema.slots)
        .where(eq(schema.slots.rack_id, rackId))) as SlotRow[];
    },
    async updateStatus(slotId, status) {
      await db
        .update(schema.slots)
        .set({ status, updated_at: now() })
        .where(eq(schema.slots.slot_id, slotId));
    },
    async delete(slotId) {
      await db.delete(schema.slots).where(eq(schema.slots.slot_id, slotId));
    },
  };

  // --- Library documents (Drizzle-backed, migration 013) ---

  const libraryDocuments: RuntimeRepositories['libraryDocuments'] = {
    async create(doc: NewLibraryDocument) {
      const ts = now();
      const row: LibraryDocumentRow = { ...doc, created_at: ts, updated_at: ts };
      await db.insert(schema.libraryDocuments).values(row);
      return row;
    },
    async findById(docId) {
      const rows = await db
        .select()
        .from(schema.libraryDocuments)
        .where(eq(schema.libraryDocuments.doc_id, docId));
      return (rows[0] as LibraryDocumentRow | undefined) ?? null;
    },
    async findByCompany(companyId) {
      return (await db
        .select()
        .from(schema.libraryDocuments)
        .where(eq(schema.libraryDocuments.company_id, companyId))) as LibraryDocumentRow[];
    },
    async search(companyId, query, opts) {
      const pattern = `%${query}%`;
      const limit = opts?.limit ?? 20;
      return (await db
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
        .limit(limit)) as LibraryDocumentRow[];
    },
    async delete(docId) {
      await db
        .delete(schema.libraryDocuments)
        .where(eq(schema.libraryDocuments.doc_id, docId));
    },
  };

  // --- Office layouts (Drizzle-backed, migration 012) ---

  const officeLayouts: RuntimeRepositories['officeLayouts'] = {
    async create(layout: NewOfficeLayout) {
      const ts = now();
      const row: OfficeLayoutRow = { ...layout, created_at: ts, updated_at: ts };
      await db.insert(schema.officeLayouts).values(row);
      return row;
    },
    async findById(layoutId: string) {
      const rows = await db
        .select()
        .from(schema.officeLayouts)
        .where(eq(schema.officeLayouts.layout_id, layoutId));
      return (rows[0] as OfficeLayoutRow | undefined) ?? null;
    },
    async findByCompany(companyId: string) {
      return (await db
        .select()
        .from(schema.officeLayouts)
        .where(eq(schema.officeLayouts.company_id, companyId))) as OfficeLayoutRow[];
    },
    async findActive(companyId: string) {
      const rows = await db
        .select()
        .from(schema.officeLayouts)
        .where(
          and(
            eq(schema.officeLayouts.company_id, companyId),
            eq(schema.officeLayouts.is_active, 1),
          ),
        );
      return (rows[0] as OfficeLayoutRow | undefined) ?? null;
    },
    async setActive(companyId: string, layoutId: string) {
      // Deactivate all layouts for this company first
      await db
        .update(schema.officeLayouts)
        .set({ is_active: 0, updated_at: now() })
        .where(eq(schema.officeLayouts.company_id, companyId));
      // Activate the target layout
      await db
        .update(schema.officeLayouts)
        .set({ is_active: 1, updated_at: now() })
        .where(eq(schema.officeLayouts.layout_id, layoutId));
    },
    async update(layoutId: string, patch: Partial<Pick<OfficeLayoutRow, 'name' | 'layout_json'>>) {
      await db
        .update(schema.officeLayouts)
        .set({ ...patch, updated_at: now() })
        .where(eq(schema.officeLayouts.layout_id, layoutId));
    },
    async delete(layoutId: string) {
      await db
        .delete(schema.officeLayouts)
        .where(eq(schema.officeLayouts.layout_id, layoutId));
    },
  };

  const workstationRacks: RuntimeRepositories['workstationRacks'] = {
    async create(binding) {
      const row = { ...binding, created_at: new Date().toISOString() };
      await db.insert(schema.workstationRacks).values(row);
      return row;
    },
    async findByWorkstation(workstationId) {
      return (await db
        .select()
        .from(schema.workstationRacks)
        .where(eq(schema.workstationRacks.workstation_id, workstationId))) as WorkstationRackRow[];
    },
    async findByRack(rackId) {
      return (await db
        .select()
        .from(schema.workstationRacks)
        .where(eq(schema.workstationRacks.rack_id, rackId))) as WorkstationRackRow[];
    },
    async delete(workstationId, rackId) {
      await db
        .delete(schema.workstationRacks)
        .where(
          and(
            eq(schema.workstationRacks.workstation_id, workstationId),
            eq(schema.workstationRacks.rack_id, rackId),
          ),
        );
    },
  };

  // ── Prefab instances ──────────────────────────────────────────────
  const prefabInstances: RuntimeRepositories['prefabInstances'] = {
    async create(instance) {
      await db.insert(schema.prefabInstances).values(instance);
      return instance;
    },
    async findById(instanceId) {
      const rows = await db.select().from(schema.prefabInstances)
        .where(eq(schema.prefabInstances.instance_id, instanceId));
      return (rows[0] ?? null) as Awaited<ReturnType<RuntimeRepositories['prefabInstances']['findById']>>;
    },
    async findByCompanyAndZone(companyId, zoneId) {
      return (await db.select().from(schema.prefabInstances)
        .where(and(
          eq(schema.prefabInstances.company_id, companyId),
          eq(schema.prefabInstances.zone_id, zoneId),
        ))) as Awaited<ReturnType<RuntimeRepositories['prefabInstances']['findByCompany']>>;
    },
    async findByCompany(companyId) {
      return (await db.select().from(schema.prefabInstances)
        .where(eq(schema.prefabInstances.company_id, companyId))) as Awaited<ReturnType<RuntimeRepositories['prefabInstances']['findByCompany']>>;
    },
    async update(instanceId, fields) {
      await db.update(schema.prefabInstances).set({
        ...fields,
        updated_at: new Date().toISOString(),
      }).where(eq(schema.prefabInstances.instance_id, instanceId));
    },
    async delete(instanceId) {
      await db.delete(schema.prefabInstances)
        .where(eq(schema.prefabInstances.instance_id, instanceId));
    },
    async deleteByCompany(companyId) {
      await db.delete(schema.prefabInstances)
        .where(eq(schema.prefabInstances.company_id, companyId));
    },
  };

  const projects: ProjectRepository = {
    async create(p: NewProject) {
      const row: ProjectRow = { ...p, created_at: now(), updated_at: now() };
      await db.insert(schema.projects).values(row);
      return row;
    },
    async findById(projectId) {
      const rows = await db
        .select()
        .from(schema.projects)
        .where(eq(schema.projects.project_id, projectId));
      return (rows[0] as ProjectRow | undefined) ?? null;
    },
    async findByCompany(companyId) {
      return (await db
        .select()
        .from(schema.projects)
        .where(eq(schema.projects.company_id, companyId))
        .orderBy(desc(schema.projects.updated_at))) as ProjectRow[];
    },
    async findActiveByCompany(companyId) {
      return (await db
        .select()
        .from(schema.projects)
        .where(
          and(
            eq(schema.projects.company_id, companyId),
            inArray(schema.projects.status, ['planning', 'active', 'paused']),
          ),
        )
        .orderBy(desc(schema.projects.updated_at))) as ProjectRow[];
    },
    async updateStatus(projectId, status: ProjectStatus) {
      await db
        .update(schema.projects)
        .set({ status, updated_at: now() })
        .where(eq(schema.projects.project_id, projectId));
    },
    async update(projectId, patch) {
      await db
        .update(schema.projects)
        .set({ ...patch, updated_at: now() })
        .where(eq(schema.projects.project_id, projectId));
    },
    async delete(projectId) {
      await db.delete(schema.projects).where(eq(schema.projects.project_id, projectId));
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
    memories,
    mcpAudit,
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
  };
}
