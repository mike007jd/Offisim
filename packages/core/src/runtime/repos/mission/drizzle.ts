import * as schema from '@offisim/db-local/dist/schema.js';
import { asc, desc, eq } from 'drizzle-orm';
import type { BetterSQLite3Database } from 'drizzle-orm/better-sqlite3';
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
} from '../../repositories.js';

type Db = BetterSQLite3Database<typeof schema>;

const DEFAULT_LIST_LIMIT = 100;

export interface MissionDrizzleRepos {
  missions: MissionRepository;
  missionCriteria: MissionCriterionRepository;
  missionAttempts: MissionAttemptRepository;
  missionEvaluations: MissionEvaluationRepository;
  runtimeSessionLinks: RuntimeSessionLinkRepository;
  missionEvents: MissionEventRepository;
}

export function createMissionDrizzleRepos(db: Db): MissionDrizzleRepos {
  const missions: MissionRepository = {
    async insert(row: NewMission) {
      db.insert(schema.mission)
        .values(row)
        .onConflictDoNothing({ target: schema.mission.mission_id })
        .run();
    },
    async findById(missionId) {
      const rows = db
        .select()
        .from(schema.mission)
        .where(eq(schema.mission.mission_id, missionId))
        .all() as MissionRow[];
      return rows[0] ?? null;
    },
    async listByCompany(companyId, opts) {
      return db
        .select()
        .from(schema.mission)
        .where(eq(schema.mission.company_id, companyId))
        .orderBy(desc(schema.mission.created_at))
        .limit(opts?.limit ?? DEFAULT_LIST_LIMIT)
        .all() as MissionRow[];
    },
    async updateStatus(missionId, patch: MissionStatusUpdate) {
      const set: Partial<MissionRow> = { status: patch.status, updated_at: patch.updatedAt };
      if (patch.currentAttemptId !== undefined) set.current_attempt_id = patch.currentAttemptId;
      if (patch.completedAt !== undefined) set.completed_at = patch.completedAt;
      db.update(schema.mission).set(set).where(eq(schema.mission.mission_id, missionId)).run();
    },
  };

  const missionCriteria: MissionCriterionRepository = {
    async insert(row: NewMissionCriterion) {
      db.insert(schema.missionCriterion)
        .values(row)
        .onConflictDoNothing({ target: schema.missionCriterion.criterion_id })
        .run();
    },
    async findById(criterionId) {
      const rows = db
        .select()
        .from(schema.missionCriterion)
        .where(eq(schema.missionCriterion.criterion_id, criterionId))
        .all() as MissionCriterionRow[];
      return rows[0] ?? null;
    },
    async listByMission(missionId) {
      return db
        .select()
        .from(schema.missionCriterion)
        .where(eq(schema.missionCriterion.mission_id, missionId))
        .orderBy(asc(schema.missionCriterion.order_index))
        .all() as MissionCriterionRow[];
    },
    async updateStatus(criterionId, status) {
      db.update(schema.missionCriterion)
        .set({ status })
        .where(eq(schema.missionCriterion.criterion_id, criterionId))
        .run();
    },
    async setLastEvaluation(criterionId, evaluationId) {
      db.update(schema.missionCriterion)
        .set({ last_evaluation_id: evaluationId })
        .where(eq(schema.missionCriterion.criterion_id, criterionId))
        .run();
    },
  };

  const missionAttempts: MissionAttemptRepository = {
    async insert(row: NewMissionAttempt) {
      db.insert(schema.missionAttempt)
        .values(row)
        .onConflictDoNothing({ target: schema.missionAttempt.attempt_id })
        .run();
    },
    async findById(attemptId) {
      const rows = db
        .select()
        .from(schema.missionAttempt)
        .where(eq(schema.missionAttempt.attempt_id, attemptId))
        .all() as MissionAttemptRow[];
      return rows[0] ?? null;
    },
    async listByMission(missionId) {
      return db
        .select()
        .from(schema.missionAttempt)
        .where(eq(schema.missionAttempt.mission_id, missionId))
        .orderBy(asc(schema.missionAttempt.attempt_number))
        .all() as MissionAttemptRow[];
    },
    async updateStatus(attemptId, status, opts) {
      const set: Partial<MissionAttemptRow> = { status };
      if (opts?.failureSignature !== undefined) set.failure_signature = opts.failureSignature;
      if (opts?.finishedAt !== undefined) set.finished_at = opts.finishedAt;
      db.update(schema.missionAttempt)
        .set(set)
        .where(eq(schema.missionAttempt.attempt_id, attemptId))
        .run();
    },
  };

  const missionEvaluations: MissionEvaluationRepository = {
    async insert(row: NewMissionEvaluation) {
      db.insert(schema.missionEvaluation)
        .values(row)
        .onConflictDoNothing({ target: schema.missionEvaluation.evaluation_id })
        .run();
    },
    async findById(evaluationId) {
      const rows = db
        .select()
        .from(schema.missionEvaluation)
        .where(eq(schema.missionEvaluation.evaluation_id, evaluationId))
        .all() as MissionEvaluationRow[];
      return rows[0] ?? null;
    },
    async listByMission(missionId) {
      return db
        .select()
        .from(schema.missionEvaluation)
        .where(eq(schema.missionEvaluation.mission_id, missionId))
        .orderBy(asc(schema.missionEvaluation.created_at))
        .all() as MissionEvaluationRow[];
    },
    async listByAttempt(attemptId) {
      return db
        .select()
        .from(schema.missionEvaluation)
        .where(eq(schema.missionEvaluation.attempt_id, attemptId))
        .orderBy(asc(schema.missionEvaluation.created_at))
        .all() as MissionEvaluationRow[];
    },
  };

  const runtimeSessionLinks: RuntimeSessionLinkRepository = {
    async insert(row: NewRuntimeSessionLink) {
      db.insert(schema.runtimeSessionLink)
        .values(row)
        .onConflictDoNothing({ target: schema.runtimeSessionLink.runtime_session_link_id })
        .run();
    },
    async findById(runtimeSessionLinkId) {
      const rows = db
        .select()
        .from(schema.runtimeSessionLink)
        .where(eq(schema.runtimeSessionLink.runtime_session_link_id, runtimeSessionLinkId))
        .all() as RuntimeSessionLinkRow[];
      return rows[0] ?? null;
    },
    async listByMission(missionId) {
      return db
        .select()
        .from(schema.runtimeSessionLink)
        .where(eq(schema.runtimeSessionLink.mission_id, missionId))
        .all() as RuntimeSessionLinkRow[];
    },
    async update(runtimeSessionLinkId, patch) {
      db.update(schema.runtimeSessionLink)
        .set(patch)
        .where(eq(schema.runtimeSessionLink.runtime_session_link_id, runtimeSessionLinkId))
        .run();
    },
  };

  const missionEvents: MissionEventRepository = {
    async insert(row: NewMissionEvent) {
      db.insert(schema.missionEvent)
        .values(row)
        .onConflictDoNothing({ target: schema.missionEvent.mission_event_id })
        .run();
    },
    async listByMission(missionId, opts) {
      return db
        .select()
        .from(schema.missionEvent)
        .where(eq(schema.missionEvent.mission_id, missionId))
        .orderBy(asc(schema.missionEvent.created_at))
        .limit(opts?.limit ?? DEFAULT_LIST_LIMIT)
        .all() as MissionEventRow[];
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
