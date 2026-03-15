import type { NewEmployee } from '@aics/install-core';
import { InMemoryMemoryRepository } from '../repositories/memory-memory-repository.js';
import { matchCostRate } from '../utils/glob-match.js';
import { createMemoryInstallRepositories } from './memory-install-repos.js';
import type {
  CheckpointRepository,
  CompanyRepository,
  CompanyRow,
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
  NewRuntimeEvent,
  NewSopTemplate,
  NewTaskRun,
  NewToolCall,
  RuntimeRepositories,
  SopTemplateRepository,
  SopTemplateRow,
  TaskRunRepository,
  TaskRunRow,
  ThreadRepository,
  ToolCallRepository,
  ToolCallRow,
  RackRepository,
  RackRow,
  NewRack,
  SlotRepository,
  SlotRow,
  NewSlot,
  WorkstationRackRepository,
  WorkstationRackRow,
  NewWorkstationRack,
  LibraryDocumentRepository,
  LibraryDocumentRow,
  NewLibraryDocument,
  OfficeLayoutRepository,
  OfficeLayoutRow,
  NewOfficeLayout,
} from './repositories.js';

function now(): string {
  return new Date().toISOString();
}

export interface MemoryRepositorySeed {
  employees(rows: EmployeeRow[]): void;
  companies(rows: CompanyRow[]): void;
}

export function createMemoryRepositories(): RuntimeRepositories & { seed: MemoryRepositorySeed } {
  const threadsMap = new Map<string, GraphThreadRow>();
  const taskRunsMap = new Map<string, TaskRunRow>();
  const employeesMap = new Map<string, EmployeeRow>();
  const companiesMap = new Map<string, CompanyRow>();
  const toolCallsMap = new Map<string, ToolCallRow>();
  const handoffsMap = new Map<string, HandoffEventRow>();
  const meetingsMap = new Map<string, MeetingSessionRow>();
  const checkpointsMap = new Map<string, GraphCheckpointRow>();
  const eventsStore: NewRuntimeEvent[] = [];
  const llmCallsMap = new Map<string, LlmCallRow>();

  const companies: CompanyRepository = {
    async findById(id) {
      return companiesMap.get(id) ?? null;
    },
  };

  const threads: ThreadRepository = {
    async create(t: NewGraphThread) {
      const row: GraphThreadRow = { ...t, created_at: now(), updated_at: now() };
      threadsMap.set(row.thread_id, row);
      return row;
    },
    async findById(id) {
      return threadsMap.get(id) ?? null;
    },
    async findByCompany(companyId, opts) {
      let results = [...threadsMap.values()].filter((t) => t.company_id === companyId);
      if (opts?.status) results = results.filter((t) => t.status === opts.status);
      results.sort((a, b) => b.created_at.localeCompare(a.created_at));
      if (opts?.limit) results = results.slice(0, opts.limit);
      return results;
    },
    async updateStatus(id, status) {
      const row = threadsMap.get(id);
      if (row) {
        threadsMap.set(id, { ...row, status, updated_at: now() });
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
      const employee_id = crypto.randomUUID();
      const ts = now();
      const row: EmployeeRow = {
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

  const memories = new InMemoryMemoryRepository();

  const installRepos = createMemoryInstallRepositories();

  const mcpAudit = new MemoryMcpAuditRepository();
  const employeeVersions = new MemoryEmployeeVersionRepository();
  const costRates = new MemoryModelCostRateRepository();
  const sopTemplates = new MemorySopTemplateRepository();
  const racksRepo = new MemoryRackRepository();
  const slotsRepo = new MemorySlotRepository();
  const workstationRacksRepo = new MemoryWorkstationRackRepository();
  const libraryDocuments = new MemoryLibraryDocumentRepository();
  const officeLayouts = new MemoryOfficeLayoutRepository();

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
    employeeVersions,
    costRates,
    sopTemplates,
    racks: racksRepo,
    slots: slotsRepo,
    workstationRacks: workstationRacksRepo,
    libraryDocuments,
    officeLayouts,
    ...installRepos,
    seed,
  };
}

export class MemoryEmployeeVersionRepository implements EmployeeVersionRepository {
  private readonly rows: EmployeeVersionRow[] = [];

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
}

export class MemoryModelCostRateRepository implements ModelCostRateRepository {
  private readonly rows: ModelCostRateRow[] = [];

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
      const updated: ModelCostRateRow = {
        ...this.rows[existing]!,
        ...rate,
      };
      this.rows[existing] = updated;
      return updated;
    }
    return this.create(rate);
  }
}

export class MemorySopTemplateRepository implements SopTemplateRepository {
  private readonly store = new Map<string, SopTemplateRow>();

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

  async delete(sopTemplateId: string): Promise<void> {
    this.store.delete(sopTemplateId);
  }
}

export class MemoryRackRepository implements RackRepository {
  private readonly store = new Map<string, RackRow>();

  async create(rack: NewRack): Promise<RackRow> {
    const row: RackRow = { ...rack, created_at: new Date().toISOString(), updated_at: new Date().toISOString() };
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
}

export class MemorySlotRepository implements SlotRepository {
  private readonly store = new Map<string, SlotRow>();

  async create(slot: NewSlot): Promise<SlotRow> {
    const row: SlotRow = { ...slot, created_at: new Date().toISOString(), updated_at: new Date().toISOString() };
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
}

export class MemoryWorkstationRackRepository implements WorkstationRackRepository {
  private readonly store: WorkstationRackRow[] = [];

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
}

export class MemoryLibraryDocumentRepository implements LibraryDocumentRepository {
  private readonly store = new Map<string, LibraryDocumentRow>();

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

  async search(companyId: string, query: string, opts?: { limit?: number }): Promise<LibraryDocumentRow[]> {
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
}

export class MemoryOfficeLayoutRepository implements OfficeLayoutRepository {
  private readonly store = new Map<string, OfficeLayoutRow>();

  async create(layout: NewOfficeLayout): Promise<OfficeLayoutRow> {
    const row: OfficeLayoutRow = { ...layout, created_at: new Date().toISOString(), updated_at: new Date().toISOString() };
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
    return [...this.store.values()].find((l) => l.company_id === companyId && l.is_active === 1) ?? null;
  }
  async setActive(companyId: string, layoutId: string): Promise<void> {
    for (const [id, row] of this.store.entries()) {
      if (row.company_id === companyId) {
        this.store.set(id, { ...row, is_active: id === layoutId ? 1 : 0, updated_at: new Date().toISOString() });
      }
    }
  }
  async update(layoutId: string, patch: Partial<Pick<OfficeLayoutRow, 'name' | 'layout_json'>>): Promise<void> {
    const row = this.store.get(layoutId);
    if (row) this.store.set(layoutId, { ...row, ...patch, updated_at: new Date().toISOString() });
  }
  async delete(layoutId: string): Promise<void> {
    this.store.delete(layoutId);
  }
}

export class MemoryMcpAuditRepository implements McpAuditRepository {
  private readonly rows: McpAuditRow[] = [];

  async create(audit: NewMcpAudit): Promise<McpAuditRow> {
    this.rows.push(audit);
    return audit;
  }

  async listByThread(threadId: string): Promise<McpAuditRow[]> {
    return this.rows.filter((r) => r.thread_id === threadId);
  }
}
