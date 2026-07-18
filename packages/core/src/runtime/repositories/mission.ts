// ---------------------------------------------------------------------------
// Verified Missions core (PRD §17). Snake_case rows mirror the SQLite columns;
// the camelCase domain model lives in `@offisim/shared-types` mission module.
// Mission status/criteria truth is here (ADR 2026-06-25-truth-closure D4);
// evaluation truth is `mission_evaluation`.
// ---------------------------------------------------------------------------

export interface MissionRow {
  mission_id: string;
  company_id: string;
  project_id: string | null;
  thread_id: string;
  title: string;
  goal: string;
  status: string;
  runtime_id: string;
  runtime_policy_json: string;
  budget_json: string;
  expected_artifacts_json: string | null;
  current_attempt_id: string | null;
  created_at: string;
  updated_at: string;
  completed_at: string | null;
}

export type NewMission = MissionRow;

export interface MissionCriterionRow {
  criterion_id: string;
  mission_id: string;
  description: string;
  evaluator_id: string;
  evaluator_config_json: string;
  /** 0 | 1 — required criteria must pass for Mission completion. */
  required: number;
  order_index: number;
  status: string;
  last_evaluation_id: string | null;
}

export type NewMissionCriterion = MissionCriterionRow;

export interface MissionAttemptRow {
  attempt_id: string;
  mission_id: string;
  attempt_number: number;
  root_run_id: string | null;
  runtime_session_link_id: string | null;
  trigger: string;
  status: string;
  failure_signature: string | null;
  started_at: string;
  finished_at: string | null;
}

export type NewMissionAttempt = MissionAttemptRow;

export interface MissionEvaluationRow {
  evaluation_id: string;
  mission_id: string;
  criterion_id: string;
  attempt_id: string;
  evaluator_id: string;
  verdict: string;
  summary: string;
  evidence_refs_json: string;
  duration_ms: number | null;
  created_at: string;
}

export type NewMissionEvaluation = MissionEvaluationRow;

export interface RuntimeSessionLinkRow {
  runtime_session_link_id: string;
  mission_id: string;
  runtime_id: string;
  runtime_version: string | null;
  opaque_session_ref_json: string;
  compatibility_hash: string | null;
  workspace_lease_id: string | null;
  last_safe_boundary: string | null;
  status: string;
}

export type NewRuntimeSessionLink = RuntimeSessionLinkRow;

export interface MissionEventRow {
  mission_event_id: string;
  mission_id: string;
  attempt_id: string | null;
  type: string;
  data_json: string;
  created_at: string;
}

export type NewMissionEvent = MissionEventRow;

/** Patch for mission mutations driven by the state machine. */
export interface MissionStatusUpdate {
  status: string;
  /** ISO timestamp to stamp `updated_at`; caller supplies (backend does not auto-stamp). */
  updatedAt: string;
  currentAttemptId?: string | null;
  completedAt?: string | null;
  /**
   * Compare-and-swap guard (A4). When set, the update only applies if the row's
   * CURRENT `status` equals `expectedStatus`; otherwise it is a no-op. This
   * closes the lost-update race where a concurrent cancel is silently
   * overwritten by a stale verifying/repairing write. `undefined` → no guard
   * (unconditional update, kept for non-racing callers).
   */
  expectedStatus?: string;
}

export interface MissionRepository {
  /** Idempotent insert keyed on mission_id (INSERT OR IGNORE semantics). */
  insert(row: NewMission): Promise<void>;
  /** Delete the Mission aggregate root. Persistent backends cascade every child row. */
  delete(missionId: string): Promise<void>;
  findById(missionId: string): Promise<MissionRow | null>;
  listByCompany(companyId: string, opts?: { limit?: number }): Promise<MissionRow[]>;
  /**
   * All missions for a company whose `status` is in `statuses`, UNBOUNDED (no
   * default 100-row cap). Crash-recovery reconciliation (DR-003) uses this to
   * fetch every non-terminal mission (running/verifying/repairing): a company
   * with >100 missions must not silently drop a crashed one beyond the
   * `listByCompany` default limit, or it would stay stuck forever. Order is
   * unspecified — the caller reconciles each mission independently.
   */
  listByStatus(companyId: string, statuses: readonly string[]): Promise<MissionRow[]>;
  /**
   * Apply a status patch. Returns `true` when a row was updated, `false` when
   * the compare-and-swap guard (`patch.expectedStatus`) did not match the row's
   * current status or the row does not exist (A4). With no `expectedStatus` the
   * update is unconditional and returns `true` iff the row exists.
   */
  updateStatus(missionId: string, patch: MissionStatusUpdate): Promise<boolean>;
}

export interface MissionCriterionRepository {
  insert(row: NewMissionCriterion): Promise<void>;
  findById(criterionId: string): Promise<MissionCriterionRow | null>;
  listByMission(missionId: string): Promise<MissionCriterionRow[]>;
  updateStatus(criterionId: string, status: string): Promise<void>;
  setLastEvaluation(criterionId: string, evaluationId: string | null): Promise<void>;
}

export interface MissionAttemptRepository {
  insert(row: NewMissionAttempt): Promise<void>;
  findById(attemptId: string): Promise<MissionAttemptRow | null>;
  listByMission(missionId: string): Promise<MissionAttemptRow[]>;
  updateStatus(
    attemptId: string,
    status: string,
    opts?: { failureSignature?: string | null; finishedAt?: string | null },
  ): Promise<void>;
  /**
   * Stamp the attempt's root agent run id once the live runner knows it
   * (M2/M3 live wiring). `runId === attemptId` by design, so this records the
   * `agent_runs.run_id` that produced the attempt — enabling cross-table joins
   * for usage/cost and future durable recovery. No-op if the attempt is absent.
   */
  setRootRunId(attemptId: string, rootRunId: string): Promise<void>;
}

export interface MissionEvaluationRepository {
  insert(row: NewMissionEvaluation): Promise<void>;
  findById(evaluationId: string): Promise<MissionEvaluationRow | null>;
  listByMission(missionId: string): Promise<MissionEvaluationRow[]>;
  listByAttempt(attemptId: string): Promise<MissionEvaluationRow[]>;
}

export interface RuntimeSessionLinkRepository {
  insert(row: NewRuntimeSessionLink): Promise<void>;
  findById(runtimeSessionLinkId: string): Promise<RuntimeSessionLinkRow | null>;
  /** Latest append-only link for a Mission. Persistent backends must answer
   * with a single-row query rather than loading the Mission's full history. */
  findLatestByMission(missionId: string): Promise<RuntimeSessionLinkRow | null>;
  update(
    runtimeSessionLinkId: string,
    patch: Partial<
      Pick<
        RuntimeSessionLinkRow,
        'status' | 'compatibility_hash' | 'workspace_lease_id' | 'last_safe_boundary'
      >
    >,
  ): Promise<void>;
}

export interface MissionEventRepository {
  insert(row: NewMissionEvent): Promise<void>;
  listByMission(missionId: string, opts?: { limit?: number }): Promise<MissionEventRow[]>;
}
