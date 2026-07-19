// ---------------------------------------------------------------------------
// Loop domain (PR-07). A saveable, versioned, reusable wrapper around the Mission
// engine. Snake_case rows mirror the SQLite columns; the camelCase domain model
// lives in `@offisim/shared-types` loops module. Definitions point at an immutable
// selected revision; every edit appends a `loop_revisions` row (INSERT-ONLY — the
// repository exposes NO update/delete for a revision). SAVING a Loop writes ONLY
// these tables, never mission / chat_threads / mission_attempt.
// ---------------------------------------------------------------------------

export interface LoopDefinitionRow {
  loop_id: string;
  company_id: string;
  title: string;
  summary: string;
  profile_id: string;
  current_revision_id: string | null;
  status: string;
  schedule_interval_minutes: number | null;
  next_run_at: string | null;
  last_run_at: string | null;
  last_run_result: string | null;
  created_at: string;
  updated_at: string;
}

export type NewLoopDefinition = LoopDefinitionRow;

export interface LoopRevisionRow {
  revision_id: string;
  loop_id: string;
  revision_number: number;
  source_prompt: string;
  enhanced_prompt: string | null;
  compiled_ir_json: string;
  compiler_profile_id: string;
  compiler_profile_version: string;
  compiler_version: string;
  compile_status: string;
  questions_json: string;
  validation_json: string;
  created_at: string;
}

export type NewLoopRevision = LoopRevisionRow;

export interface LoopSkillBindingRow {
  binding_id: string;
  revision_id: string;
  skill_id: string;
  skill_version: string;
  order_index: number;
  config_json: string;
}

export type NewLoopSkillBinding = LoopSkillBindingRow;

export interface LoopInvocationRow {
  invocation_id: string;
  loop_id: string;
  revision_id: string;
  company_id: string;
  project_id: string | null;
  thread_id: string;
  message_id: string;
  mission_id: string | null;
  status: string;
  created_at: string;
}

export type NewLoopInvocation = LoopInvocationRow;

/** Patch for the mutable definition fields (title/summary/status/selected revision). */
export interface LoopDefinitionUpdate {
  title?: string;
  summary?: string;
  status?: string;
  /** `null` clears the selected revision; `undefined` leaves it unchanged. */
  currentRevisionId?: string | null;
  scheduleIntervalMinutes?: number | null;
  nextRunAt?: string | null;
  lastRunAt?: string | null;
  lastRunResult?: string | null;
  /** ISO timestamp to stamp `updated_at`; caller supplies. */
  updatedAt: string;
}

export interface LoopDefinitionRepository {
  /** Idempotent insert keyed on loop_id (INSERT OR IGNORE semantics). */
  insert(row: NewLoopDefinition): Promise<void>;
  findById(loopId: string): Promise<LoopDefinitionRow | null>;
  listByCompany(companyId: string, opts?: { limit?: number }): Promise<LoopDefinitionRow[]>;
  /** Patch the mutable definition fields (never the revisions — those are insert-only). */
  update(loopId: string, patch: LoopDefinitionUpdate): Promise<void>;
  /**
   * Compare-and-swap one exact scheduler slot. On success, advances next_run_at
   * before any external run side effect and records a durable `Starting` claim.
   */
  claimScheduledRun(
    loopId: string,
    expectedNextRunAt: string,
    claim: { claimedAt: string; nextRunAt: string },
  ): Promise<boolean>;
  /**
   * Physically delete a definition. The SERVICE forbids this when invocation
   * history exists (archive instead); the repo method itself is unconditional so
   * the service owns the policy. Cascades revisions + bindings via FK.
   */
  delete(loopId: string): Promise<void>;
}

export interface LoopRevisionRepository {
  /** Insert-only. There is intentionally NO update/delete for a revision. */
  insert(row: NewLoopRevision): Promise<void>;
  findById(revisionId: string): Promise<LoopRevisionRow | null>;
  listByLoop(loopId: string): Promise<LoopRevisionRow[]>;
  /**
   * The highest `revision_number` for a loop, or 0 when none exist. Callers add 1
   * for the next monotonic number; the UNIQUE(loop_id, revision_number) index is
   * the authority that rejects a duplicate under a concurrent save.
   */
  maxRevisionNumber(loopId: string): Promise<number>;
}

export interface LoopSkillBindingRepository {
  insert(row: NewLoopSkillBinding): Promise<void>;
  listByRevision(revisionId: string): Promise<LoopSkillBindingRow[]>;
}

export interface LoopInvocationRepository {
  /** Written ONLY at Office Send materialization (PR-10), never on Save/Use. */
  insert(row: NewLoopInvocation): Promise<void>;
  findById(invocationId: string): Promise<LoopInvocationRow | null>;
  listByLoop(loopId: string): Promise<LoopInvocationRow[]>;
  /** Count invocations for a loop — the service uses this to refuse a physical delete. */
  countByLoop(loopId: string): Promise<number>;
  /** Stamp the Mission this invocation materialized into (PR-10). */
  setMissionId(invocationId: string, missionId: string): Promise<void>;
  /**
   * Hard-delete an invocation row (PR-10 send-time compensation). Used ONLY to undo
   * a just-inserted invocation when the rest of the Send transaction (mission
   * create / link) fails — so a failed send leaves NO orphan. Idempotent: deleting
   * a missing id is a no-op.
   */
  deleteById(invocationId: string): Promise<void>;
}
