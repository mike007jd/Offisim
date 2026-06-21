import * as schema from '@offisim/db-local/dist/schema.js';
import { asc, eq } from 'drizzle-orm';
import type { BetterSQLite3Database } from 'drizzle-orm/better-sqlite3';
import type { AgentRunRepository, AgentRunRow, NewAgentRun } from '../../repositories.js';

type Db = BetterSQLite3Database<typeof schema>;

function now(): string {
  return new Date().toISOString();
}

export interface AgentRunsDrizzleRepos {
  agentRuns: AgentRunRepository;
}

export function createAgentRunsDrizzleRepos(db: Db): AgentRunsDrizzleRepos {
  const agentRuns: AgentRunRepository = {
    async create(run: NewAgentRun) {
      const row: AgentRunRow = {
        ...run,
        usage_json: run.usage_json ?? null,
        result_summary_json: run.result_summary_json ?? null,
        started_at: run.started_at ?? now(),
        finished_at: run.finished_at ?? null,
      };
      db.insert(schema.agentRuns).values(row).run();
      return row;
    },
    async findById(runId) {
      const rows = db
        .select()
        .from(schema.agentRuns)
        .where(eq(schema.agentRuns.run_id, runId))
        .all() as AgentRunRow[];
      return rows[0] ?? null;
    },
    async findByThread(threadId) {
      return db
        .select()
        .from(schema.agentRuns)
        .where(eq(schema.agentRuns.thread_id, threadId))
        .orderBy(asc(schema.agentRuns.started_at))
        .all() as AgentRunRow[];
    },
    async findByRoot(rootRunId) {
      return db
        .select()
        .from(schema.agentRuns)
        .where(eq(schema.agentRuns.root_run_id, rootRunId))
        .orderBy(asc(schema.agentRuns.started_at))
        .all() as AgentRunRow[];
    },
    async updateStatus(runId, status, opts) {
      const patch: Partial<AgentRunRow> = { status };
      if (opts?.resultSummaryJson !== undefined) patch.result_summary_json = opts.resultSummaryJson;
      if (opts?.usageJson !== undefined) patch.usage_json = opts.usageJson;
      if (opts?.finishedAt !== undefined) patch.finished_at = opts.finishedAt;
      db.update(schema.agentRuns).set(patch).where(eq(schema.agentRuns.run_id, runId)).run();
    },
  };

  return { agentRuns };
}
