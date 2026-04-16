import { ACTIVE_PROJECT_STATUSES } from '@offisim/shared-types';
import type {
  NewProject,
  NewProjectAssignment,
  ProjectAssignmentRow,
  ProjectRow,
  ProjectStatus,
  ZoneRow,
} from '@offisim/shared-types';
import type { NewZone, ZoneRepository } from '../repos/zone-repository.js';
import { createMemoryPrefabRepository } from './memory-prefab-repository.js';
import { createConversationsMemoryRepos } from './repos/conversations/memory.js';
import { createEmployeesMemoryRepos } from './repos/employees/memory.js';
import { createInstallMemoryRepos } from './repos/install/memory.js';
import { createLlmMemoryRepos } from './repos/llm/memory.js';
import { createMemorySystemMemoryRepos } from './repos/memory-system/memory.js';
import { createOrchestrationMemoryRepos } from './repos/orchestration/memory.js';
import { createPermissionsMemoryRepos } from './repos/permissions/memory.js';
export {
  MemoryActiveInteractionRepository,
  MemoryHandoffRepository,
  MemoryInteractionHistoryRepository,
  MemoryMeetingRepository,
  MemoryToolCallRepository,
} from './repos/conversations/memory.js';
export {
  MemoryEmployeeRepository,
  MemoryEmployeeVersionRepository,
} from './repos/employees/memory.js';
export {
  MemoryAssetBindingRepository,
  MemoryInstallTransactionRepository,
  MemoryInstalledAssetRepository,
  MemoryInstalledPackageRepository,
} from './repos/install/memory.js';
export {
  MemoryLlmCallRepository,
  MemoryModelCostRateRepository,
} from './repos/llm/memory.js';
export {
  MemoryCompactSummaryRepository,
  MemoryNodeSummaryRepository,
} from './repos/memory-system/memory.js';
export {
  MemoryCheckpointRepository,
  MemoryCompanyRepository,
  MemoryEventRepository,
  MemoryTaskRunRepository,
  MemoryThreadRepository,
} from './repos/orchestration/memory.js';
export {
  MemoryMcpAuditRepository,
  MemoryRackRepository,
  MemorySlotRepository,
  MemoryWorkstationRackRepository,
} from './repos/permissions/memory.js';
import type {
  MemoryRepositoriesSnapshot,
  MemoryRepositorySeed,
} from './repos/memory-types.js';
import type {
  AgentEventRepository,
  AgentEventRow,
  FileHistoryRepository,
  FileHistoryRow,
  LibraryDocumentRepository,
  LibraryDocumentRow,
  NewAgentEvent,
  NewLibraryDocument,
  NewOfficeLayout,
  NewRecoveryKnowledge,
  NewSopTemplate,
  OfficeLayoutRepository,
  OfficeLayoutRow,
  ProjectAssignmentRepository,
  ProjectRepository,
  RecoveryKnowledgeRepository,
  RecoveryKnowledgeRow,
  RuntimeRepositories,
  SopTemplateRepository,
  SopTemplateRow,
} from './repositories.js';

function now(): string {
  return new Date().toISOString();
}

export type { MemoryRepositorySeed, MemoryRepositoriesSnapshot } from './repos/memory-types.js';

function cloneRows<T extends object>(rows: Iterable<T>): T[] {
  return [...rows].map((row) => ({ ...row }));
}

