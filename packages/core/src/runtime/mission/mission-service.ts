/**
 * MissionService — the Verified Missions state machine (PRD §18).
 *
 * This is the ONE authoritative writer of `mission.status` (invariant §18.7).
 * It owns every legal Mission state transition, enforces the §18 invariants,
 * and appends a `mission_event` audit record per transition. It is a pure
 * BUSINESS state machine: it validates + persists state only. It does NOT call
 * any model, does NOT decide task content, and does NOT run evaluators — that is
 * the loop controller / evaluator registry's job (MS-003 / MS-004).
 *
 * Determinism: the service takes no implicit `Date.now()` / `Math.random()`.
 * Timestamps and ids are injected via `now()` / `newId()` so the harness is
 * fully reproducible. Mirror this when wiring it into a live path (MS-004).
 *
 * Additive at MS-002 — nothing consumes MissionService yet (no UI, no runtime).
 */

import type {
  MissionAttemptRepository,
  MissionAttemptRow,
  MissionCriterionRepository,
  MissionEvaluationRepository,
  MissionEventRepository,
  MissionRepository,
  MissionRow,
  NewMissionAttempt,
  NewMissionCriterion,
  NewMissionEvaluation,
  NewMissionEvent,
} from '../repositories.js';

// ---------------------------------------------------------------------------
// Status & transition map (PRD §18)
// ---------------------------------------------------------------------------

export type MissionStatus =
  | 'draft'
  | 'ready'
  | 'running'
  | 'verifying'
  | 'repairing'
  | 'awaiting_user'
  | 'interrupted'
  | 'ready_to_resume'
  | 'blocked'
  | 'failed'
  | 'completed'
  | 'paused'
  | 'cancelled';

/**
 * Central allowed-from map: the ONLY legal transitions. Any `from → to` not
 * listed here is rejected by {@link MissionService} (structural enforcement of
 * §18.6 — there is no edge out of `cancelled`/`completed`/`failed`).
 *
 * Keyed by source status; the value is the set of legal target statuses.
 */
const ALLOWED_TRANSITIONS: Readonly<Record<MissionStatus, readonly MissionStatus[]>> = {
  draft: ['ready', 'cancelled'],
  ready: ['running', 'cancelled', 'paused'],
  running: ['verifying', 'awaiting_user', 'interrupted', 'blocked', 'failed', 'cancelled', 'paused'],
  verifying: [
    'completed',
    'repairing',
    'awaiting_user',
    'interrupted',
    'blocked',
    'failed',
    'cancelled',
    'paused',
  ],
  repairing: ['running', 'cancelled', 'paused'],
  awaiting_user: ['running', 'cancelled', 'paused'],
  interrupted: ['ready_to_resume', 'cancelled'],
  ready_to_resume: ['running', 'cancelled'],
  // §18 draws `blocked` as a sink (external blocker): the only legal exits are
  // a global-bypass pause or a cancel — there is no unblock-to-ready edge.
  blocked: ['cancelled', 'paused'],
  // Global bypass resume: paused returns to running, ready, or is cancelled.
  paused: ['running', 'ready', 'cancelled'],
  // Terminal states — no outgoing edges.
  completed: [],
  failed: [],
  cancelled: [],
};

function canTransition(from: MissionStatus, to: MissionStatus): boolean {
  return (ALLOWED_TRANSITIONS[from] ?? []).includes(to);
}

// ---------------------------------------------------------------------------
// Mission event types (audit trail). Minimal literal set kept here so the
// state machine owns its own vocabulary; the row stores it as a free `type`.
// ---------------------------------------------------------------------------

export type MissionEventType =
  | 'mission.created'
  | 'mission.ready'
  | 'mission.attempt_started'
  | 'mission.verifying'
  | 'mission.completed'
  | 'mission.repairing'
  | 'mission.awaiting_user'
  | 'mission.interrupted'
  | 'mission.ready_to_resume'
  | 'mission.blocked'
  | 'mission.failed'
  | 'mission.paused'
  | 'mission.resumed'
  | 'mission.cancelled';

