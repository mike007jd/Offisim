import type { NewEmployee } from '@aics/install-core';
import { InMemoryMemoryRepository } from '../repositories/memory-memory-repository.js';
import { createMemoryInstallRepositories } from './memory-install-repos.js';
import type {
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
  LlmCallRepository,
  LlmCallRow,
  MeetingRepository,
  MeetingSessionRow,
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
    ...installRepos,
    seed,
  };
}