export function createMemoryRepositories(
  snapshot?: Partial<MemoryRepositoriesSnapshot>,
): RuntimeRepositories & { seed: MemoryRepositorySeed; snapshot(): MemoryRepositoriesSnapshot } {
  const orchestration = createOrchestrationMemoryRepos(snapshot);
  const { companies, threads, taskRuns, checkpoints, events } = orchestration;

  const employeesFamily = createEmployeesMemoryRepos(snapshot);
  const { employees, employeeVersions } = employeesFamily;
  const conversationsFamily = createConversationsMemoryRepos(snapshot);
  const { toolCalls, handoffs, meetings, activeInteractions, interactionHistory } =
    conversationsFamily;
  const llmFamily = createLlmMemoryRepos(snapshot);
  const { llmCalls, costRates } = llmFamily;
  const installRepos = createInstallMemoryRepos(snapshot);
  const permissionsFamily = createPermissionsMemoryRepos(snapshot);
  const { racks: racksRepo, slots: slotsRepo, workstationRacks: workstationRacksRepo, mcpAudit } =
    permissionsFamily;
  const memorySystemFamily = createMemorySystemMemoryRepos(snapshot);
  const { memories, userPreferences, nodeSummaries, compactSummaries } = memorySystemFamily;

  const seed: MemoryRepositorySeed = {
    employees(rows) {
      employees.seed(rows);
    },
    companies(rows) {
      orchestration.companies.seed(rows);
    },
  };

  const fileHistory = new MemoryFileHistoryRepository(snapshot?.fileHistory);
  const sopTemplates = new MemorySopTemplateRepository(snapshot?.sopTemplates);
  const libraryDocuments = new MemoryLibraryDocumentRepository(snapshot?.libraryDocuments);
  const officeLayouts = new MemoryOfficeLayoutRepository(snapshot?.officeLayouts);
  const zonesRepo = new MemoryZoneRepository(snapshot?.zones);
  const prefabInstances = createMemoryPrefabRepository(snapshot?.prefabInstances);
  const projects = new MemoryProjectRepository(snapshot?.projects);
  const projectAssignments = new MemoryProjectAssignmentRepository(snapshot?.projectAssignments);
  const agentEventsRepo = new MemoryAgentEventRepository(snapshot?.agentEvents);
  const recoveryKnowledgeRepo = new MemoryRecoveryKnowledgeRepository(snapshot?.recoveryKnowledge);

  const repositories = {
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
    userPreferences,
    mcpAudit,
    nodeSummaries,
    compactSummaries,
    activeInteractions,
    interactionHistory,
    fileHistory,
    employeeVersions,
    costRates,
    sopTemplates,
    racks: racksRepo,
    slots: slotsRepo,
    workstationRacks: workstationRacksRepo,
    libraryDocuments,
    officeLayouts,
    zones: zonesRepo,
    prefabInstances,
    projects,
    projectAssignments,
    agentEvents: agentEventsRepo,
    recoveryKnowledge: recoveryKnowledgeRepo,
    ...installRepos,
    seed,
    snapshot(): MemoryRepositoriesSnapshot {
      return {
        companies: orchestration.companies.snapshot(),
        threads: orchestration.threads.snapshot(),
        taskRuns: orchestration.taskRuns.snapshot(),
        employees: employees.snapshot(),
        toolCalls: toolCalls.snapshot(),
        handoffs: handoffs.snapshot(),
        meetings: meetings.snapshot(),
        checkpoints: orchestration.checkpoints.snapshot(),
        events: orchestration.events.snapshot(),
        llmCalls: llmCalls.snapshot(),
        memories: memories.snapshot(),
        userPreferences: userPreferences.snapshot(),
        mcpAudit: mcpAudit.snapshot(),
        nodeSummaries: nodeSummaries.snapshot(),
        compactSummaries: compactSummaries.snapshot(),
        activeInteractions: activeInteractions.snapshot(),
        interactionHistory: interactionHistory.snapshot(),
        fileHistory: fileHistory.snapshot(),
        employeeVersions: employeeVersions.snapshot(),
        costRates: costRates.snapshot(),
        sopTemplates: sopTemplates.snapshot(),
        racks: racksRepo.snapshot(),
        slots: slotsRepo.snapshot(),
        workstationRacks: workstationRacksRepo.snapshot(),
        libraryDocuments: libraryDocuments.snapshot(),
        officeLayouts: officeLayouts.snapshot(),
        zones: zonesRepo.snapshot(),
        prefabInstances: prefabInstances.snapshot(),
        projects: projects.snapshot(),
        projectAssignments: projectAssignments.snapshot(),
        agentEvents: agentEventsRepo.snapshot(),
        recoveryKnowledge: recoveryKnowledgeRepo.snapshot(),
        installTransactions: installRepos.installTransactions.snapshot(),
        installedPackages: installRepos.installedPackages.snapshot(),
        installedAssets: installRepos.installedAssets.snapshot(),
        assetBindings: installRepos.assetBindings.snapshot(),
      };
    },
  };

  return repositories;
}

export class MemorySopTemplateRepository implements SopTemplateRepository {
  private readonly store = new Map<string, SopTemplateRow>();

  constructor(initialRows?: Iterable<SopTemplateRow>) {
    if (!initialRows) return;
    for (const row of initialRows) {
      this.store.set(row.sop_template_id, { ...row });
    }
  }

