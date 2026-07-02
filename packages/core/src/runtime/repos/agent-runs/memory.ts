import type { AgentRunRepository, AgentRunRow, NewAgentRun } from '../../repositories.js';

/**
 * In-memory agent-run repository (tests / non-persistent backends). Self-contained
 * — agent runs are runtime artifacts, not part of the seedable snapshot fixtures,
 * so this starts empty each construction.
 */
export class MemoryAgentRunRepository implements AgentRunRepository {
  private readonly store = new Map<string, AgentRunRow>();

  async create(run: NewAgentRun): Promise<AgentRunRow> {
    const row: AgentRunRow = {
      ...run,
      project_id: run.project_id ?? null,
      work_kind: run.work_kind ?? null,
      failure_kind: run.failure_kind ?? null,
      usage_json: run.usage_json ?? null,
      result_summary_json: run.result_summary_json ?? null,
      session_file: run.session_file ?? null,
      runtime_context_json: run.runtime_context_json ?? null,
      started_at: run.started_at ?? new Date().toISOString(),
      finished_at: run.finished_at ?? null,
    };
    this.store.set(row.run_id, row);
    return row;
  }

  async findById(runId: string): Promise<AgentRunRow | null> {
    return this.store.get(runId) ?? null;
  }

  async findByThread(threadId: string): Promise<AgentRunRow[]> {
    return [...this.store.values()]
      .filter((r) => r.thread_id === threadId)
      .sort((a, b) => a.started_at.localeCompare(b.started_at));
  }

  async findByRoot(rootRunId: string): Promise<AgentRunRow[]> {
    return [...this.store.values()]
      .filter((r) => r.root_run_id === rootRunId)
      .sort((a, b) => a.started_at.localeCompare(b.started_at));
  }

  async findByStatus(companyId: string, statuses: string[]): Promise<AgentRunRow[]> {
    if (statuses.length === 0) return [];
    const wanted = new Set(statuses);
    return [...this.store.values()]
      .filter((r) => r.company_id === companyId && wanted.has(r.status))
      .sort((a, b) => a.started_at.localeCompare(b.started_at));
  }

  async updateStatus(
    runId: string,
    status: string,
    opts?: {
      resultSummaryJson?: string | null;
      usageJson?: string | null;
      finishedAt?: string | null;
      sessionFile?: string | null;
      failureKind?: string | null;
    },
  ): Promise<void> {
    const row = this.store.get(runId);
    if (!row) return;
    this.store.set(runId, {
      ...row,
      status,
      result_summary_json:
        opts?.resultSummaryJson !== undefined ? opts.resultSummaryJson : row.result_summary_json,
      usage_json: opts?.usageJson !== undefined ? opts.usageJson : row.usage_json,
      finished_at: opts?.finishedAt !== undefined ? opts.finishedAt : row.finished_at,
      session_file: opts?.sessionFile !== undefined ? opts.sessionFile : row.session_file,
      failure_kind: opts?.failureKind !== undefined ? opts.failureKind : row.failure_kind,
    });
  }

  async updateRuntimeContext(runId: string, runtimeContextJson: string | null): Promise<void> {
    const row = this.store.get(runId);
    if (!row) return;
    this.store.set(runId, {
      ...row,
      runtime_context_json: runtimeContextJson,
    });
  }
}

export interface AgentRunsMemoryRepos {
  agentRuns: MemoryAgentRunRepository;
}

export function createAgentRunsMemoryRepos(): AgentRunsMemoryRepos {
  return { agentRuns: new MemoryAgentRunRepository() };
}
