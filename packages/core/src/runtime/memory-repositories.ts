import type { NewEmployee } from '@offisim/install-core';
import { ACTIVE_PROJECT_STATUSES } from '@offisim/shared-types';
import type {
  NewProject,
  NewProjectAssignment,
  ProjectAssignmentRow,
  ProjectRow,
  ProjectStatus,
  RoleSlug,
  ZoneRow,
} from '@offisim/shared-types';
import type { NewZone, ZoneRepository } from '../repos/zone-repository.js';
import { InMemoryMemoryRepository } from '../repositories/memory-memory-repository.js';
import { MemoryUserPreferenceRepository } from '../repositories/memory-user-preference-repository.js';
import { matchCostRate } from '../utils/glob-match.js';
import type { MemoryInstallRepositoriesSnapshot } from './memory-install-repos.js';
import { createMemoryInstallRepositories } from './memory-install-repos.js';
import { createMemoryPrefabRepository } from './memory-prefab-repository.js';
import type {
  ActiveInteractionRepository,
  AgentEventRepository,
  AgentEventRow,
  CheckpointRepository,
  CompactSummaryRepository,
  CompactSummaryRow,
  CompanyRepository,
  CompanyRow,
  EmployeeRepository,
  EmployeeRow,
  EmployeeVersionRepository,
  EmployeeVersionRow,
  EventRepository,
  FileHistoryRepository,
  FileHistoryRow,
  GraphCheckpointRow,
  GraphThreadRow,
  HandoffEventRow,
  HandoffRepository,
  InteractionActiveRow,
  InteractionHistoryRepository,
  InteractionHistoryRow,
  LibraryDocumentRepository,
  LibraryDocumentRow,
  LlmCallRepository,
  LlmCallRow,
  McpAuditRepository,
  McpAuditRow,
  MeetingRepository,
  MeetingSessionRow,
  ModelCostRateRepository,
  ModelCostRateRow,
  NewAgentEvent,
  NewCompactSummary,
  NewEmployeeVersion,
  NewGraphCheckpoint,
  NewGraphThread,
  NewHandoffEvent,
  NewInteractionActive,
  NewInteractionHistory,
  NewLibraryDocument,
  NewLlmCall,
  NewMcpAudit,
  NewMeetingSession,
  NewModelCostRate,
  NewNodeSummary,
  NewOfficeLayout,
  NewRack,
  NewRecoveryKnowledge,
  NewRuntimeEvent,
  NewSlot,
  NewSopTemplate,
  NewTaskRun,
  NewToolCall,
  NewWorkstationRack,
  NodeSummaryRepository,
  NodeSummaryRow,
  OfficeLayoutRepository,
  OfficeLayoutRow,
  ProjectAssignmentRepository,
  ProjectRepository,
  RackRepository,
  RackRow,
  RecoveryKnowledgeRepository,
  RecoveryKnowledgeRow,
  RuntimeRepositories,
  SlotRepository,
  SlotRow,
  SopTemplateRepository,
  SopTemplateRow,
  TaskRunRepository,
  TaskRunRow,
  ThreadRepository,
  ToolCallRepository,
  ToolCallRow,
  UserPreferenceRow,
  WorkstationRackRepository,
  WorkstationRackRow,
} from './repositories.js';

function now(): string {
  return new Date().toISOString();
}

export interface MemoryRepositorySeed {
  employees(rows: EmployeeRow[]): void;
  companies(rows: CompanyRow[]): void;
}

export interface MemoryRepositoriesSnapshot extends MemoryInstallRepositoriesSnapshot {
  threads: GraphThreadRow[];
  taskRuns: TaskRunRow[];
  employees: EmployeeRow[];
  companies: CompanyRow[];
  toolCalls: ToolCallRow[];
  handoffs: HandoffEventRow[];
  meetings: MeetingSessionRow[];
  checkpoints: GraphCheckpointRow[];
  events: NewRuntimeEvent[];
  llmCalls: LlmCallRow[];
  memories: ReturnType<InMemoryMemoryRepository['snapshot']>;
  userPreferences: UserPreferenceRow[];
  mcpAudit: McpAuditRow[];
  nodeSummaries: NodeSummaryRow[];
  compactSummaries: CompactSummaryRow[];
  activeInteractions: InteractionActiveRow[];
  interactionHistory: InteractionHistoryRow[];
  fileHistory: FileHistoryRow[];
  employeeVersions: EmployeeVersionRow[];
  costRates: ModelCostRateRow[];
  sopTemplates: SopTemplateRow[];
  racks: RackRow[];
  slots: SlotRow[];
  workstationRacks: WorkstationRackRow[];
  libraryDocuments: LibraryDocumentRow[];
  officeLayouts: OfficeLayoutRow[];
  zones: ZoneRow[];
  prefabInstances: ReturnType<ReturnType<typeof createMemoryPrefabRepository>['snapshot']>;
  projects: ProjectRow[];
  projectAssignments: ProjectAssignmentRow[];
  agentEvents: AgentEventRow[];
  recoveryKnowledge: RecoveryKnowledgeRow[];
}

