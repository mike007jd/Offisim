import { createConversationsMemoryRepos } from './repos/conversations/memory.js';
import { createEmployeesMemoryRepos } from './repos/employees/memory.js';
import { createFilesMemoryRepos } from './repos/files/memory.js';
import { createInstallMemoryRepos } from './repos/install/memory.js';
import { createLlmMemoryRepos } from './repos/llm/memory.js';
import { createMemorySystemMemoryRepos } from './repos/memory-system/memory.js';
import { createOrchestrationMemoryRepos } from './repos/orchestration/memory.js';
import { createPermissionsMemoryRepos } from './repos/permissions/memory.js';
import { createProjectsMemoryRepos } from './repos/projects/memory.js';
import { createWorkspaceMemoryRepos } from './repos/workspace/memory.js';
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
  MemoryFileHistoryRepository,
  MemoryLibraryDocumentRepository,
} from './repos/files/memory.js';
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
export {
  MemoryProjectAssignmentRepository,
  MemoryProjectRepository,
} from './repos/projects/memory.js';
export {
  MemoryOfficeLayoutRepository,
  MemoryPrefabInstanceRepository,
  MemorySopTemplateRepository,
  MemoryZoneRepository,
} from './repos/workspace/memory.js';
import type {
  MemoryRepositoriesSnapshot,
  MemoryRepositorySeed,
} from './repos/memory-types.js';
import type {
  AgentEventRepository,
  AgentEventRow,
  NewAgentEvent,
  NewRecoveryKnowledge,
  RecoveryKnowledgeRepository,
  RecoveryKnowledgeRow,
  RuntimeRepositories,
} from './repositories.js';

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
  const filesFamily = createFilesMemoryRepos(snapshot);
  const { fileHistory, libraryDocuments } = filesFamily;
  const workspaceFamily = createWorkspaceMemoryRepos(snapshot);
  const {
    sopTemplates,
    officeLayouts,
    prefabInstances,
    zones: zonesRepo,
  } = workspaceFamily;
  const projectsFamily = createProjectsMemoryRepos(snapshot);
  const { projects, projectAssignments } = projectsFamily;

  const seed: MemoryRepositorySeed = {
    employees(rows) {
      employees.seed(rows);
    },
    companies(rows) {
      orchestration.companies.seed(rows);
    },
  };

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
