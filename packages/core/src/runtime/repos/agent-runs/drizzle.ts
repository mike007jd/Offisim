import {
  freshSessionSourceWhere,
  latestFreshSessionCandidateWhere,
} from '@offisim/db-local/dist/agent-run-queries.js';
import * as schema from '@offisim/db-local/dist/schema.js';
import { and, asc, eq, inArray } from 'drizzle-orm';
import type { BetterSQLite3Database } from 'drizzle-orm/better-sqlite3';
import {
  type AgentRunRepository,
  type AgentRunRow,
  type CompetitiveDraftAttemptRepository,
  type CompetitiveDraftAttemptRow,
  type CompetitiveDraftGroupRepository,
  type CompetitiveDraftGroupRow,
  type NewAgentRun,
  RESETTABLE_NATIVE_SESSION_PRESTART_CODES,
} from '../../repositories.js';

type Db = BetterSQLite3Database<typeof schema>;

function now(): string {
  return new Date().toISOString();
}

export interface AgentRunsDrizzleRepos {
  agentRuns: AgentRunRepository;
  competitiveDraftGroups: CompetitiveDraftGroupRepository;
  competitiveDraftAttempts: CompetitiveDraftAttemptRepository;
}

export function createAgentRunsDrizzleRepos(db: Db): AgentRunsDrizzleRepos {
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
    async findByStatus(companyId, statuses) {
      if (statuses.length === 0) return [];
      return db
        .select()
        .from(schema.agentRuns)
        .where(
          and(
            eq(schema.agentRuns.company_id, companyId),
            inArray(schema.agentRuns.status, statuses),
          ),
        )
        .orderBy(asc(schema.agentRuns.started_at))
        .all() as AgentRunRow[];
    },
    async findLatestFreshSessionCandidate(companyId, threadId) {
      const rows = db
        .select()
        .from(schema.agentRuns)
        .where(
          latestFreshSessionCandidateWhere(
            companyId,
            threadId,
            RESETTABLE_NATIVE_SESSION_PRESTART_CODES,
          ),
        )
        .limit(1)
        .all() as AgentRunRow[];
      return rows[0] ?? null;
    },
    async findFreshSessionSource(companyId, threadId, sourceRunId) {
      const rows = db
        .select()
        .from(schema.agentRuns)
        .where(
          freshSessionSourceWhere(
            companyId,
            threadId,
            sourceRunId,
            RESETTABLE_NATIVE_SESSION_PRESTART_CODES,
          ),
        )
        .all() as AgentRunRow[];
      return rows[0] ?? null;
    },
    async updateStatus(runId, status, opts) {
      const patch: Partial<AgentRunRow> = { status };
      if (opts?.resultSummaryJson !== undefined) patch.result_summary_json = opts.resultSummaryJson;
      if (opts?.usageJson !== undefined) patch.usage_json = opts.usageJson;
      if (opts?.finishedAt !== undefined) patch.finished_at = opts.finishedAt;
      if (opts?.sessionFile !== undefined) patch.session_file = opts.sessionFile;
      if (opts?.failureKind !== undefined) patch.failure_kind = opts.failureKind;
      db.update(schema.agentRuns).set(patch).where(eq(schema.agentRuns.run_id, runId)).run();
    },
    async updateStatusForCompany(companyId, runId, status, opts) {
      const patch: Partial<AgentRunRow> = { status };
      if (opts?.resultSummaryJson !== undefined) patch.result_summary_json = opts.resultSummaryJson;
      if (opts?.usageJson !== undefined) patch.usage_json = opts.usageJson;
      if (opts?.finishedAt !== undefined) patch.finished_at = opts.finishedAt;
      if (opts?.sessionFile !== undefined) patch.session_file = opts.sessionFile;
      if (opts?.failureKind !== undefined) patch.failure_kind = opts.failureKind;
      const result = db
        .update(schema.agentRuns)
        .set(patch)
        .where(and(eq(schema.agentRuns.company_id, companyId), eq(schema.agentRuns.run_id, runId)))
        .run();
      return result.changes > 0;
    },
    async updateRuntimeContext(runId, runtimeContextJson) {
      db.update(schema.agentRuns)
        .set({ runtime_context_json: runtimeContextJson })
        .where(eq(schema.agentRuns.run_id, runId))
        .run();
    },
  };

  const competitiveDraftGroups: CompetitiveDraftGroupRepository = {
    async create(group) {
      const row: CompetitiveDraftGroupRow = {
        ...group,
        winner_attempt_id: group.winner_attempt_id ?? null,
      };
      db.insert(schema.competitiveDraftGroups).values(row).run();
      return row;
    },
    async findById(groupId) {
      const rows = db
        .select()
        .from(schema.competitiveDraftGroups)
        .where(eq(schema.competitiveDraftGroups.group_id, groupId))
        .all() as CompetitiveDraftGroupRow[];
      return rows[0] ?? null;
    },
    async findBySourceRun(sourceRunId) {
      const rows = db
        .select()
        .from(schema.competitiveDraftGroups)
        .where(eq(schema.competitiveDraftGroups.source_run_id, sourceRunId))
        .orderBy(asc(schema.competitiveDraftGroups.created_at))
        .all() as CompetitiveDraftGroupRow[];
      return rows.at(-1) ?? null;
    },
    async listByProject(projectId) {
      return db
        .select()
        .from(schema.competitiveDraftGroups)
        .where(eq(schema.competitiveDraftGroups.project_id, projectId))
        .orderBy(asc(schema.competitiveDraftGroups.created_at))
        .all() as CompetitiveDraftGroupRow[];
    },
    async updateStatus(groupId, status, opts) {
      const patch: Partial<CompetitiveDraftGroupRow> = {
        status,
        updated_at: opts?.updatedAt ?? now(),
      };
      if (opts?.winnerAttemptId !== undefined) {
        patch.winner_attempt_id = opts.winnerAttemptId;
      }
      db.update(schema.competitiveDraftGroups)
        .set(patch)
        .where(eq(schema.competitiveDraftGroups.group_id, groupId))
        .run();
    },
  };

  const competitiveDraftAttempts: CompetitiveDraftAttemptRepository = {
    async create(attempt) {
      const row: CompetitiveDraftAttemptRow = {
        ...attempt,
        lease_id: attempt.lease_id ?? null,
        result_summary_json: attempt.result_summary_json ?? null,
        usage_json: attempt.usage_json ?? null,
        verification_summary: attempt.verification_summary ?? null,
        verification_passed: attempt.verification_passed ?? null,
        finished_at: attempt.finished_at ?? null,
      };
      db.insert(schema.competitiveDraftAttempts).values(row).run();
      return row;
    },
    async findById(attemptId) {
      const rows = db
        .select()
        .from(schema.competitiveDraftAttempts)
        .where(eq(schema.competitiveDraftAttempts.attempt_id, attemptId))
        .all() as CompetitiveDraftAttemptRow[];
      return rows[0] ?? null;
    },
    async findByLeaseId(leaseId) {
      const rows = db
        .select()
        .from(schema.competitiveDraftAttempts)
        .where(eq(schema.competitiveDraftAttempts.lease_id, leaseId))
        .all() as CompetitiveDraftAttemptRow[];
      return rows[0] ?? null;
    },
    async listByGroup(groupId) {
      return db
        .select()
        .from(schema.competitiveDraftAttempts)
        .where(eq(schema.competitiveDraftAttempts.group_id, groupId))
        .orderBy(asc(schema.competitiveDraftAttempts.ordinal))
        .all() as CompetitiveDraftAttemptRow[];
    },
    async update(attemptId, patch) {
      db.update(schema.competitiveDraftAttempts)
        .set(patch)
        .where(eq(schema.competitiveDraftAttempts.attempt_id, attemptId))
        .run();
    },
  };

  return { agentRuns, competitiveDraftGroups, competitiveDraftAttempts };
}