  async create(template: NewSopTemplate): Promise<SopTemplateRow> {
    const row: SopTemplateRow = {
      ...template,
      created_at: new Date().toISOString(),
      updated_at: new Date().toISOString(),
    };
    this.store.set(row.sop_template_id, row);
    return row;
  }

  async findById(sopTemplateId: string): Promise<SopTemplateRow | null> {
    return this.store.get(sopTemplateId) ?? null;
  }

  async findByCompany(companyId: string): Promise<SopTemplateRow[]> {
    return [...this.store.values()].filter((r) => r.company_id === companyId);
  }

  async update(
    sopTemplateId: string,
    patch: import('./repositories.js').SopTemplateUpdate,
  ): Promise<void> {
    const existing = this.store.get(sopTemplateId);
    if (!existing) return;
    this.store.set(sopTemplateId, {
      ...existing,
      ...patch,
      updated_at: new Date().toISOString(),
    });
  }

  async delete(sopTemplateId: string): Promise<void> {
    this.store.delete(sopTemplateId);
  }

  snapshot(): SopTemplateRow[] {
    return cloneRows(this.store.values());
  }
}

export class MemoryLibraryDocumentRepository implements LibraryDocumentRepository {
  private readonly store = new Map<string, LibraryDocumentRow>();

  constructor(initialRows?: Iterable<LibraryDocumentRow>) {
    if (!initialRows) return;
    for (const row of initialRows) {
      this.store.set(row.doc_id, { ...row });
    }
  }

  async create(doc: NewLibraryDocument): Promise<LibraryDocumentRow> {
    const row: LibraryDocumentRow = {
      ...doc,
      created_at: new Date().toISOString(),
      updated_at: new Date().toISOString(),
    };
    this.store.set(row.doc_id, row);
    return row;
  }

  async findById(docId: string): Promise<LibraryDocumentRow | null> {
    return this.store.get(docId) ?? null;
  }

  async findByCompany(companyId: string): Promise<LibraryDocumentRow[]> {
    return [...this.store.values()]
      .filter((d) => d.company_id === companyId)
      .sort((a, b) => b.created_at.localeCompare(a.created_at));
  }

  async search(
    companyId: string,
    query: string,
    opts?: { limit?: number },
  ): Promise<LibraryDocumentRow[]> {
    const q = query.toLowerCase();
    let results = [...this.store.values()].filter(
      (d) =>
        d.company_id === companyId &&
        (d.title.toLowerCase().includes(q) || d.content_text.toLowerCase().includes(q)),
    );
    results.sort((a, b) => b.created_at.localeCompare(a.created_at));
    if (opts?.limit) results = results.slice(0, opts.limit);
    return results;
  }

  async delete(docId: string): Promise<void> {
    this.store.delete(docId);
  }

  snapshot(): LibraryDocumentRow[] {
    return cloneRows(this.store.values());
  }
}

export class MemoryOfficeLayoutRepository implements OfficeLayoutRepository {
  private readonly store = new Map<string, OfficeLayoutRow>();

  constructor(initialRows?: Iterable<OfficeLayoutRow>) {
    if (!initialRows) return;
    for (const row of initialRows) {
      this.store.set(row.layout_id, { ...row });
    }
  }

  async create(layout: NewOfficeLayout): Promise<OfficeLayoutRow> {
    const row: OfficeLayoutRow = {
      ...layout,
      created_at: new Date().toISOString(),
      updated_at: new Date().toISOString(),
    };
    this.store.set(row.layout_id, row);
    return row;
  }
  async findById(layoutId: string): Promise<OfficeLayoutRow | null> {
    return this.store.get(layoutId) ?? null;
  }
  async findByCompany(companyId: string): Promise<OfficeLayoutRow[]> {
    return [...this.store.values()].filter((l) => l.company_id === companyId);
  }
  async findActive(companyId: string): Promise<OfficeLayoutRow | null> {
    return (
      [...this.store.values()].find((l) => l.company_id === companyId && l.is_active === 1) ?? null
    );
  }
  async setActive(companyId: string, layoutId: string): Promise<void> {
    for (const [id, row] of this.store.entries()) {
      if (row.company_id === companyId) {
        this.store.set(id, {
          ...row,
          is_active: id === layoutId ? 1 : 0,
          updated_at: new Date().toISOString(),
        });
      }
    }
  }
  async update(
    layoutId: string,
    patch: Partial<Pick<OfficeLayoutRow, 'name' | 'layout_json'>>,
  ): Promise<void> {
    const row = this.store.get(layoutId);
    if (row) this.store.set(layoutId, { ...row, ...patch, updated_at: new Date().toISOString() });
  }
  async delete(layoutId: string): Promise<void> {
    this.store.delete(layoutId);
  }

