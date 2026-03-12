import type { NewEmployee } from '@aics/install-core';
import { InMemoryMemoryRepository } from '../repositories/memory-memory-repository.js';
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
  NewTaskRun,
  NewToolCall,
  RuntimeRepositories,
  TaskRunRepository,
  TaskRunRow,
  ThreadRepository,
  ToolCallRepository,
  ToolCallRow,
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
        [...threadsMap.values()]
          .filter((t) => t.company_id === companyId)
          .map((t) => t.thread_id),
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
        [...threadsMap.values()]
          .filter((t) => t.company_id === companyId)
          .map((t) => t.thread_id),
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
      return [...llmCallsMap.values()].filter((c) => c.thread_id !== null && idSet.has(c.thread_id));
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

  async findByEmployee(employeeId: string, opts?: { limit?: number }): Promise<EmployeeVersionRow[]> {
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
    // Find the best matching rate using glob pattern matching
    const matching = this.rows.filter((r) => {
      if (r.provider !== provider) return false;
      const regex = new RegExp(
        '^' + r.model_pattern.replace(/\*/g, '.*').replace(/\?/g, '.') + '$',
        'i',
      );
      return regex.test(model);
    });
    if (matching.length === 0) return null;
    // Prefer the most specific pattern (longest without wildcards)
    matching.sort((a, b) => b.model_pattern.length - a.model_pattern.length);
    return matching[0]!;
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