/** Maps a target status to its canonical transition event type. */
const STATUS_EVENT: Readonly<Record<MissionStatus, MissionEventType>> = {
  ready: 'mission.ready',
  running: 'mission.attempt_started',
  verifying: 'mission.verifying',
  completed: 'mission.completed',
  repairing: 'mission.repairing',
  awaiting_user: 'mission.awaiting_user',
  interrupted: 'mission.interrupted',
  ready_to_resume: 'mission.ready_to_resume',
  blocked: 'mission.blocked',
  failed: 'mission.failed',
  paused: 'mission.paused',
  cancelled: 'mission.cancelled',
  // draft is only ever an initial state, never a transition target.
  draft: 'mission.created',
};

// ---------------------------------------------------------------------------
// Typed error
// ---------------------------------------------------------------------------

export type MissionStateErrorCode =
  | 'mission_not_found'
  | 'illegal_transition'
  | 'invariant_violation';

/**
 * Thrown on an illegal transition or an §18 invariant violation. Carries a
 * machine-readable `code` so callers (MS-004) can branch without string-matching.
 */
export class MissionStateError extends Error {
  readonly code: MissionStateErrorCode;
  readonly missionId: string;
  readonly from?: MissionStatus;
  readonly to?: MissionStatus;

  constructor(
    code: MissionStateErrorCode,
    message: string,
    detail: { missionId: string; from?: MissionStatus; to?: MissionStatus },
  ) {
    super(message);
    this.name = 'MissionStateError';
    this.code = code;
    this.missionId = detail.missionId;
    this.from = detail.from;
    this.to = detail.to;
  }
}

// ---------------------------------------------------------------------------
// Inputs
// ---------------------------------------------------------------------------

export interface MissionCriterionInput {
  description: string;
  evaluatorId: string;
  /** Declarative evaluator config (serialized). Defaults to `'{}'`. */
  evaluatorConfigJson?: string;
  required: boolean;
  /** Optional explicit order; defaults to array index when omitted. */
  orderIndex?: number;
}

export interface CreateMissionInput {
  companyId: string;
  threadId: string;
  title: string;
  goal: string;
  runtimeId: string;
  runtimePolicyJson: string;
  budgetJson: string;
  projectId?: string;
  expectedArtifactsJson?: string;
  criteria: MissionCriterionInput[];
}

export interface RecordEvaluationInput {
  missionId: string;
  criterionId: string;
  attemptId: string;
  evaluatorId: string;
  verdict: 'PASS' | 'FAIL' | 'BLOCKED' | 'ERROR' | 'SKIP';
  summary: string;
  evidenceRefsJson?: string;
  durationMs?: number;
}

/** Map a §17.4 evaluation verdict to the §17.2 criterion status it implies. */
const VERDICT_TO_CRITERION_STATUS: Readonly<
  Record<RecordEvaluationInput['verdict'], 'pass' | 'fail' | 'blocked' | 'error' | 'skip'>
> = {
  PASS: 'pass',
  FAIL: 'fail',
  BLOCKED: 'blocked',
  ERROR: 'error',
  SKIP: 'skip',
};

// ---------------------------------------------------------------------------
// Service
// ---------------------------------------------------------------------------

/** The mission-repo subset of {@link RuntimeRepositories} the service writes. */
export interface MissionServiceRepos {
  missions: MissionRepository;
  missionCriteria: MissionCriterionRepository;
  missionAttempts: MissionAttemptRepository;
  missionEvaluations: MissionEvaluationRepository;
  missionEvents: MissionEventRepository;
}

export interface MissionServiceDeps {
  /** ISO-8601 timestamp factory (injected for determinism). */
  now: () => string;
  /** Unique id factory (injected for determinism). */
  newId: () => string;
}

export class MissionService {
  constructor(
    private readonly repos: MissionServiceRepos,
    private readonly deps: MissionServiceDeps,
  ) {}

  // -- creation ------------------------------------------------------------

