import type {
  MissionAttemptRepository,
  MissionAttemptRow,
  MissionCriterionRepository,
  MissionCriterionRow,
  MissionEvaluationRepository,
  MissionEvaluationRow,
  MissionEventRepository,
  MissionEventRow,
  MissionRepository,
  MissionRow,
  MissionStatusUpdate,
  NewMission,
  NewMissionAttempt,
  NewMissionCriterion,
  NewMissionEvaluation,
  NewMissionEvent,
  NewRuntimeSessionLink,
  RuntimeSessionLinkRepository,
  RuntimeSessionLinkRow,
} from '@offisim/core/browser';
import * as schema from '@offisim/db-local';
import { and, asc, desc, eq, inArray, sql } from 'drizzle-orm';
import type { TauriDrizzleDb } from '../tauri-drizzle';

const DEFAULT_LIST_LIMIT = 100;

export interface MissionTauriRepos {
  missions: MissionRepository;
  missionCriteria: MissionCriterionRepository;
  missionAttempts: MissionAttemptRepository;
  missionEvaluations: MissionEvaluationRepository;
  runtimeSessionLinks: RuntimeSessionLinkRepository;
  missionEvents: MissionEventRepository;
}

export function createMissionTauriRepos(db: TauriDrizzleDb): MissionTauriRepos {
  const missions: MissionRepository = {
    async insert(row: NewMission) {
      await db
        .insert(schema.mission)
        .values(row)
        .onConflictDoNothing({ target: schema.mission.mission_id });
    },
    async findById(missionId) {
      const rows = (await db
        .select()
        .from(schema.mission)
        .where(eq(schema.mission.mission_id, missionId))) as MissionRow[];
      return rows[0] ?? null;
    },
    async listByCompany(companyId, opts) {
      return (await db
        .select()
        .from(schema.mission)
        .where(eq(schema.mission.company_id, companyId))
        .orderBy(desc(schema.mission.created_at))
        .limit(opts?.limit ?? DEFAULT_LIST_LIMIT)) as MissionRow[];
    },
    async listByStatus(companyId, statuses) {
      // Unbounded by design (DR-003): a status-filtered scan with no row cap, so
      // crash recovery never drops a non-terminal mission beyond the 100 default.
      if (statuses.length === 0) return [];
      return (await db
        .select()
        .from(schema.mission)
        .where(
          and(
            eq(schema.mission.company_id, companyId),
            inArray(schema.mission.status, [...statuses]),
          ),
        )
        .orderBy(desc(schema.mission.created_at))) as MissionRow[];
    },
    async updateStatus(missionId, patch: MissionStatusUpdate) {
      const set: Partial<MissionRow> = { status: patch.status, updated_at: patch.updatedAt };
      if (patch.currentAttemptId !== undefined) set.current_attempt_id = patch.currentAttemptId;
      if (patch.completedAt !== undefined) set.completed_at = patch.completedAt;
      await db.update(schema.mission).set(set).where(eq(schema.mission.mission_id, missionId));
    },
  };

  const missionCriteria: MissionCriterionRepository = {
    async insert(row: NewMissionCriterion) {
      await db
        .insert(schema.missionCriterion)
        .values(row)
        .onConflictDoNothing({ target: schema.missionCriterion.criterion_id });
    },
    async findById(criterionId) {
      const rows = (await db
        .select()
        .from(schema.missionCriterion)
        .where(eq(schema.missionCriterion.criterion_id, criterionId))) as MissionCriterionRow[];
      return rows[0] ?? null;
    },
    async listByMission(missionId) {
      return (await db
        .select()
        .from(schema.missionCriterion)
        .where(eq(schema.missionCriterion.mission_id, missionId))
        .orderBy(asc(schema.missionCriterion.order_index))) as MissionCriterionRow[];
    },
    async updateStatus(criterionId, status) {
      await db
        .update(schema.missionCriterion)
        .set({ status })
        .where(eq(schema.missionCriterion.criterion_id, criterionId));
    },
    async setLastEvaluation(criterionId, evaluationId) {
      await db
        .update(schema.missionCriterion)
        .set({ last_evaluation_id: evaluationId })
        .where(eq(schema.missionCriterion.criterion_id, criterionId));
    },
  };

  const missionAttempts: MissionAttemptRepository = {
    async insert(row: NewMissionAttempt) {
      await db
        .insert(schema.missionAttempt)
        .values(row)
        .onConflictDoNothing({ target: schema.missionAttempt.attempt_id });
    },
    async findById(attemptId) {
      const rows = (await db
        .select()
        .from(schema.missionAttempt)
        .where(eq(schema.missionAttempt.attempt_id, attemptId))) as MissionAttemptRow[];
      return rows[0] ?? null;
    },
    async listByMission(missionId) {
      return (await db
        .select()
        .from(schema.missionAttempt)
        .where(eq(schema.missionAttempt.mission_id, missionId))
        .orderBy(asc(schema.missionAttempt.attempt_number))) as MissionAttemptRow[];
    },
    async updateStatus(attemptId, status, opts) {
      const set: Partial<MissionAttemptRow> = { status };
      if (opts?.failureSignature !== undefined) set.failure_signature = opts.failureSignature;
      if (opts?.finishedAt !== undefined) set.finished_at = opts.finishedAt;
      await db
        .update(schema.missionAttempt)
        .set(set)
        .where(eq(schema.missionAttempt.attempt_id, attemptId));
    },
  };

  const missionEvaluations: MissionEvaluationRepository = {
    async insert(row: NewMissionEvaluation) {
      await db
        .insert(schema.missionEvaluation)
        .values(row)
        .onConflictDoNothing({ target: schema.missionEvaluation.evaluation_id });
    },
    async findById(evaluationId) {
      const rows = (await db
        .select()
        .from(schema.missionEvaluation)
        .where(eq(schema.missionEvaluation.evaluation_id, evaluationId))) as MissionEvaluationRow[];
      return rows[0] ?? null;
    },
    async listByMission(missionId) {
      return (await db
        .select()
        .from(schema.missionEvaluation)
        .where(eq(schema.missionEvaluation.mission_id, missionId))
        .orderBy(asc(schema.missionEvaluation.created_at))) as MissionEvaluationRow[];
    },
    async listByAttempt(attemptId) {
      return (await db
        .select()
        .from(schema.missionEvaluation)
        .where(eq(schema.missionEvaluation.attempt_id, attemptId))
        .orderBy(asc(schema.missionEvaluation.created_at))) as MissionEvaluationRow[];
    },
  };

  const runtimeSessionLinks: RuntimeSessionLinkRepository = {
    async insert(row: NewRuntimeSessionLink) {
      await db
        .insert(schema.runtimeSessionLink)
        .values(row)
        .onConflictDoNothing({ target: schema.runtimeSessionLink.runtime_session_link_id });
    },
    async findById(runtimeSessionLinkId) {
      const rows = (await db
        .select()
        .from(schema.runtimeSessionLink)
        .where(
          eq(schema.runtimeSessionLink.runtime_session_link_id, runtimeSessionLinkId),
        )) as RuntimeSessionLinkRow[];
      return rows[0] ?? null;
    },
    async listByMission(missionId) {
      // runtime_session_link rows are append-only (no UPDATE of identity columns),
      // so SQLite `rowid` is a stable insertion-order anchor. Reconciliation reads
      // the LAST element as the live link, so ordering must be deterministic — the
      // table has no created_at column, and ORDER BY rowid needs no migration.
      return (await db
        .select()
        .from(schema.runtimeSessionLink)
        .where(eq(schema.runtimeSessionLink.mission_id, missionId))
        .orderBy(asc(sql`rowid`))) as RuntimeSessionLinkRow[];
    },
    async update(runtimeSessionLinkId, patch) {
      await db
        .update(schema.runtimeSessionLink)
        .set(patch)
        .where(eq(schema.runtimeSessionLink.runtime_session_link_id, runtimeSessionLinkId));
    },
  };

  const missionEvents: MissionEventRepository = {
    async insert(row: NewMissionEvent) {
      await db
        .insert(schema.missionEvent)
        .values(row)
        .onConflictDoNothing({ target: schema.missionEvent.mission_event_id });
    },
    async listByMission(missionId, opts) {
      return (await db
        .select()
        .from(schema.missionEvent)
        .where(eq(schema.missionEvent.mission_id, missionId))
        .orderBy(asc(schema.missionEvent.created_at))
        .limit(opts?.limit ?? DEFAULT_LIST_LIMIT)) as MissionEventRow[];
    },
  };

  return {
    missions,
    missionCriteria,
    missionAttempts,
    missionEvaluations,
    runtimeSessionLinks,
    missionEvents,
  };
}