  snapshot(): OfficeLayoutRow[] {
    return cloneRows(this.store.values());
  }
}

export class MemoryZoneRepository implements ZoneRepository {
  private readonly store = new Map<string, ZoneRow>();

  constructor(initialRows?: Iterable<ZoneRow>) {
    if (!initialRows) return;
    for (const row of initialRows) {
      this.store.set(row.zone_id, { ...row });
    }
  }

  async create(zone: NewZone): Promise<ZoneRow> {
    const row: ZoneRow = { ...zone, created_at: now(), updated_at: now() };
    this.store.set(row.zone_id, row);
    return row;
  }
  async findById(zoneId: string): Promise<ZoneRow | null> {
    return this.store.get(zoneId) ?? null;
  }
  async findByCompany(companyId: string): Promise<ZoneRow[]> {
    return [...this.store.values()].filter((z) => z.company_id === companyId);
  }
  async update(
    zoneId: string,
    fields: Partial<
      Pick<
        ZoneRow,
        | 'label'
        | 'accent_color'
        | 'floor_color'
        | 'cx'
        | 'cz'
        | 'w'
        | 'd'
        | 'target_roles_json'
        | 'allowed_categories_json'
        | 'activity_types_json'
        | 'desk_slots'
        | 'sort_order'
        | 'archetype'
      >
    >,
  ): Promise<void> {
    const row = this.store.get(zoneId);
    if (row) this.store.set(zoneId, { ...row, ...fields, updated_at: now() });
  }
  async delete(zoneId: string): Promise<void> {
    this.store.delete(zoneId);
  }
  async deleteByCompany(companyId: string): Promise<void> {
    for (const [id, row] of this.store.entries()) {
      if (row.company_id === companyId) this.store.delete(id);
    }
  }

  snapshot(): ZoneRow[] {
    return cloneRows(this.store.values());
  }
}

export class MemoryFileHistoryRepository implements FileHistoryRepository {
  private readonly rows: FileHistoryRow[] = [];

  constructor(initialRows?: Iterable<FileHistoryRow>) {
    if (!initialRows) return;
    this.rows.push(...cloneRows(initialRows));
  }

  async create(entry: FileHistoryRow): Promise<FileHistoryRow> {
    this.rows.push(entry);
    return entry;
  }

  async listByThread(threadId: string, opts?: { limit?: number }): Promise<FileHistoryRow[]> {
    const rows = this.rows
      .filter((row) => row.thread_id === threadId)
      .sort((a, b) => b.created_at.localeCompare(a.created_at));
    return opts?.limit ? rows.slice(0, opts.limit) : rows;
  }

  async listBySnapshot(snapshotId: string): Promise<FileHistoryRow[]> {
    return this.rows
      .filter((row) => row.snapshot_id === snapshotId)
      .sort((a, b) => a.created_at.localeCompare(b.created_at));
  }

  async deleteByThread(threadId: string): Promise<void> {
    for (let index = this.rows.length - 1; index >= 0; index--) {
      if (this.rows[index]?.thread_id === threadId) {
        this.rows.splice(index, 1);
      }
    }
  }

  snapshot(): FileHistoryRow[] {
    return cloneRows(this.rows);
  }
}

export class MemoryProjectRepository implements ProjectRepository {
  private readonly store = new Map<string, ProjectRow>();

  constructor(initialRows?: Iterable<ProjectRow>) {
    if (!initialRows) return;
    for (const row of initialRows) {
      this.store.set(row.project_id, { ...row });
    }
  }

  async create(project: NewProject): Promise<ProjectRow> {
    const row: ProjectRow = {
      ...project,
      created_at: new Date().toISOString(),
      updated_at: new Date().toISOString(),
    };
    this.store.set(row.project_id, row);
    return row;
  }

  async findById(projectId: string): Promise<ProjectRow | null> {
    return this.store.get(projectId) ?? null;
  }