function cloneRows<T extends object>(rows: Iterable<T>): T[] {
  return [...rows].map((row) => ({ ...row }));
}

function createRowMap<Row extends object>(
  rows: Iterable<Row> | undefined,
  key: keyof Row,
): Map<string, Row> {
  const map = new Map<string, Row>();
  if (!rows) return map;
  for (const row of rows) {
    const id = row[key] as unknown;
    if (typeof id === 'string') {
      map.set(id, { ...row });
    }
  }
  return map;
}

export function createMemoryRepositories(
  snapshot?: Partial<MemoryRepositoriesSnapshot>,
): RuntimeRepositories & { seed: MemoryRepositorySeed; snapshot(): MemoryRepositoriesSnapshot } {
  const threadsMap = createRowMap(snapshot?.threads, 'thread_id');
  const taskRunsMap = createRowMap(snapshot?.taskRuns, 'task_run_id');
  const employeesMap = createRowMap(snapshot?.employees, 'employee_id');
  const companiesMap = createRowMap(snapshot?.companies, 'company_id');
  const toolCallsMap = createRowMap(snapshot?.toolCalls, 'tool_call_id');
  const handoffsMap = createRowMap(snapshot?.handoffs, 'handoff_id');
  const meetingsMap = createRowMap(snapshot?.meetings, 'meeting_id');
  const checkpointsMap = createRowMap(snapshot?.checkpoints, 'checkpoint_id');
  const eventsStore: NewRuntimeEvent[] = cloneRows(snapshot?.events ?? []);
  const llmCallsMap = createRowMap(snapshot?.llmCalls, 'llm_call_id');

  function withThreadDefaults(row: GraphThreadRow): GraphThreadRow {
    return {
      ...row,
      interaction_mode: row.interaction_mode ?? 'boss_proxy',
    };
  }

  const companies: CompanyRepository = {
    async findById(id) {
      return companiesMap.get(id) ?? null;
    },
    async findAll() {
      return [...companiesMap.values()];
    },
    async create(company) {
      companiesMap.set(company.company_id, company);
      return company;
    },
    async update(companyId, fields) {
      const row = companiesMap.get(companyId);
      if (row) {
        companiesMap.set(companyId, { ...row, ...fields, updated_at: now() });
      }
    },
  };

  const threads: ThreadRepository = {
    async create(t: NewGraphThread) {
      const row: GraphThreadRow = {
        ...t,
        project_id: t.project_id ?? null,
        interaction_mode: t.interaction_mode ?? 'boss_proxy',
        synopsis_json: t.synopsis_json ?? null,
        compact_baseline_json: t.compact_baseline_json ?? null,
        created_at: now(),
        updated_at: now(),
      };
      threadsMap.set(row.thread_id, row);
      return row;
    },
    async findById(id) {
      const row = threadsMap.get(id);
      return row ? withThreadDefaults(row) : null;
    },
    async findByCompany(companyId, opts) {
      let results = [...threadsMap.values()]
        .map(withThreadDefaults)
        .filter((t) => t.company_id === companyId);
      if (opts?.status) results = results.filter((t) => t.status === opts.status);
      results.sort((a, b) => b.created_at.localeCompare(a.created_at));
      if (opts?.limit) results = results.slice(0, opts.limit);
      return results;
    },
    async findByCompanyAndStatus(companyId, status) {
      return [...threadsMap.values()]
        .map(withThreadDefaults)
        .filter((t) => t.company_id === companyId && t.status === status)
        .sort((a, b) => b.created_at.localeCompare(a.created_at));
    },
    async updateStatus(id, status) {
      const row = threadsMap.get(id);
      if (row) {
        threadsMap.set(id, { ...row, status, updated_at: now() });
      }
    },
    async updateInteractionMode(id, interactionMode) {
      const row = threadsMap.get(id);
      if (row) {
        threadsMap.set(id, { ...row, interaction_mode: interactionMode, updated_at: now() });
      }
    },
    async updateSynopsis(id, synopsisJson) {
      const row = threadsMap.get(id);
      if (row) {
        threadsMap.set(id, { ...row, synopsis_json: synopsisJson, updated_at: now() });
      }
    },
    async updateCompactBaseline(id, compactBaselineJson) {
      const row = threadsMap.get(id);
      if (row) {
        threadsMap.set(id, {
          ...row,
          compact_baseline_json: compactBaselineJson,
          updated_at: now(),
        });
      }
    },
  };

  const taskRuns: TaskRunRepository = {
    async create(t: NewTaskRun) {
      const row: TaskRunRow = { ...t, finished_at: null };
      taskRunsMap.set(row.task_run_id, row);
      return row;
    },
    async findById(id) {
      return taskRunsMap.get(id) ?? null;
    },
    async findByThread(threadId) {
      return [...taskRunsMap.values()].filter((r) => r.thread_id === threadId);
    },
    async updateStatus(id, status, outputJson) {
      const row = taskRunsMap.get(id);
      if (row) {
        taskRunsMap.set(id, {
          ...row,
          status,
          output_json: outputJson ?? row.output_json,
          finished_at: ['completed', 'failed', 'cancelled'].includes(status)
            ? now()
            : row.finished_at,
        });
      }
    },
    async findQueue(companyId, opts) {
      // Join through threads to filter by company
      const companyThreadIds = new Set(
        [...threadsMap.values()].filter((t) => t.company_id === companyId).map((t) => t.thread_id),
      );
      let results = [...taskRunsMap.values()].filter((r) => companyThreadIds.has(r.thread_id));
      if (opts?.statuses) {
        const statuses = new Set(opts.statuses);
        results = results.filter((r) => statuses.has(r.status));
      }
      results.sort((a, b) => b.started_at.localeCompare(a.started_at));
      if (opts?.limit) results = results.slice(0, opts.limit);
      return results;
    },
    async countByStatus(companyId) {
      const companyThreadIds = new Set(
        [...threadsMap.values()].filter((t) => t.company_id === companyId).map((t) => t.thread_id),
      );
      const counts: Record<string, number> = {};
      for (const r of taskRunsMap.values()) {
        if (companyThreadIds.has(r.thread_id)) {
          counts[r.status] = (counts[r.status] ?? 0) + 1;
        }
      }
      return counts;
    },
  };

  const employees: EmployeeRepository = {
    async create(emp: NewEmployee) {
      const employee_id = emp.employee_id ?? crypto.randomUUID();
      const ts = now();
      const row: EmployeeRow = {
        employee_id,
        company_id: emp.company_id,
        source_asset_id: emp.source_asset_id,
        source_package_id: emp.source_package_id,
        name: emp.name,
        role_slug: emp.role_slug as RoleSlug,
        workstation_id: null,
        persona_json: emp.persona_json ?? null,
        config_json: emp.config_json ?? null,
        enabled: 1,
        created_at: ts,
        updated_at: ts,
      };
      employeesMap.set(employee_id, row);
      return { employee_id };
    },
    async findById(id) {
      return employeesMap.get(id) ?? null;
    },
    async findByCompany(companyId) {
      return [...employeesMap.values()].filter((e) => e.company_id === companyId);
    },
    async findByRole(companyId, roleSlug) {
      return [...employeesMap.values()].filter(
        (e) => e.company_id === companyId && e.role_slug === roleSlug,
      );
    },
    async update(employeeId, patch) {
      const row = employeesMap.get(employeeId);
      if (row) {
        employeesMap.set(employeeId, { ...row, ...patch, updated_at: now() });
      }
    },
    async delete(employeeId) {
      employeesMap.delete(employeeId);
    },
  };

  const toolCalls: ToolCallRepository = {
    async create(t: NewToolCall) {
      const row: ToolCallRow = { ...t, finished_at: null };
      toolCallsMap.set(row.tool_call_id, row);
      return row;
    },
    async updateResult(id, status, responseJson) {
      const row = toolCallsMap.get(id);
      if (row) {
        toolCallsMap.set(id, { ...row, status, response_json: responseJson, finished_at: now() });
      }
    },
  };

  const handoffs: HandoffRepository = {
    async create(h: NewHandoffEvent) {
      const row: HandoffEventRow = { ...h };
      handoffsMap.set(row.handoff_id, row);
      return row;
    },
    async findByThread(threadId) {
      return [...handoffsMap.values()].filter((h) => h.thread_id === threadId);
    },
  };

  const meetings: MeetingRepository = {
    async create(m: NewMeetingSession) {
      const row: MeetingSessionRow = { ...m };
      meetingsMap.set(row.meeting_id, row);
      return row;
    },
    async findById(id) {
      return meetingsMap.get(id) ?? null;
    },
    async updateStatus(id, status, summaryJson) {
      const row = meetingsMap.get(id);
      if (row) {
        meetingsMap.set(id, {
          ...row,
          status,
          summary_json: summaryJson ?? row.summary_json,
          updated_at: now(),
        });
      }
    },
  };

  const checkpoints: CheckpointRepository = {
    async save(c: NewGraphCheckpoint) {
      const row: GraphCheckpointRow = { ...c };
      checkpointsMap.set(row.checkpoint_id, row);
    },
    async findLatest(threadId) {
      const matching = [...checkpointsMap.values()]
        .filter((c) => c.thread_id === threadId)
        .sort((a, b) => b.checkpoint_seq - a.checkpoint_seq);
      return matching[0] ?? null;
    },
    async findBySeq(threadId, seq) {
      return (
        [...checkpointsMap.values()].find(
          (c) => c.thread_id === threadId && c.checkpoint_seq === seq,
        ) ?? null
      );
    },
  };

  const events: EventRepository = {
    async insert(e: NewRuntimeEvent) {
      eventsStore.push(e);
    },
    async findByThread(threadId) {
      return eventsStore.filter((event) => event.thread_id === threadId);
    },
  };

  const llmCalls: LlmCallRepository = {
    async create(c: NewLlmCall) {
      const row: LlmCallRow = { ...c };
      llmCallsMap.set(row.llm_call_id, row);
      return row;
    },
    async findByThread(threadId) {
      return [...llmCallsMap.values()].filter((c) => c.thread_id === threadId);
    },
    async findByThreadIds(threadIds) {
      const idSet = new Set(threadIds);
      return [...llmCallsMap.values()].filter(
        (c) => c.thread_id !== null && idSet.has(c.thread_id),
      );
    },
    async findByTaskRun(taskRunId) {
      return [...llmCallsMap.values()].filter((c) => c.task_run_id === taskRunId);
    },
  };

  const seed: MemoryRepositorySeed = {
    employees(rows) {
      for (const row of rows) employeesMap.set(row.employee_id, row);
    },
    companies(rows) {
      for (const row of rows) companiesMap.set(row.company_id, row);
    },
  };

  const memories = new InMemoryMemoryRepository(snapshot?.memories);
  const userPreferences = new MemoryUserPreferenceRepository(snapshot?.userPreferences);

  const installRepos = createMemoryInstallRepositories(snapshot);

  const mcpAudit = new MemoryMcpAuditRepository(snapshot?.mcpAudit);
  const nodeSummaries = new MemoryNodeSummaryRepository(snapshot?.nodeSummaries);
  const compactSummaries = new MemoryCompactSummaryRepository(snapshot?.compactSummaries);
  const activeInteractions = new MemoryActiveInteractionRepository(snapshot?.activeInteractions);
  const interactionHistory = new MemoryInteractionHistoryRepository(snapshot?.interactionHistory);
  const fileHistory = new MemoryFileHistoryRepository(snapshot?.fileHistory);
  const employeeVersions = new MemoryEmployeeVersionRepository(snapshot?.employeeVersions);
  const costRates = new MemoryModelCostRateRepository(snapshot?.costRates);
  const sopTemplates = new MemorySopTemplateRepository(snapshot?.sopTemplates);
  const racksRepo = new MemoryRackRepository(snapshot?.racks);
  const slotsRepo = new MemorySlotRepository(snapshot?.slots);
  const workstationRacksRepo = new MemoryWorkstationRackRepository(snapshot?.workstationRacks);
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
        companies: cloneRows(companiesMap.values()),
        threads: cloneRows(threadsMap.values()),
        taskRuns: cloneRows(taskRunsMap.values()),
        employees: cloneRows(employeesMap.values()),
        toolCalls: cloneRows(toolCallsMap.values()),
        handoffs: cloneRows(handoffsMap.values()),
        meetings: cloneRows(meetingsMap.values()),
        checkpoints: cloneRows(checkpointsMap.values()),
        events: cloneRows(eventsStore),
        llmCalls: cloneRows(llmCallsMap.values()),
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

export class MemoryActiveInteractionRepository implements ActiveInteractionRepository {
  private readonly rows = new Map<string, InteractionActiveRow>();

  constructor(initialRows?: Iterable<InteractionActiveRow>) {
    if (!initialRows) return;
    for (const row of initialRows) {
      this.rows.set(row.thread_id, { ...row });
    }
  }

  async upsert(row: NewInteractionActive): Promise<InteractionActiveRow> {
    const persisted = { ...row };
    this.rows.set(persisted.thread_id, persisted);
    return persisted;
  }

  async findByThread(threadId: string): Promise<InteractionActiveRow | null> {
    return this.rows.get(threadId) ?? null;
  }

  async deleteByThread(threadId: string): Promise<void> {
    this.rows.delete(threadId);
  }

  snapshot(): InteractionActiveRow[] {
    return cloneRows(this.rows.values());
  }
}

export class MemoryInteractionHistoryRepository implements InteractionHistoryRepository {
  private readonly rows: InteractionHistoryRow[] = [];

  constructor(initialRows?: Iterable<InteractionHistoryRow>) {
    if (!initialRows) return;
    this.rows.push(...cloneRows(initialRows));
  }

  async create(row: NewInteractionHistory): Promise<InteractionHistoryRow> {
    const persisted = { ...row };
    this.rows.push(persisted);
    return persisted;
  }

  async listByThread(
    threadId: string,
    opts?: { limit?: number },
  ): Promise<InteractionHistoryRow[]> {
    const rows = this.rows
      .filter((row) => row.thread_id === threadId)
      .sort((a, b) => b.resolved_at.localeCompare(a.resolved_at));
    return typeof opts?.limit === 'number' ? rows.slice(0, opts.limit) : rows;
  }

  snapshot(): InteractionHistoryRow[] {
    return cloneRows(this.rows);
  }
}

export class MemoryEmployeeVersionRepository implements EmployeeVersionRepository {
  private readonly rows: EmployeeVersionRow[] = [];

  constructor(initialRows?: Iterable<EmployeeVersionRow>) {
    if (!initialRows) return;
    this.rows.push(...cloneRows(initialRows));
  }

  async create(version: NewEmployeeVersion): Promise<EmployeeVersionRow> {
    const row: EmployeeVersionRow = {
      ...version,
      version_id: crypto.randomUUID(),
      created_at: new Date().toISOString(),
    };
    this.rows.push(row);
    return row;
  }

  async findByEmployee(
    employeeId: string,
    opts?: { limit?: number },
  ): Promise<EmployeeVersionRow[]> {
    const results = this.rows
      .filter((r) => r.employee_id === employeeId)
      .sort((a, b) => b.version_num - a.version_num);
    return opts?.limit ? results.slice(0, opts.limit) : results;
  }

  async findByVersion(employeeId: string, versionNum: number): Promise<EmployeeVersionRow | null> {
    return (
      this.rows.find((r) => r.employee_id === employeeId && r.version_num === versionNum) ?? null
    );
  }

  async getLatestVersionNum(employeeId: string): Promise<number> {
    const versions = this.rows.filter((r) => r.employee_id === employeeId);
    if (versions.length === 0) return 0;
    return Math.max(...versions.map((v) => v.version_num));
  }

  snapshot(): EmployeeVersionRow[] {
    return cloneRows(this.rows);
  }
}

export class MemoryModelCostRateRepository implements ModelCostRateRepository {
  private readonly rows: ModelCostRateRow[] = [];

  constructor(initialRows?: Iterable<ModelCostRateRow>) {
    if (!initialRows) return;
    this.rows.push(...cloneRows(initialRows));
  }

  async create(rate: NewModelCostRate): Promise<ModelCostRateRow> {
    const row: ModelCostRateRow = {
      ...rate,
      rate_id: crypto.randomUUID(),
      created_at: new Date().toISOString(),
    };
    this.rows.push(row);
    return row;
  }

  async findByProviderModel(provider: string, model: string): Promise<ModelCostRateRow | null> {
    return matchCostRate(this.rows, provider, model);
  }

  async findAll(): Promise<ModelCostRateRow[]> {
    return [...this.rows];
  }

  async upsert(rate: NewModelCostRate): Promise<ModelCostRateRow> {
    const existing = this.rows.findIndex(
      (r) =>
        r.provider === rate.provider &&
        r.model_pattern === rate.model_pattern &&
        r.effective_from === rate.effective_from,
    );
    if (existing >= 0) {
      const current = this.rows[existing];
      if (!current) {
        return this.create(rate);
      }
      const updated: ModelCostRateRow = {
        ...current,
        ...rate,
      };
      this.rows[existing] = updated;
      return updated;
    }
    return this.create(rate);
  }

  snapshot(): ModelCostRateRow[] {
    return cloneRows(this.rows);
  }
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

export class MemoryRackRepository implements RackRepository {
  private readonly store = new Map<string, RackRow>();

  constructor(initialRows?: Iterable<RackRow>) {
    if (!initialRows) return;
    for (const row of initialRows) {
      this.store.set(row.rack_id, { ...row });
    }
  }

  async create(rack: NewRack): Promise<RackRow> {
    const row: RackRow = {
      ...rack,
      created_at: new Date().toISOString(),
      updated_at: new Date().toISOString(),
    };
    this.store.set(row.rack_id, row);
    return row;
  }
  async findById(rackId: string): Promise<RackRow | null> {
    return this.store.get(rackId) ?? null;
  }
  async findByCompany(companyId: string): Promise<RackRow[]> {
    return [...this.store.values()].filter((r) => r.company_id === companyId);
  }
  async updateStatus(rackId: string, status: string): Promise<void> {
    const row = this.store.get(rackId);
    if (row) this.store.set(rackId, { ...row, status, updated_at: new Date().toISOString() });
  }
  async delete(rackId: string): Promise<void> {
    this.store.delete(rackId);
  }

  snapshot(): RackRow[] {
    return cloneRows(this.store.values());
  }
}

export class MemorySlotRepository implements SlotRepository {
  private readonly store = new Map<string, SlotRow>();

  constructor(initialRows?: Iterable<SlotRow>) {
    if (!initialRows) return;
    for (const row of initialRows) {
      this.store.set(row.slot_id, { ...row });
    }
  }

  async create(slot: NewSlot): Promise<SlotRow> {
    const row: SlotRow = {
      ...slot,
      created_at: new Date().toISOString(),
      updated_at: new Date().toISOString(),
    };
    this.store.set(row.slot_id, row);
    return row;
  }
  async findByRack(rackId: string): Promise<SlotRow[]> {
    return [...this.store.values()].filter((s) => s.rack_id === rackId);
  }
  async updateStatus(slotId: string, status: string): Promise<void> {
    const row = this.store.get(slotId);
    if (row) this.store.set(slotId, { ...row, status, updated_at: new Date().toISOString() });
  }
  async delete(slotId: string): Promise<void> {
    this.store.delete(slotId);
  }

  snapshot(): SlotRow[] {
    return cloneRows(this.store.values());
  }
}

export class MemoryWorkstationRackRepository implements WorkstationRackRepository {
  private readonly store: WorkstationRackRow[] = [];

  constructor(initialRows?: Iterable<WorkstationRackRow>) {
    if (!initialRows) return;
    this.store.push(...cloneRows(initialRows));
  }

  async create(binding: NewWorkstationRack): Promise<WorkstationRackRow> {
    const row: WorkstationRackRow = { ...binding, created_at: new Date().toISOString() };
    this.store.push(row);
    return row;
  }
  async findByWorkstation(workstationId: string): Promise<WorkstationRackRow[]> {
    return this.store.filter((r) => r.workstation_id === workstationId);
  }
  async findByRack(rackId: string): Promise<WorkstationRackRow[]> {
    return this.store.filter((r) => r.rack_id === rackId);
  }
  async delete(workstationId: string, rackId: string): Promise<void> {
    const idx = this.store.findIndex(
      (r) => r.workstation_id === workstationId && r.rack_id === rackId,
    );
    if (idx >= 0) this.store.splice(idx, 1);
  }

  snapshot(): WorkstationRackRow[] {
    return cloneRows(this.store);
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

export class MemoryMcpAuditRepository implements McpAuditRepository {
  private readonly rows: McpAuditRow[] = [];

  constructor(initialRows?: Iterable<McpAuditRow>) {
    if (!initialRows) return;
    this.rows.push(...cloneRows(initialRows));
  }

  async create(audit: NewMcpAudit): Promise<McpAuditRow> {
    this.rows.push(audit);
    return audit;
  }

  async listByThread(threadId: string): Promise<McpAuditRow[]> {
    return this.rows.filter((r) => r.thread_id === threadId);
  }

  async hasSuccessfulToolCall(
    threadId: string,
    employeeId: string,
    serverName: string,
    toolName: string,
  ): Promise<boolean> {
    return this.rows.some(
      (row) =>
        row.thread_id === threadId &&
        row.employee_id === employeeId &&
        row.server_name === serverName &&
        row.tool_name === toolName &&
        row.error === null,
    );
  }

  snapshot(): McpAuditRow[] {
    return cloneRows(this.rows);
  }
}

export class MemoryNodeSummaryRepository implements NodeSummaryRepository {
  private readonly rows: NodeSummaryRow[] = [];

  constructor(initialRows?: Iterable<NodeSummaryRow>) {
    if (!initialRows) return;
    this.rows.push(...cloneRows(initialRows));
  }

  async create(summary: NewNodeSummary): Promise<NodeSummaryRow> {
    this.rows.push(summary);
    return summary;
  }

  async listByThread(threadId: string, opts?: { limit?: number }): Promise<NodeSummaryRow[]> {
    const rows = this.rows
      .filter((row) => row.thread_id === threadId)
      .sort((a, b) => b.created_at.localeCompare(a.created_at));
    return opts?.limit ? rows.slice(0, opts.limit) : rows;
  }

  async countByThread(threadId: string): Promise<number> {
    return this.rows.filter((row) => row.thread_id === threadId).length;
  }

  async deleteByThread(threadId: string): Promise<void> {
    for (let index = this.rows.length - 1; index >= 0; index--) {
      if (this.rows[index]?.thread_id === threadId) {
        this.rows.splice(index, 1);
      }
    }
  }

  async trimByThread(threadId: string, keepLatest: number): Promise<void> {
    if (keepLatest < 0) return;
    const keepIds = new Set(
      (await this.listByThread(threadId, { limit: keepLatest })).map((row) => row.summary_id),
    );
    for (let index = this.rows.length - 1; index >= 0; index--) {
      const row = this.rows[index];
      if (row?.thread_id === threadId && !keepIds.has(row.summary_id)) {
        this.rows.splice(index, 1);
      }
    }
  }

  snapshot(): NodeSummaryRow[] {
    return cloneRows(this.rows);
  }
}

export class MemoryCompactSummaryRepository implements CompactSummaryRepository {
  private readonly rows: CompactSummaryRow[] = [];

  constructor(initialRows?: Iterable<CompactSummaryRow>) {
    if (!initialRows) return;
    this.rows.push(...cloneRows(initialRows));
  }

  async create(summary: NewCompactSummary): Promise<CompactSummaryRow> {
    this.rows.push(summary);
    return summary;
  }

  async listByThread(threadId: string, opts?: { limit?: number }): Promise<CompactSummaryRow[]> {
    const rows = this.rows
      .filter((row) => row.thread_id === threadId)
      .sort((a, b) => b.created_at.localeCompare(a.created_at));
    return opts?.limit ? rows.slice(0, opts.limit) : rows;
  }

  async deleteByThread(threadId: string): Promise<void> {
    for (let index = this.rows.length - 1; index >= 0; index--) {
      if (this.rows[index]?.thread_id === threadId) {
        this.rows.splice(index, 1);
      }
    }
  }

  snapshot(): CompactSummaryRow[] {
    return cloneRows(this.rows);
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
