import * as schema from '@offisim/db-local/dist/schema.js';
import { ACTIVE_PROJECT_STATUSES } from '@offisim/shared-types';
import type {
  NewProject,
  NewProjectAssignment,
  ProjectAssignmentRow,
  ProjectRow,
  ProjectStatus,
  ZoneRow,
} from '@offisim/shared-types';
import { and, desc, eq, inArray, like, notInArray, or, sql } from 'drizzle-orm';
import type { BetterSQLite3Database } from 'drizzle-orm/better-sqlite3';
import type { NewZone } from '../repos/zone-repository.js';
import { createConversationsDrizzleRepos } from './repos/conversations/drizzle.js';
import { createEmployeesDrizzleRepos } from './repos/employees/drizzle.js';
import { createInstallDrizzleRepos } from './repos/install/drizzle.js';
import { createLlmDrizzleRepos } from './repos/llm/drizzle.js';
import { createOrchestrationDrizzleRepos } from './repos/orchestration/drizzle.js';
import { createPermissionsDrizzleRepos } from './repos/permissions/drizzle.js';
import type {
  AgentEventRepository,
  AgentEventRow,
  CompactSummaryRepository,
  CompactSummaryRow,
  FileHistoryRepository,
  FileHistoryRow,
  LibraryDocumentRow,
  MemoryEntryCreate,
  MemoryEntryRow,
  MemoryRepository,
  NewAgentEvent,
  NewCompactSummary,
  NewFileHistory,
  NewLibraryDocument,
  NewNodeSummary,
  NewOfficeLayout,
  NewRecoveryKnowledge,
  NewSopTemplate,
  NodeSummaryRepository,
  NodeSummaryRow,
  OfficeLayoutRow,
  ProjectAssignmentRepository,
  ProjectRepository,
  RecoveryKnowledgeRepository,
  RecoveryKnowledgeRow,
  RuntimeRepositories,
  SopTemplateRow,
} from './repositories.js';

type Db = BetterSQLite3Database<typeof schema>;

function now(): string {
  return new Date().toISOString();
}

function normalizeMemoryDedupeKey(content: string): string {
  const normalized = content.normalize('NFKC').toLowerCase();
  const simplified = normalized
    .replace(/[.,:;/，。：；、]+/gu, ' ')
    .replace(/\s+/g, ' ')
    .trim();
  return simplified || normalized.replace(/\s+/g, ' ').trim();
}