  async findByCompany(companyId: string): Promise<ProjectRow[]> {
    return [...this.store.values()]
      .filter((p) => p.company_id === companyId)
      .sort((a, b) => b.updated_at.localeCompare(a.updated_at));
  }

  async findActiveByCompany(companyId: string): Promise<ProjectRow[]> {
    return [...this.store.values()]
      .filter(
        (p) =>
          p.company_id === companyId &&
          (ACTIVE_PROJECT_STATUSES as readonly string[]).includes(p.status),
      )
      .sort((a, b) => b.updated_at.localeCompare(a.updated_at));
  }

  async updateStatus(projectId: string, status: ProjectStatus): Promise<void> {
    const row = this.store.get(projectId);
    if (row) {
      this.store.set(projectId, { ...row, status, updated_at: new Date().toISOString() });
    }
  }

  async update(
    projectId: string,
    patch: Partial<Pick<ProjectRow, 'name' | 'description' | 'status'>>,
  ): Promise<void> {
    const row = this.store.get(projectId);
    if (row) {
      this.store.set(projectId, { ...row, ...patch, updated_at: new Date().toISOString() });
    }
  }

  async delete(projectId: string): Promise<void> {
    this.store.delete(projectId);
  }

  snapshot(): ProjectRow[] {
    return cloneRows(this.store.values());
  }
}

export class MemoryProjectAssignmentRepository implements ProjectAssignmentRepository {
  private readonly store = new Map<string, ProjectAssignmentRow>();

  constructor(initialRows?: Iterable<ProjectAssignmentRow>) {
    if (!initialRows) return;
    for (const row of initialRows) {
      this.store.set(this.key(row.project_id, row.employee_id), { ...row });
    }
  }

  private key(projectId: string, employeeId: string): string {
    return `${projectId}::${employeeId}`;
  }

  async assign(assignment: NewProjectAssignment): Promise<ProjectAssignmentRow> {
    const key = this.key(assignment.project_id, assignment.employee_id);
    const existing = this.store.get(key);
    if (existing) return existing;
    const row: ProjectAssignmentRow = {
      ...assignment,
      assigned_at: new Date().toISOString(),
    };
    this.store.set(key, row);
    return row;
  }

  async unassign(projectId: string, employeeId: string): Promise<void> {
    this.store.delete(this.key(projectId, employeeId));
  }

  async findByProject(projectId: string): Promise<ProjectAssignmentRow[]> {
    return [...this.store.values()].filter((a) => a.project_id === projectId);
  }

  async findByEmployee(employeeId: string): Promise<ProjectAssignmentRow[]> {
    return [...this.store.values()].filter((a) => a.employee_id === employeeId);
  }

  async isAssigned(projectId: string, employeeId: string): Promise<boolean> {
    return this.store.has(this.key(projectId, employeeId));
  }

  snapshot(): ProjectAssignmentRow[] {
    return cloneRows(this.store.values());
  }
}

// ---------------------------------------------------------------------------
// Agent events (event sourcing) — memory implementation
// ---------------------------------------------------------------------------

export class MemoryAgentEventRepository implements AgentEventRepository {
  private readonly rows: AgentEventRow[] = [];

  constructor(initialRows?: Iterable<AgentEventRow>) {
    if (!initialRows) return;
    this.rows.push(...cloneRows(initialRows));
  }

  async append(event: NewAgentEvent): Promise<AgentEventRow> {
    const row: AgentEventRow = {
      ...event,
      created_at: event.created_at ?? new Date().toISOString(),
    };
    this.rows.push(row);
    return row;
  }

  async findByProject(
    projectId: string,
    opts?: { limit?: number; eventType?: string },
  ): Promise<AgentEventRow[]> {
    let results = this.rows
      .filter(
        (r) => r.project_id === projectId && (!opts?.eventType || r.event_type === opts.eventType),
      )
      .sort((a, b) => b.created_at.localeCompare(a.created_at));
    if (opts?.limit) results = results.slice(0, opts.limit);
    return results;
  }

  async findByThread(
    threadId: string,
    opts?: { limit?: number; eventType?: string },
  ): Promise<AgentEventRow[]> {
    let results = this.rows
      .filter(
        (r) => r.thread_id === threadId && (!opts?.eventType || r.event_type === opts.eventType),
      )
      .sort((a, b) => b.created_at.localeCompare(a.created_at));
    if (opts?.limit) results = results.slice(0, opts.limit);
    return results;
  }