  /**
   * Insert a Mission in `draft` plus its criteria (each `pending`). Writes a
   * `mission.created` event. Returns the inserted row.
   */
  async createMission(input: CreateMissionInput): Promise<MissionRow> {
    const ts = this.deps.now();
    const missionId = this.deps.newId();

    const row: MissionRow = {
      mission_id: missionId,
      company_id: input.companyId,
      project_id: input.projectId ?? null,
      thread_id: input.threadId,
      title: input.title,
      goal: input.goal,
      status: 'draft',
      runtime_id: input.runtimeId,
      runtime_policy_json: input.runtimePolicyJson,
      budget_json: input.budgetJson,
      expected_artifacts_json: input.expectedArtifactsJson ?? null,
      current_attempt_id: null,
      created_at: ts,
      updated_at: ts,
      completed_at: null,
    };
    await this.repos.missions.insert(row);

    for (const [index, c] of input.criteria.entries()) {
      const criterion: NewMissionCriterion = {
        criterion_id: this.deps.newId(),
        mission_id: missionId,
        description: c.description,
        evaluator_id: c.evaluatorId,
        evaluator_config_json: c.evaluatorConfigJson ?? '{}',
        required: c.required ? 1 : 0,
        order_index: c.orderIndex ?? index,
        status: 'pending',
        last_evaluation_id: null,
      };
      await this.repos.missionCriteria.insert(criterion);
    }

    await this.writeEvent(missionId, null, 'mission.created', {
      companyId: input.companyId,
      criteriaCount: input.criteria.length,
    });

    return row;
  }

  // -- transitions ---------------------------------------------------------

  /** draft → ready. */
  async markReady(missionId: string): Promise<MissionRow> {
    const mission = await this.load(missionId);
    return this.transition(mission, 'ready', {});
  }

  /**
   * Create a root attempt and bind the mission to it: → `running` (§18.2).
   * Rejected while a root attempt is already active in `running`/`verifying`
   * (§18.3) — no second root attempt may start.
   */
  async startAttempt(
    missionId: string,
    trigger: MissionAttemptRow['trigger'],
    opts?: { prevAttemptId?: string; failureSignature?: string },
  ): Promise<MissionRow> {
    const mission = await this.load(missionId);

    // §18.3: do not start a second root attempt while one is active.
    if (
      (mission.status === 'running' || mission.status === 'verifying') &&
      mission.current_attempt_id
    ) {
      throw new MissionStateError(
        'invariant_violation',
        `Cannot start a second root attempt while mission is '${mission.status}' with active attempt ${mission.current_attempt_id} (§18.3)`,
        { missionId, from: mission.status as MissionStatus },
      );
    }

    const ts = this.deps.now();
    const attemptId = this.deps.newId();
    const existing = await this.repos.missionAttempts.listByMission(missionId);
    const attempt: NewMissionAttempt = {
      attempt_id: attemptId,
      mission_id: missionId,
      attempt_number: existing.length + 1,
      root_run_id: null,
      runtime_session_link_id: null,
      trigger,
      status: 'running',
      failure_signature: opts?.failureSignature ?? null,
      started_at: ts,
      finished_at: null,
    };
    await this.repos.missionAttempts.insert(attempt);

    return this.transition(
      mission,
      'running',
      {
        attemptId,
        trigger,
        prevAttemptId: opts?.prevAttemptId,
        failureSignature: opts?.failureSignature,
      },
      { currentAttemptId: attemptId, timestamp: ts },
    );
  }

  /** running → verifying. */
  async beginVerifying(missionId: string): Promise<MissionRow> {
    const mission = await this.load(missionId);
    return this.transition(mission, 'verifying', {});
  }

