// SYNC: This file mirrors packages/core/src/runtime/drizzle-repositories.ts
// but uses `await` on all Drizzle calls (sqlite-proxy returns Promises).
// If you change repository logic in core, update this file too.

import type {
  AgentEventRepository,
  AgentEventRow,
  FileHistoryRepository,
  FileHistoryRow,
  LibraryDocumentRow,
  NewAgentEvent,
  NewFileHistory,
  NewLibraryDocument,
  NewOfficeLayout,
  NewRecoveryKnowledge,
  NewSopTemplate,
  OfficeLayoutRow,
  ProjectRepository,
  RecoveryKnowledgeRepository,
  RecoveryKnowledgeRow,
  RuntimeRepositories,
  SopTemplateRow,
} from '@offisim/core/browser';
import * as schema from '@offisim/db-local';
import { ACTIVE_PROJECT_STATUSES } from '@offisim/shared-types';
import type {
  NewProject,
  NewProjectAssignment,
  ProjectAssignmentRow,
  ProjectRow,
  ProjectStatus,
} from '@offisim/shared-types';
import { and, desc, eq, inArray, like, or, sql } from 'drizzle-orm';
import type { TauriDrizzleDb } from './tauri-drizzle';
import { createConversationsTauriRepos } from './tauri-repos/conversations';
import { createEmployeesTauriRepos } from './tauri-repos/employees';
import { createInstallTauriRepos } from './tauri-repos/install';
import { createLlmTauriRepos } from './tauri-repos/llm';
import { createMemorySystemTauriRepos } from './tauri-repos/memory-system';
import { createOrchestrationTauriRepos } from './tauri-repos/orchestration';
import { createPermissionsTauriRepos } from './tauri-repos/permissions';

function now(): string {
  return new Date().toISOString();
}

/**
 * Create RuntimeRepositories backed by Drizzle sqlite-proxy (async).
 *
 * This mirrors packages/core/src/runtime/drizzle-repositories.ts
 * but uses `await` on all Drizzle calls (sqlite-proxy returns Promises).
 *
 * Unlike the better-sqlite3 runtime, sqlite-proxy cannot safely implement the
 * synchronous `repos.transact(fn)` contract. Callers must use async fallback
 * paths for multi-write flows until transaction orchestration is redesigned for
 * the Tauri driver.
 */