  async findByAgent(
    agentName: string,
    opts?: { limit?: number; eventType?: string },
  ): Promise<AgentEventRow[]> {
    let results = this.rows
      .filter(
        (r) => r.agent_name === agentName && (!opts?.eventType || r.event_type === opts.eventType),
      )
      .sort((a, b) => b.created_at.localeCompare(a.created_at));
    if (opts?.limit) results = results.slice(0, opts.limit);
    return results;
  }

  async findCausalChain(eventId: string): Promise<AgentEventRow[]> {
    const chain: AgentEventRow[] = [];
    let currentId: string | null = eventId;
    const visited = new Set<string>();
    while (currentId && !visited.has(currentId)) {
      visited.add(currentId);
      const found = this.rows.find((r) => r.event_id === currentId);
      if (!found) break;
      chain.push(found);
      currentId = found.parent_event_id;
    }
    return chain;
  }

  async findRecent(threadId: string, limit: number): Promise<AgentEventRow[]> {
    return this.rows
      .filter((r) => r.thread_id === threadId)
      .sort((a, b) => b.created_at.localeCompare(a.created_at))
      .slice(0, limit);
  }

  snapshot(): AgentEventRow[] {
    return cloneRows(this.rows);
  }
}

// ---------------------------------------------------------------------------
// Recovery knowledge — memory implementation
// ---------------------------------------------------------------------------

export class MemoryRecoveryKnowledgeRepository implements RecoveryKnowledgeRepository {
  private readonly store = new Map<string, RecoveryKnowledgeRow>();

  constructor(initialRows?: Iterable<RecoveryKnowledgeRow>) {
    if (!initialRows) return;
    for (const row of initialRows) {
      this.store.set(`${row.symptom}::${row.cause}`, { ...row });
    }
  }

  async upsert(entry: NewRecoveryKnowledge): Promise<RecoveryKnowledgeRow> {
    const key = `${entry.symptom}::${entry.cause}`;
    const existing = this.store.get(key);
    if (existing) {
      const updated = {
        ...existing,
        fix_strategy: entry.fix_strategy,
        fix_config: entry.fix_config ?? null,
      };
      this.store.set(key, updated);
      return updated;
    }
    const row: RecoveryKnowledgeRow = {
      ...entry,
      fix_config: entry.fix_config ?? null,
      success_count: 0,
      failure_count: 0,
      last_used_at: null,
      created_at: new Date().toISOString(),
    };
    this.store.set(key, row);
    return row;
  }

  async findBySymptom(symptom: string): Promise<RecoveryKnowledgeRow[]> {
    return [...this.store.values()].filter((r) => r.symptom === symptom);
  }

  async findBestFix(symptom: string): Promise<RecoveryKnowledgeRow | null> {
    const matches = [...this.store.values()].filter((r) => r.symptom === symptom);
    if (matches.length === 0) return null;
    return (
      matches.sort((a, b) => {
        const rateA =
          a.success_count + a.failure_count > 0
            ? a.success_count / (a.success_count + a.failure_count)
            : 0.5;
        const rateB =
          b.success_count + b.failure_count > 0
            ? b.success_count / (b.success_count + b.failure_count)
            : 0.5;
        return rateB - rateA;
      })[0] ?? null
    );
  }

  async incrementSuccess(knowledgeId: string): Promise<void> {
    for (const [key, row] of this.store.entries()) {
      if (row.knowledge_id === knowledgeId) {
        this.store.set(key, {
          ...row,
          success_count: row.success_count + 1,
          last_used_at: new Date().toISOString(),
        });
        return;
      }
    }
  }

  async incrementFailure(knowledgeId: string): Promise<void> {
    for (const [key, row] of this.store.entries()) {
      if (row.knowledge_id === knowledgeId) {
        this.store.set(key, {
          ...row,
          failure_count: row.failure_count + 1,
          last_used_at: new Date().toISOString(),
        });
        return;
      }
    }
  }

  async findAll(opts?: { limit?: number }): Promise<RecoveryKnowledgeRow[]> {
    let results = [...this.store.values()].sort((a, b) => b.created_at.localeCompare(a.created_at));
    if (opts?.limit) results = results.slice(0, opts.limit);
    return results;
  }

  snapshot(): RecoveryKnowledgeRow[] {
    return cloneRows(this.store.values());
  }
}