  /**
   * Record an evaluation: insert a `mission_evaluation`, update the criterion's
   * status from the verdict, and stamp `last_evaluation_id`. This does NOT
   * transition the mission — completion is decided by the loop controller
   * (MS-004) via {@link completeMission}.
   *
   * Guarded to `verifying` only (§19): evaluators run during the verify phase,
   * not in draft/running/repairing. Without this, a caller could pre-seed a
   * required criterion to `pass` while the mission is elsewhere and defeat
   * §18.1's all-required-PASS intent at completion time.
   */
  async recordEvaluation(input: RecordEvaluationInput): Promise<void> {
    const mission = await this.load(input.missionId);
    if (mission.status !== 'verifying') {
      throw new MissionStateError(
        'invariant_violation',
        `Cannot record an evaluation while mission ${input.missionId} is '${mission.status}': evaluations run only during 'verifying' (§19)`,
        { missionId: input.missionId, from: mission.status as MissionStatus },
      );
    }

    const criterion = await this.repos.missionCriteria.findById(input.criterionId);
    if (!criterion) {
      throw new MissionStateError(
        'invariant_violation',
        `Criterion ${input.criterionId} not found for mission ${input.missionId}`,
        { missionId: input.missionId },
      );
    }
    if (criterion.mission_id !== input.missionId) {
      throw new MissionStateError(
        'invariant_violation',
        `Criterion ${input.criterionId} belongs to mission ${criterion.mission_id}, not ${input.missionId}`,
        { missionId: input.missionId },
      );
    }

    const evaluationId = this.deps.newId();
    const evaluation: NewMissionEvaluation = {
      evaluation_id: evaluationId,
      mission_id: input.missionId,
      criterion_id: input.criterionId,
      attempt_id: input.attemptId,
      evaluator_id: input.evaluatorId,
      verdict: input.verdict,
      summary: input.summary,
      evidence_refs_json: input.evidenceRefsJson ?? '[]',
      duration_ms: input.durationMs ?? null,
      created_at: this.deps.now(),
    };
    await this.repos.missionEvaluations.insert(evaluation);
    await this.repos.missionCriteria.updateStatus(
      input.criterionId,
      VERDICT_TO_CRITERION_STATUS[input.verdict],
    );
    await this.repos.missionCriteria.setLastEvaluation(input.criterionId, evaluationId);
  }

  /**
   * verifying → completed (§18.1). Enforces that EVERY required criterion has a
   * `pass` status; rejects with an `invariant_violation` otherwise.
   */
  async completeMission(missionId: string): Promise<MissionRow> {
    const mission = await this.load(missionId);

    const criteria = await this.repos.missionCriteria.listByMission(missionId);
    const unmetRequired = criteria.filter((c) => c.required === 1 && c.status !== 'pass');
    if (unmetRequired.length > 0) {
      throw new MissionStateError(
        'invariant_violation',
        `Cannot complete mission ${missionId}: ${unmetRequired.length} required criterion(s) not PASS (§18.1): ${unmetRequired
          .map((c) => `${c.criterion_id}=${c.status}`)
          .join(', ')}`,
        { missionId, from: mission.status as MissionStatus, to: 'completed' },
      );
    }

    const ts = this.deps.now();
    return this.transition(
      mission,
      'completed',
      { requiredCriteria: criteria.filter((c) => c.required === 1).length },
      { completedAt: ts, timestamp: ts },
    );
  }

  /**
   * verifying → repairing (§18.4). Must reference the previous failed attempt
   * (its id is carried into the event + a `failureSignature` is recorded), so
   * the next attempt has the failure feedback to repair against.
   */
  async toRepairing(
    missionId: string,
    prevAttemptId: string,
    failureSignature: string,
  ): Promise<MissionRow> {
    const mission = await this.load(missionId);
    return this.transition(mission, 'repairing', { prevAttemptId, failureSignature });
  }

  /** running|verifying → awaiting_user. */
  async toAwaitingUser(missionId: string, reason?: string): Promise<MissionRow> {
    const mission = await this.load(missionId);
    return this.transition(mission, 'awaiting_user', reason ? { reason } : {});
  }

  /**
   * running|verifying → interrupted (§18.5). This service ONLY marks the state.
   * The no-replay guarantee — never auto-rerun a tool call with unknown side
   * effects — is the loop/driver's responsibility (MS-004); this method must
   * never itself trigger a rerun, and it does not.
   */
  async toInterrupted(missionId: string): Promise<MissionRow> {
    const mission = await this.load(missionId);
    return this.transition(mission, 'interrupted', {});
  }

  /** interrupted → ready_to_resume. */
  async toReadyToResume(missionId: string): Promise<MissionRow> {
    const mission = await this.load(missionId);
    return this.transition(mission, 'ready_to_resume', {});
  }

  /** running|verifying → blocked (external blocker). */
  async toBlocked(missionId: string, reason: string): Promise<MissionRow> {
    const mission = await this.load(missionId);
    return this.transition(mission, 'blocked', { reason });
  }