export function createTauriRepositories(db: TauriDrizzleDb): RuntimeRepositories {
  const orchestration = createOrchestrationTauriRepos(db);
  const employeesFamily = createEmployeesTauriRepos(db);
  const conversationsFamily = createConversationsTauriRepos(db);
  const llmFamily = createLlmTauriRepos(db);
  const installFamily = createInstallTauriRepos(db);
  const permissionsFamily = createPermissionsTauriRepos(db);
  const memorySystemFamily = createMemorySystemTauriRepos(db);

  const fileHistory: FileHistoryRepository = {
    async create(entry: NewFileHistory) {
      await db.insert(schema.fileHistory).values(entry);
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
      return (await query) as FileHistoryRow[];
    },
    async listBySnapshot(snapshotId) {
      return (await db
        .select()
        .from(schema.fileHistory)
        .where(eq(schema.fileHistory.snapshot_id, snapshotId))
        .orderBy(schema.fileHistory.created_at)) as FileHistoryRow[];
    },
    async deleteByThread(threadId) {
      await db.delete(schema.fileHistory).where(eq(schema.fileHistory.thread_id, threadId));
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
    async update(sopTemplateId, patch) {
      await db
        .update(schema.sopTemplates)
        .set({ ...patch, updated_at: now() })
        .where(eq(schema.sopTemplates.sop_template_id, sopTemplateId));
    },
    async delete(sopTemplateId) {
      await db
        .delete(schema.sopTemplates)
        .where(eq(schema.sopTemplates.sop_template_id, sopTemplateId));
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
      await db.delete(schema.libraryDocuments).where(eq(schema.libraryDocuments.doc_id, docId));
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
      await db.delete(schema.officeLayouts).where(eq(schema.officeLayouts.layout_id, layoutId));
    },
  };

  const zones: RuntimeRepositories['zones'] = {
    async create(zone) {
      const row = {
        ...zone,
        created_at: now(),
        updated_at: now(),
      };
      await db.insert(schema.zones).values(row);
      return row;
    },
    async findById(zoneId) {
      const rows = await db.select().from(schema.zones).where(eq(schema.zones.zone_id, zoneId));
      return (rows[0] ?? null) as Awaited<ReturnType<RuntimeRepositories['zones']['findById']>>;
    },
    async findByCompany(companyId) {
      return (await db
        .select()
        .from(schema.zones)
        .where(eq(schema.zones.company_id, companyId))) as Awaited<
        ReturnType<RuntimeRepositories['zones']['findByCompany']>
      >;
    },
    async update(zoneId, fields) {
      await db
        .update(schema.zones)
        .set({
          ...fields,
          updated_at: now(),
        })
        .where(eq(schema.zones.zone_id, zoneId));
    },
    async delete(zoneId) {
      await db.delete(schema.zones).where(eq(schema.zones.zone_id, zoneId));
    },
    async deleteByCompany(companyId) {
      await db.delete(schema.zones).where(eq(schema.zones.company_id, companyId));
    },
  };

  // ── Prefab instances ──────────────────────────────────────────────
  const prefabInstances: RuntimeRepositories['prefabInstances'] = {
    async create(instance) {
      await db.insert(schema.prefabInstances).values(instance);
      return instance;
    },
    async findById(instanceId) {
      const rows = await db
        .select()
        .from(schema.prefabInstances)
        .where(eq(schema.prefabInstances.instance_id, instanceId));
      return (rows[0] ?? null) as Awaited<
        ReturnType<RuntimeRepositories['prefabInstances']['findById']>
      >;
    },
    async findByCompanyAndZone(companyId, zoneId) {
      return (await db
        .select()
        .from(schema.prefabInstances)
        .where(
          and(
            eq(schema.prefabInstances.company_id, companyId),
            eq(schema.prefabInstances.zone_id, zoneId),
          ),
        )) as Awaited<ReturnType<RuntimeRepositories['prefabInstances']['findByCompany']>>;
    },
    async findByCompany(companyId) {
      return (await db
        .select()
        .from(schema.prefabInstances)
        .where(eq(schema.prefabInstances.company_id, companyId))) as Awaited<
        ReturnType<RuntimeRepositories['prefabInstances']['findByCompany']>
      >;
    },
    async update(instanceId, fields) {
      await db
        .update(schema.prefabInstances)
        .set({
          ...fields,
          updated_at: new Date().toISOString(),
        })
        .where(eq(schema.prefabInstances.instance_id, instanceId));
    },
    async delete(instanceId) {
      await db
        .delete(schema.prefabInstances)
        .where(eq(schema.prefabInstances.instance_id, instanceId));
    },
    async deleteByCompany(companyId) {
      await db
        .delete(schema.prefabInstances)
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
            inArray(schema.projects.status, [...ACTIVE_PROJECT_STATUSES]),
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

  const projectAssignments: RuntimeRepositories['projectAssignments'] = {
    async assign(assignment: NewProjectAssignment) {
      const row: ProjectAssignmentRow = {
        ...assignment,
        assigned_at: now(),
      };
      await db.insert(schema.projectAssignments).values(row).onConflictDoNothing();

      const rows = await db
        .select()
        .from(schema.projectAssignments)
        .where(
          and(
            eq(schema.projectAssignments.project_id, assignment.project_id),
            eq(schema.projectAssignments.employee_id, assignment.employee_id),
          ),
        );
      return (rows[0] as ProjectAssignmentRow | undefined) ?? row;
    },
    async unassign(projectId, employeeId) {
      await db
        .delete(schema.projectAssignments)
        .where(
          and(
            eq(schema.projectAssignments.project_id, projectId),
            eq(schema.projectAssignments.employee_id, employeeId),
          ),
        );
    },
    async findByProject(projectId) {
      return (await db
        .select()
        .from(schema.projectAssignments)
        .where(eq(schema.projectAssignments.project_id, projectId))) as ProjectAssignmentRow[];
    },
    async findByEmployee(employeeId) {
      return (await db
        .select()
        .from(schema.projectAssignments)
        .where(eq(schema.projectAssignments.employee_id, employeeId))) as ProjectAssignmentRow[];
    },
    async isAssigned(projectId, employeeId) {
      const rows = await db
        .select()
        .from(schema.projectAssignments)
        .where(
          and(
            eq(schema.projectAssignments.project_id, projectId),
            eq(schema.projectAssignments.employee_id, employeeId),
          ),
        );
      return rows.length > 0;
    },
  };

  const agentEvents: AgentEventRepository = {
    async append(event: NewAgentEvent) {
      const row: AgentEventRow = {
        ...event,
        created_at: event.created_at ?? now(),
      };
      await db.insert(schema.agentEvents).values(row);
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
      if (opts?.limit) {
        query = query.limit(opts.limit) as typeof query;
      }
      return (await query) as AgentEventRow[];
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
      if (opts?.limit) {
        query = query.limit(opts.limit) as typeof query;
      }
      return (await query) as AgentEventRow[];
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
      if (opts?.limit) {
        query = query.limit(opts.limit) as typeof query;
      }
      return (await query) as AgentEventRow[];
    },
    async findCausalChain(eventId) {
      const chain: AgentEventRow[] = [];
      let currentId: string | null = eventId;
      const visited = new Set<string>();

      while (currentId && !visited.has(currentId)) {
        visited.add(currentId);
        const rows = (await db
          .select()
          .from(schema.agentEvents)
          .where(eq(schema.agentEvents.event_id, currentId))) as AgentEventRow[];
        if (rows.length === 0) {
          break;
        }
        const [current] = rows;
        if (!current) {
          break;
        }
        chain.push(current);
        currentId = current.parent_event_id;
      }

      return chain;
    },
    async findRecent(threadId, limit) {
      return (await db
        .select()
        .from(schema.agentEvents)
        .where(eq(schema.agentEvents.thread_id, threadId))
        .orderBy(desc(schema.agentEvents.created_at))
        .limit(limit)) as AgentEventRow[];
    },
  };

  const recoveryKnowledge: RecoveryKnowledgeRepository = {
    async upsert(entry: NewRecoveryKnowledge) {
      const existing = (await db
        .select()
        .from(schema.recoveryKnowledge)
        .where(
          and(
            eq(schema.recoveryKnowledge.symptom, entry.symptom),
            eq(schema.recoveryKnowledge.cause, entry.cause),
          ),
        )) as RecoveryKnowledgeRow[];

      if (existing.length > 0) {
        const [current] = existing;
        if (!current) {
          throw new Error('Recovery knowledge lookup returned empty result');
        }

        await db
          .update(schema.recoveryKnowledge)
          .set({ fix_strategy: entry.fix_strategy, fix_config: entry.fix_config ?? null })
          .where(eq(schema.recoveryKnowledge.knowledge_id, current.knowledge_id));

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
      await db.insert(schema.recoveryKnowledge).values(row);
      return row;
    },
    async findBySymptom(symptom) {
      return (await db
        .select()
        .from(schema.recoveryKnowledge)
        .where(eq(schema.recoveryKnowledge.symptom, symptom))) as RecoveryKnowledgeRow[];
    },
    async findBestFix(symptom) {
      const rows = (await db
        .select()
        .from(schema.recoveryKnowledge)
        .where(eq(schema.recoveryKnowledge.symptom, symptom))) as RecoveryKnowledgeRow[];
      if (rows.length === 0) {
        return null;
      }
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
          if (rateB !== rateA) {
            return rateB - rateA;
          }
          return (b.last_used_at ?? '').localeCompare(a.last_used_at ?? '');
        })[0] ?? null
      );
    },
    async incrementSuccess(knowledgeId) {
      await db
        .update(schema.recoveryKnowledge)
        .set({
          success_count: sql`success_count + 1`,
          last_used_at: now(),
        })
        .where(eq(schema.recoveryKnowledge.knowledge_id, knowledgeId));
    },
    async incrementFailure(knowledgeId) {
      await db
        .update(schema.recoveryKnowledge)
        .set({
          failure_count: sql`failure_count + 1`,
          last_used_at: now(),
        })
        .where(eq(schema.recoveryKnowledge.knowledge_id, knowledgeId));
    },
    async findAll(opts) {
      let query = db
        .select()
        .from(schema.recoveryKnowledge)
        .orderBy(desc(schema.recoveryKnowledge.created_at));
      if (opts?.limit) {
        query = query.limit(opts.limit) as typeof query;
      }
      return (await query) as RecoveryKnowledgeRow[];
    },
  };

  return {
    ...orchestration,
    ...employeesFamily,
    ...conversationsFamily,
    ...llmFamily,
    ...installFamily,
    ...permissionsFamily,
    ...memorySystemFamily,
    fileHistory,
    sopTemplates,
    libraryDocuments,
    officeLayouts,
    zones,
    prefabInstances,
    projects,
    projectAssignments,
    agentEvents,
    recoveryKnowledge,
  };
}
