import type { AgentRunRepository, AgentRunRow, NewAgentRun } from '@offisim/core/browser';
import * as schema from '@offisim/db-local';
import { and, asc, eq, inArray } from 'drizzle-orm';
import type { TauriDrizzleDb } from '../tauri-drizzle';

function now(): string {
  return new Date().toISOString();
}

export interface AgentRunsTauriRepos {
  agentRuns: AgentRunRepository;
}

export function createAgentRunsTauriRepos(db: TauriDrizzleDb): AgentRunsTauriRepos {
  const agentRuns: AgentRunRepository = {
    async create(run: NewAgentRun) {
      const row: AgentRunRow = {
        ...run,
        project_id: run.project_id ?? null,
        work_kind: run.work_kind ?? null,
        failure_kind: run.failure_kind ?? null,
        usage_json: run.usage_json ?? null,
        result_summary_json: run.result_summary_json ?? null,
        session_file: run.session_file ?? null,
        runtime_context_json: run.runtime_context_json ?? null,
        started_at: run.started_at ?? now(),
        finished_at: run.finished_at ?? null,
      };
      await db.insert(schema.agentRuns).values(row);
      return row;
    },
    async findById(runId) {
      const rows = (await db
        .select()
        .from(schema.agentRuns)
        .where(eq(schema.agentRuns.run_id, runId))) as AgentRunRow[];
      return rows[0] ?? null;
    },
    async findByThread(threadId) {
      return (await db
        .select()
        .from(schema.agentRuns)
        .where(eq(schema.agentRuns.thread_id, threadId))
        .orderBy(asc(schema.agentRuns.started_at))) as AgentRunRow[];
    },
    async findByRoot(rootRunId) {
      return (await db
        .select()
        .from(schema.agentRuns)
        .where(eq(schema.agentRuns.root_run_id, rootRunId))
        .orderBy(asc(schema.agentRuns.started_at))) as AgentRunRow[];
    },
    async findByStatus(companyId, statuses) {
      if (statuses.length === 0) return [];
      return (await db
        .select()
        .from(schema.agentRuns)
        .where(
          and(
            eq(schema.agentRuns.company_id, companyId),
            inArray(schema.agentRuns.status, statuses),
          ),
        )
        .orderBy(asc(schema.agentRuns.started_at))) as AgentRunRow[];
    },
    async updateStatus(runId, status, opts) {
      const patch: Partial<AgentRunRow> = { status };
      if (opts?.resultSummaryJson !== undefined) patch.result_summary_json = opts.resultSummaryJson;
      if (opts?.usageJson !== undefined) patch.usage_json = opts.usageJson;
      if (opts?.finishedAt !== undefined) patch.finished_at = opts.finishedAt;
      if (opts?.sessionFile !== undefined) patch.session_file = opts.sessionFile;
      if (opts?.failureKind !== undefined) patch.failure_kind = opts.failureKind;
      await db.update(schema.agentRuns).set(patch).where(eq(schema.agentRuns.run_id, runId));
    },
    async updateRuntimeContext(runId, runtimeContextJson) {
      await db
        .update(schema.agentRuns)
        .set({ runtime_context_json: runtimeContextJson })
        .where(eq(schema.agentRuns.run_id, runId));
    },
  };

  return { agentRuns };
}