  /** running|verifying → failed (limits exhausted / stop guard). */
  async toFailed(missionId: string, reason: string): Promise<MissionRow> {
    const mission = await this.load(missionId);
    return this.transition(mission, 'failed', { reason });
  }

  /** Global bypass → paused. */
  async pause(missionId: string): Promise<MissionRow> {
    const mission = await this.load(missionId);
    return this.transition(mission, 'paused', {});
  }

  /**
   * Resume from a paused mission. Targets `running` by default (§18 paused →
   * running|ready). Pass `to: 'ready'` to park it back in ready instead.
   */
  async resume(missionId: string, to: 'running' | 'ready' = 'running'): Promise<MissionRow> {
    const mission = await this.load(missionId);
    return this.transition(mission, to, { resumedFrom: mission.status }, { eventType: 'mission.resumed' });
  }

  /**
   * → cancelled. Terminal: there is no edge OUT of `cancelled` in the map, so a
   * cancelled mission can never be auto-resumed (§18.6 — structurally enforced).
   */
  async cancel(missionId: string, reason?: string): Promise<MissionRow> {
    const mission = await this.load(missionId);
    return this.transition(mission, 'cancelled', reason ? { reason } : {});
  }

  // -- internals -----------------------------------------------------------

  private async load(missionId: string): Promise<MissionRow> {
    const mission = await this.repos.missions.findById(missionId);
    if (!mission) {
      throw new MissionStateError('mission_not_found', `Mission ${missionId} not found`, {
        missionId,
      });
    }
    return mission;
  }

  /**
   * The single chokepoint for status writes (§18.7). Validates `from → to`
   * against {@link ALLOWED_TRANSITIONS}, persists via `missions.updateStatus`,
   * appends a `mission_event`, and returns the updated row. Invariant checks
   * specific to a target live in the public method that calls this.
   */
  private async transition(
    mission: MissionRow,
    to: MissionStatus,
    eventData: Record<string, unknown>,
    opts?: {
      currentAttemptId?: string;
      completedAt?: string;
      timestamp?: string;
      eventType?: MissionEventType;
    },
  ): Promise<MissionRow> {
    const from = mission.status as MissionStatus;
    if (!canTransition(from, to)) {
      throw new MissionStateError(
        'illegal_transition',
        `Illegal mission transition '${from}' → '${to}' (mission ${mission.mission_id})`,
        { missionId: mission.mission_id, from, to },
      );
    }

    const ts = opts?.timestamp ?? this.deps.now();
    await this.repos.missions.updateStatus(mission.mission_id, {
      status: to,
      updatedAt: ts,
      ...(opts?.currentAttemptId !== undefined ? { currentAttemptId: opts.currentAttemptId } : {}),
      ...(opts?.completedAt !== undefined ? { completedAt: opts.completedAt } : {}),
    });

    const attemptId =
      opts?.currentAttemptId ?? mission.current_attempt_id ?? null;
    await this.writeEvent(
      mission.mission_id,
      attemptId,
      opts?.eventType ?? STATUS_EVENT[to],
      { from, to, ...eventData },
      ts,
    );

    return {
      ...mission,
      status: to,
      updated_at: ts,
      current_attempt_id:
        opts?.currentAttemptId !== undefined ? opts.currentAttemptId : mission.current_attempt_id,
      completed_at: opts?.completedAt !== undefined ? opts.completedAt : mission.completed_at,
    };
  }

  /** Append an immutable `mission_event` audit row. */
  private async writeEvent(
    missionId: string,
    attemptId: string | null,
    type: MissionEventType,
    data: Record<string, unknown>,
    timestamp?: string,
  ): Promise<void> {
    const event: NewMissionEvent = {
      mission_event_id: this.deps.newId(),
      mission_id: missionId,
      attempt_id: attemptId,
      type,
      data_json: JSON.stringify(data),
      created_at: timestamp ?? this.deps.now(),
    };
    await this.repos.missionEvents.insert(event);
  }
}

/**
 * Factory mirroring the core service style. Pass the mission-repo subset off
 * {@link RuntimeRepositories} plus injected `now()` / `newId()`.
 */
export function createMissionService(
  repos: MissionServiceRepos,
  deps: MissionServiceDeps,
): MissionService {
  return new MissionService(repos, deps);
}