export function createDrizzleRepositories(db: Db): RuntimeRepositories {
  const orchestration = createOrchestrationDrizzleRepos(db);
  const employeesFamily = createEmployeesDrizzleRepos(db);
  const conversationsFamily = createConversationsDrizzleRepos(db);
  const llmFamily = createLlmDrizzleRepos(db);
  const installFamily = createInstallDrizzleRepos(db);
  const permissionsFamily = createPermissionsDrizzleRepos(db);

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
        confidence: entry.confidence ?? 0.7,
        dedupe_key: entry.dedupe_key ?? normalizeMemoryDedupeKey(entry.content),
        reinforcement_count: entry.reinforcement_count ?? 1,
        last_reinforced_at: entry.last_reinforced_at ?? ts,
        metadata_json: entry.metadata_json ?? null,
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
    async findByDedupeKey(lookup) {
      const row = db
        .select()
        .from(schema.memoryEntries)
        .where(
          and(
            eq(schema.memoryEntries.company_id, lookup.companyId),
            eq(schema.memoryEntries.scope, lookup.scope),
            eq(schema.memoryEntries.owner_id, lookup.ownerId),
            eq(schema.memoryEntries.category, lookup.category),
            eq(schema.memoryEntries.dedupe_key, lookup.dedupeKey),
          ),
        )
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
        conditions.push(sql`lower(${schema.memoryEntries.content}) LIKE ${`%${queryWords[0]}%`}`);
      }
      const limit = opts.limit ?? 10;
      // Fetch wider candidate set, then JS-filter + limit
      const rows = db
        .select()
        .from(schema.memoryEntries)
        .where(and(...conditions))
        .orderBy(
          desc(schema.memoryEntries.importance),
          desc(schema.memoryEntries.confidence),
          desc(schema.memoryEntries.last_reinforced_at),
        )
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
        .orderBy(
          desc(schema.memoryEntries.importance),
          desc(schema.memoryEntries.confidence),
          desc(schema.memoryEntries.last_reinforced_at),
        )
        .limit(opts?.limit ?? 50)
        .all();
      return rows as MemoryEntryRow[];
    },
    async reinforce(memoryId, patch) {
      const existing = await memories.findById(memoryId);
      if (!existing) return null;

      const nextContent =
        patch.content && patch.content.length > existing.content.length
          ? patch.content
          : existing.content;
      db.update(schema.memoryEntries)
        .set({
          content: nextContent,
          importance:
            patch.importance !== undefined
              ? Math.max(existing.importance, patch.importance)
              : existing.importance,
          confidence:
            patch.confidence !== undefined
              ? Math.max(existing.confidence, patch.confidence)
              : existing.confidence,
          metadata_json: patch.metadataJson ?? existing.metadata_json,
          source_thread_id: patch.sourceThreadId ?? existing.source_thread_id,
          source_task_run_id: patch.sourceTaskRunId ?? existing.source_task_run_id,
          reinforcement_count: existing.reinforcement_count + 1,
          last_reinforced_at: now(),
        })
        .where(eq(schema.memoryEntries.memory_id, memoryId))
        .run();

      return memories.findById(memoryId);
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

  const nodeSummaries: NodeSummaryRepository = {
    async create(summary: NewNodeSummary) {
      db.insert(schema.nodeSummaries).values(summary).run();
      return summary as NodeSummaryRow;
    },
    async listByThread(threadId, opts) {
      let query = db
        .select()
        .from(schema.nodeSummaries)
        .where(eq(schema.nodeSummaries.thread_id, threadId))
        .orderBy(desc(schema.nodeSummaries.created_at));
      if (opts?.limit) {
        query = query.limit(opts.limit) as typeof query;
      }
      return query.all() as NodeSummaryRow[];
    },
    async countByThread(threadId) {
      const rows = db
        .select({ count: sql<number>`count(*)` })
        .from(schema.nodeSummaries)
        .where(eq(schema.nodeSummaries.thread_id, threadId))
        .all();
      return Number(rows[0]?.count ?? 0);
    },
    async deleteByThread(threadId) {
      db.delete(schema.nodeSummaries).where(eq(schema.nodeSummaries.thread_id, threadId)).run();
    },
    async trimByThread(threadId, keepLatest) {
      if (keepLatest < 0) return;
      const keepRows = db
        .select({ summary_id: schema.nodeSummaries.summary_id })
        .from(schema.nodeSummaries)
        .where(eq(schema.nodeSummaries.thread_id, threadId))
        .orderBy(desc(schema.nodeSummaries.created_at))
        .limit(keepLatest)
        .all();
      const keepIds = keepRows.map((row) => row.summary_id);
      if (keepIds.length === 0) {
        db.delete(schema.nodeSummaries).where(eq(schema.nodeSummaries.thread_id, threadId)).run();
        return;
      }
      db.delete(schema.nodeSummaries)
        .where(
          and(
            eq(schema.nodeSummaries.thread_id, threadId),
            notInArray(schema.nodeSummaries.summary_id, keepIds),
          ),
        )
        .run();
    },
  };

  const compactSummaries: CompactSummaryRepository = {
    async create(summary: NewCompactSummary) {
      db.insert(schema.compactSummaries).values(summary).run();
      return summary as CompactSummaryRow;
    },
    async listByThread(threadId, opts) {
      let query = db
        .select()
        .from(schema.compactSummaries)
        .where(eq(schema.compactSummaries.thread_id, threadId))
        .orderBy(desc(schema.compactSummaries.created_at));
      if (opts?.limit) {
        query = query.limit(opts.limit) as typeof query;
      }
      return query.all() as CompactSummaryRow[];
    },
    async deleteByThread(threadId) {
      db.delete(schema.compactSummaries)
        .where(eq(schema.compactSummaries.thread_id, threadId))
        .run();
    },
  };

  const fileHistory: FileHistoryRepository = {
    async create(entry: NewFileHistory) {
      db.insert(schema.fileHistory).values(entry).run();
      return entry as FileHistoryRow;
    },
    async listByThread(threadId, opts) {
      let query = db
        .select()
        .from(schema.fileHistory)
        .where(eq(schema.fileHistory.thread_id, threadId))
        .orderBy(desc(schema.fileHistory.created_at));
      if (opts?.limit) {
        query = query.limit(opts.limit) as typeof query;
      }
      return query.all() as FileHistoryRow[];
    },
    async listBySnapshot(snapshotId) {
      return db
        .select()
        .from(schema.fileHistory)
        .where(eq(schema.fileHistory.snapshot_id, snapshotId))
        .orderBy(schema.fileHistory.created_at)
        .all() as FileHistoryRow[];
    },
    async deleteByThread(threadId) {
      db.delete(schema.fileHistory).where(eq(schema.fileHistory.thread_id, threadId)).run();
    },
  };

  const sopTemplates: RuntimeRepositories['sopTemplates'] = {
    // NOTE: not `async` — see EmployeeRepository.create for rationale.
    create(template: NewSopTemplate) {
      const ts = now();
      const row: SopTemplateRow = { ...template, created_at: ts, updated_at: ts };
      db.insert(schema.sopTemplates).values(row).run();
      return Promise.resolve(row);
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
    async update(sopTemplateId, patch) {
      db.update(schema.sopTemplates)
        .set({ ...patch, updated_at: now() })
        .where(eq(schema.sopTemplates.sop_template_id, sopTemplateId))
        .run();
    },
    async delete(sopTemplateId) {
      db.delete(schema.sopTemplates)
        .where(eq(schema.sopTemplates.sop_template_id, sopTemplateId))
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
      db.delete(schema.libraryDocuments).where(eq(schema.libraryDocuments.doc_id, docId)).run();
    },
  };

  // ── Prefab instances ──────────────────────────────────────────────
  const prefabInstances: RuntimeRepositories['prefabInstances'] = {
    // NOTE: not `async` — see EmployeeRepository.create for rationale.
    create(instance) {
      db.insert(schema.prefabInstances).values(instance).run();
      return Promise.resolve(instance);
    },
    async findById(instanceId) {
      const rows = db
        .select()
        .from(schema.prefabInstances)
        .where(eq(schema.prefabInstances.instance_id, instanceId))
        .all();
      return (rows[0] ?? null) as ReturnType<
        RuntimeRepositories['prefabInstances']['findById']
      > extends Promise<infer R>
        ? R
        : never;
    },
    async findByCompanyAndZone(companyId, zoneId) {
      return db
        .select()
        .from(schema.prefabInstances)
        .where(
          and(
            eq(schema.prefabInstances.company_id, companyId),
            eq(schema.prefabInstances.zone_id, zoneId),
          ),
        )
        .all() as Awaited<ReturnType<RuntimeRepositories['prefabInstances']['findByCompany']>>;
    },
    async findByCompany(companyId) {
      return db
        .select()
        .from(schema.prefabInstances)
        .where(eq(schema.prefabInstances.company_id, companyId))
        .all() as Awaited<ReturnType<RuntimeRepositories['prefabInstances']['findByCompany']>>;
    },
    async update(instanceId, fields) {
      db.update(schema.prefabInstances)
        .set({
          ...fields,
          updated_at: now(),
        })
        .where(eq(schema.prefabInstances.instance_id, instanceId))
        .run();
    },
    async delete(instanceId) {
      db.delete(schema.prefabInstances)
        .where(eq(schema.prefabInstances.instance_id, instanceId))
        .run();
    },
    async deleteByCompany(companyId) {
      db.delete(schema.prefabInstances)
        .where(eq(schema.prefabInstances.company_id, companyId))
        .run();
    },
  };

  const officeLayouts: RuntimeRepositories['officeLayouts'] = {
    // NOTE: not `async` — see EmployeeRepository.create for rationale.
    create(layout: NewOfficeLayout) {
      const ts = now();
      const row: OfficeLayoutRow = { ...layout, created_at: ts, updated_at: ts };
      db.insert(schema.officeLayouts).values(row).run();
      return Promise.resolve(row);
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
      db.delete(schema.officeLayouts).where(eq(schema.officeLayouts.layout_id, layoutId)).run();
    },
  };

  // ── Zones ───────────────────────────────────────────────────────
  const zones: RuntimeRepositories['zones'] = {
    // NOTE: not `async` — see EmployeeRepository.create for rationale. Relevant
    // here because company-template-service inlines zone seeding inside a
    // sync transact() callback; an async create would suspend as microtask
    // and write zones 2..N outside the transaction.
    create(zone: NewZone) {
      const ts = now();
      const row: ZoneRow = { ...zone, created_at: ts, updated_at: ts };
      db.insert(schema.zones).values(row).run();
      return Promise.resolve(row);
    },
    async findById(zoneId) {
      const rows = db.select().from(schema.zones).where(eq(schema.zones.zone_id, zoneId)).all();
      return (rows[0] as ZoneRow | undefined) ?? null;
    },
    async findByCompany(companyId) {
      return db
        .select()
        .from(schema.zones)
        .where(eq(schema.zones.company_id, companyId))
        .all() as ZoneRow[];
    },
    async update(zoneId, fields) {
      db.update(schema.zones)
        .set({ ...fields, updated_at: now() })
        .where(eq(schema.zones.zone_id, zoneId))
        .run();
    },
    async delete(zoneId) {
      db.delete(schema.zones).where(eq(schema.zones.zone_id, zoneId)).run();
    },
    async deleteByCompany(companyId) {
      db.delete(schema.zones).where(eq(schema.zones.company_id, companyId)).run();
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
            inArray(schema.projects.status, [...ACTIVE_PROJECT_STATUSES]),
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
      db.delete(schema.projects).where(eq(schema.projects.project_id, projectId)).run();
    },
  };

  const projectAssignments: ProjectAssignmentRepository = {
    async assign(assignment: NewProjectAssignment) {
      const row: ProjectAssignmentRow = {
        ...assignment,
        assigned_at: now(),
      };
      db.insert(schema.projectAssignments).values(row).onConflictDoNothing().run();
      // Re-read to return whatever row exists (could be existing if duplicate)
      const rows = db
        .select()
        .from(schema.projectAssignments)
        .where(
          and(
            eq(schema.projectAssignments.project_id, assignment.project_id),
            eq(schema.projectAssignments.employee_id, assignment.employee_id),
          ),
        )
        .all();
      return (rows[0] as ProjectAssignmentRow | undefined) ?? row;
    },
    async unassign(projectId, employeeId) {
      db.delete(schema.projectAssignments)
        .where(
          and(
            eq(schema.projectAssignments.project_id, projectId),
            eq(schema.projectAssignments.employee_id, employeeId),
          ),
        )
        .run();
    },
    async findByProject(projectId) {
      return db
        .select()
        .from(schema.projectAssignments)
        .where(eq(schema.projectAssignments.project_id, projectId))
        .all() as ProjectAssignmentRow[];
    },
    async findByEmployee(employeeId) {
      return db
        .select()
        .from(schema.projectAssignments)
        .where(eq(schema.projectAssignments.employee_id, employeeId))
        .all() as ProjectAssignmentRow[];
    },
    async isAssigned(projectId, employeeId) {
      const rows = db
        .select()
        .from(schema.projectAssignments)
        .where(
          and(
            eq(schema.projectAssignments.project_id, projectId),
            eq(schema.projectAssignments.employee_id, employeeId),
          ),
        )
        .all();
      return rows.length > 0;
    },
  };

  // ---------------------------------------------------------------------------
  // Agent events (event sourcing)
  // ---------------------------------------------------------------------------

  const agentEvents: AgentEventRepository = {
    async append(event: NewAgentEvent) {
      const row: AgentEventRow = {
        ...event,
        created_at: event.created_at ?? now(),
      };
      db.insert(schema.agentEvents).values(row).run();
      return row;
    },
    async findByProject(projectId, opts) {
      let query = db
        .select()
        .from(schema.agentEvents)
        .where(
          opts?.eventType
            ? and(
                eq(schema.agentEvents.project_id, projectId),
                eq(schema.agentEvents.event_type, opts.eventType),
              )
            : eq(schema.agentEvents.project_id, projectId),
        )
        .orderBy(desc(schema.agentEvents.created_at));
      if (opts?.limit) query = query.limit(opts.limit) as typeof query;
      return query.all() as AgentEventRow[];
    },
    async findByThread(threadId, opts) {
      let query = db
        .select()
        .from(schema.agentEvents)
        .where(
          opts?.eventType
            ? and(
                eq(schema.agentEvents.thread_id, threadId),
                eq(schema.agentEvents.event_type, opts.eventType),
              )
            : eq(schema.agentEvents.thread_id, threadId),
        )
        .orderBy(desc(schema.agentEvents.created_at));
      if (opts?.limit) query = query.limit(opts.limit) as typeof query;
      return query.all() as AgentEventRow[];
    },
    async findByAgent(agentName, opts) {
      let query = db
        .select()
        .from(schema.agentEvents)
        .where(
          opts?.eventType
            ? and(
                eq(schema.agentEvents.agent_name, agentName),
                eq(schema.agentEvents.event_type, opts.eventType),
              )
            : eq(schema.agentEvents.agent_name, agentName),
        )
        .orderBy(desc(schema.agentEvents.created_at));
      if (opts?.limit) query = query.limit(opts.limit) as typeof query;
      return query.all() as AgentEventRow[];
    },
    async findCausalChain(eventId) {
      // Walk parent_event_id chain iteratively (SQLite has no recursive CTE in Drizzle)
      const chain: AgentEventRow[] = [];
      let currentId: string | null = eventId;
      const visited = new Set<string>();
      while (currentId && !visited.has(currentId)) {
        visited.add(currentId);
        const rows = db
          .select()
          .from(schema.agentEvents)
          .where(eq(schema.agentEvents.event_id, currentId))
          .all() as AgentEventRow[];
        if (rows.length === 0) break;
        const [current] = rows;
        if (!current) break;
        chain.push(current);
        currentId = current.parent_event_id;
      }
      return chain;
    },
    async findRecent(threadId, limit) {
      return db
        .select()
        .from(schema.agentEvents)
        .where(eq(schema.agentEvents.thread_id, threadId))
        .orderBy(desc(schema.agentEvents.created_at))
        .limit(limit)
        .all() as AgentEventRow[];
    },
  };

  // ---------------------------------------------------------------------------
  // Recovery knowledge (persistent learning)
  // ---------------------------------------------------------------------------

  const recoveryKnowledge: RecoveryKnowledgeRepository = {
    async upsert(entry: NewRecoveryKnowledge) {
      const existing = db
        .select()
        .from(schema.recoveryKnowledge)
        .where(
          and(
            eq(schema.recoveryKnowledge.symptom, entry.symptom),
            eq(schema.recoveryKnowledge.cause, entry.cause),
          ),
        )
        .all() as RecoveryKnowledgeRow[];
      if (existing.length > 0) {
        const [current] = existing;
        if (!current) {
          throw new Error('Recovery knowledge lookup returned empty result');
        }
        // Update strategy and config if changed
        db.update(schema.recoveryKnowledge)
          .set({ fix_strategy: entry.fix_strategy, fix_config: entry.fix_config ?? null })
          .where(eq(schema.recoveryKnowledge.knowledge_id, current.knowledge_id))
          .run();
        return {
          ...current,
          fix_strategy: entry.fix_strategy,
          fix_config: entry.fix_config ?? null,
        };
      }
      const row: RecoveryKnowledgeRow = {
        ...entry,
        fix_config: entry.fix_config ?? null,
        success_count: 0,
        failure_count: 0,
        last_used_at: null,
        created_at: now(),
      };
      db.insert(schema.recoveryKnowledge).values(row).run();
      return row;
    },
    async findBySymptom(symptom) {
      return db
        .select()
        .from(schema.recoveryKnowledge)
        .where(eq(schema.recoveryKnowledge.symptom, symptom))
        .all() as RecoveryKnowledgeRow[];
    },
    async findBestFix(symptom) {
      const rows = db
        .select()
        .from(schema.recoveryKnowledge)
        .where(eq(schema.recoveryKnowledge.symptom, symptom))
        .all() as RecoveryKnowledgeRow[];
      if (rows.length === 0) return null;
      // Pick the fix with highest success rate; break ties by most recent use
      return (
        rows.sort((a, b) => {
          const rateA =
            a.success_count + a.failure_count > 0
              ? a.success_count / (a.success_count + a.failure_count)
              : 0.5;
          const rateB =
            b.success_count + b.failure_count > 0
              ? b.success_count / (b.success_count + b.failure_count)
              : 0.5;
          if (rateB !== rateA) return rateB - rateA;
          return (b.last_used_at ?? '').localeCompare(a.last_used_at ?? '');
        })[0] ?? null
      );
    },
    async incrementSuccess(knowledgeId) {
      db.update(schema.recoveryKnowledge)
        .set({
          success_count: sql`success_count + 1`,
          last_used_at: now(),
        })
        .where(eq(schema.recoveryKnowledge.knowledge_id, knowledgeId))
        .run();
    },
    async incrementFailure(knowledgeId) {
      db.update(schema.recoveryKnowledge)
        .set({
          failure_count: sql`failure_count + 1`,
          last_used_at: now(),
        })
        .where(eq(schema.recoveryKnowledge.knowledge_id, knowledgeId))
        .run();
    },
    async findAll(opts) {
      let query = db
        .select()
        .from(schema.recoveryKnowledge)
        .orderBy(desc(schema.recoveryKnowledge.created_at));
      if (opts?.limit) query = query.limit(opts.limit) as typeof query;
      return query.all() as RecoveryKnowledgeRow[];
    },
  };

  // Wraps a synchronous callback in a better-sqlite3 transaction.
  // All repo .run() calls inside fn() participate in the same transaction.
  // db.transaction(fn) for better-sqlite3 executes fn synchronously and returns T.
  const transact = <T>(fn: () => T): T => {
    const result = db.transaction(fn) as unknown as T;
    if (result instanceof Promise) {
      throw new Error(
        'transact() callback must be synchronous — received Promise. Do not use async repo methods inside transact().',
      );
    }
    return result;
  };

  return {
    ...orchestration,
    ...employeesFamily,
    ...conversationsFamily,
    ...llmFamily,
    ...installFamily,
    ...permissionsFamily,
    memories,
    nodeSummaries,
    compactSummaries,
    fileHistory,
    sopTemplates,
    libraryDocuments,
    officeLayouts,
    prefabInstances,
    zones,
    projects,
    projectAssignments,
    agentEvents,
    recoveryKnowledge,
    transact,
  };
}
