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

const DEFAULT_LIST_LIMIT = 100;

/**
 * In-memory Verified Missions repos (tests / non-persistent backends). Mission
 * rows are runtime state, not seedable snapshot fixtures, so each store starts
 * empty per construction.
 */
export class MemoryMissionRepository implements MissionRepository {
  private readonly store = new Map<string, MissionRow>();

  constructor(private readonly deleteChildren: (missionId: string) => void = () => undefined) {}

  async insert(row: NewMission): Promise<void> {
    if (this.store.has(row.mission_id)) return;
    this.store.set(row.mission_id, { ...row });
  }

  async delete(missionId: string): Promise<void> {
    this.store.delete(missionId);
    this.deleteChildren(missionId);
  }

  async findById(missionId: string): Promise<MissionRow | null> {
    const row = this.store.get(missionId);
    return row ? { ...row } : null;
  }

  async listByCompany(companyId: string, opts?: { limit?: number }): Promise<MissionRow[]> {
    return [...this.store.values()]
      .filter((r) => r.company_id === companyId)
      .sort((a, b) => b.created_at.localeCompare(a.created_at))
      .slice(0, opts?.limit ?? DEFAULT_LIST_LIMIT)
      .map((r) => ({ ...r }));
  }

  async listByStatus(companyId: string, statuses: readonly string[]): Promise<MissionRow[]> {
    const wanted = new Set(statuses);
    // Unbounded by design (DR-003): every non-terminal mission, no 100-row cap.
    return [...this.store.values()]
      .filter((r) => r.company_id === companyId && wanted.has(r.status))
      .sort((a, b) => b.created_at.localeCompare(a.created_at))
      .map((r) => ({ ...r }));
  }

  async updateStatus(missionId: string, patch: MissionStatusUpdate): Promise<boolean> {
    const row = this.store.get(missionId);
    if (!row) return false;
    // A4 compare-and-swap: a guarded write whose expected status no longer
    // matches is a no-op (a concurrent transition already moved the row).
    if (patch.expectedStatus !== undefined && row.status !== patch.expectedStatus) {
      return false;
    }
    this.store.set(missionId, {
      ...row,
      status: patch.status,
      updated_at: patch.updatedAt,
      current_attempt_id:
        patch.currentAttemptId !== undefined ? patch.currentAttemptId : row.current_attempt_id,
      completed_at: patch.completedAt !== undefined ? patch.completedAt : row.completed_at,
    });
    return true;
  }
}

export class MemoryMissionCriterionRepository implements MissionCriterionRepository {
  private readonly store = new Map<string, MissionCriterionRow>();

  async insert(row: NewMissionCriterion): Promise<void> {
    if (this.store.has(row.criterion_id)) return;
    this.store.set(row.criterion_id, { ...row });
  }

  async findById(criterionId: string): Promise<MissionCriterionRow | null> {
    const row = this.store.get(criterionId);
    return row ? { ...row } : null;
  }

  async listByMission(missionId: string): Promise<MissionCriterionRow[]> {
    return [...this.store.values()]
      .filter((r) => r.mission_id === missionId)
      .sort((a, b) => a.order_index - b.order_index)
      .map((r) => ({ ...r }));
  }

  async updateStatus(criterionId: string, status: string): Promise<void> {
    const row = this.store.get(criterionId);
    if (!row) return;
    this.store.set(criterionId, { ...row, status });
  }

  async setLastEvaluation(criterionId: string, evaluationId: string | null): Promise<void> {
    const row = this.store.get(criterionId);
    if (!row) return;
    this.store.set(criterionId, { ...row, last_evaluation_id: evaluationId });
  }

  deleteByMission(missionId: string): void {
    for (const [criterionId, row] of this.store) {
      if (row.mission_id === missionId) this.store.delete(criterionId);
    }
  }
}

export class MemoryMissionAttemptRepository implements MissionAttemptRepository {
  private readonly store = new Map<string, MissionAttemptRow>();

  async insert(row: NewMissionAttempt): Promise<void> {
    if (this.store.has(row.attempt_id)) return;
    this.store.set(row.attempt_id, { ...row });
  }

  async findById(attemptId: string): Promise<MissionAttemptRow | null> {
    const row = this.store.get(attemptId);
    return row ? { ...row } : null;
  }

  async listByMission(missionId: string): Promise<MissionAttemptRow[]> {
    return [...this.store.values()]
      .filter((r) => r.mission_id === missionId)
      .sort((a, b) => a.attempt_number - b.attempt_number)
      .map((r) => ({ ...r }));
  }

  async updateStatus(
    attemptId: string,
    status: string,
    opts?: { failureSignature?: string | null; finishedAt?: string | null },
  ): Promise<void> {
    const row = this.store.get(attemptId);
    if (!row) return;
    this.store.set(attemptId, {
      ...row,
      status,
      failure_signature:
        opts?.failureSignature !== undefined ? opts.failureSignature : row.failure_signature,
      finished_at: opts?.finishedAt !== undefined ? opts.finishedAt : row.finished_at,
    });
  }

  async setRootRunId(attemptId: string, rootRunId: string): Promise<void> {
    const row = this.store.get(attemptId);
    if (!row) return;
    this.store.set(attemptId, { ...row, root_run_id: rootRunId });
  }

  deleteByMission(missionId: string): void {
    for (const [attemptId, row] of this.store) {
      if (row.mission_id === missionId) this.store.delete(attemptId);
    }
  }
}

export class MemoryMissionEvaluationRepository implements MissionEvaluationRepository {
  private readonly store = new Map<string, MissionEvaluationRow>();

  async insert(row: NewMissionEvaluation): Promise<void> {
    if (this.store.has(row.evaluation_id)) return;
    this.store.set(row.evaluation_id, { ...row });
  }

  async findById(evaluationId: string): Promise<MissionEvaluationRow | null> {
    const row = this.store.get(evaluationId);
    return row ? { ...row } : null;
  }

  async listByMission(missionId: string): Promise<MissionEvaluationRow[]> {
    return [...this.store.values()]
      .filter((r) => r.mission_id === missionId)
      .sort((a, b) => a.created_at.localeCompare(b.created_at))
      .map((r) => ({ ...r }));
  }

  async listByAttempt(attemptId: string): Promise<MissionEvaluationRow[]> {
    return [...this.store.values()]
      .filter((r) => r.attempt_id === attemptId)
      .sort((a, b) => a.created_at.localeCompare(b.created_at))
      .map((r) => ({ ...r }));
  }

  deleteByMission(missionId: string): void {
    for (const [evaluationId, row] of this.store) {
      if (row.mission_id === missionId) this.store.delete(evaluationId);
    }
  }
}

export class MemoryRuntimeSessionLinkRepository implements RuntimeSessionLinkRepository {
  private readonly store = new Map<string, RuntimeSessionLinkRow>();

  async insert(row: NewRuntimeSessionLink): Promise<void> {
    if (this.store.has(row.runtime_session_link_id)) return;
    this.store.set(row.runtime_session_link_id, { ...row });
  }

  async findById(runtimeSessionLinkId: string): Promise<RuntimeSessionLinkRow | null> {
    const row = this.store.get(runtimeSessionLinkId);
    return row ? { ...row } : null;
  }

  async findLatestByMission(missionId: string): Promise<RuntimeSessionLinkRow | null> {
    let latest: RuntimeSessionLinkRow | null = null;
    for (const row of this.store.values()) {
      if (row.mission_id === missionId) latest = row;
    }
    return latest ? { ...latest } : null;
  }

  async update(
    runtimeSessionLinkId: string,
    patch: Partial<
      Pick<
        RuntimeSessionLinkRow,
        'status' | 'compatibility_hash' | 'workspace_lease_id' | 'last_safe_boundary'
      >
    >,
  ): Promise<void> {
    const row = this.store.get(runtimeSessionLinkId);
    if (!row) return;
    this.store.set(runtimeSessionLinkId, { ...row, ...patch });
  }

  deleteByMission(missionId: string): void {
    for (const [linkId, row] of this.store) {
      if (row.mission_id === missionId) this.store.delete(linkId);
    }
  }
}

export class MemoryMissionEventRepository implements MissionEventRepository {
  private readonly store = new Map<string, MissionEventRow>();

  async insert(row: NewMissionEvent): Promise<void> {
    if (this.store.has(row.mission_event_id)) return;
    this.store.set(row.mission_event_id, { ...row });
  }

  async listByMission(missionId: string, opts?: { limit?: number }): Promise<MissionEventRow[]> {
    const limit = opts?.limit ?? DEFAULT_LIST_LIMIT;
    return [...this.store.values()]
      .filter((r) => r.mission_id === missionId)
      .sort((a, b) => a.created_at.localeCompare(b.created_at))
      .slice(-limit)
      .map((r) => ({ ...r }));
  }

  deleteByMission(missionId: string): void {
    for (const [eventId, row] of this.store) {
      if (row.mission_id === missionId) this.store.delete(eventId);
    }
  }
}

export interface MissionMemoryRepos {
  missions: MemoryMissionRepository;
  missionCriteria: MemoryMissionCriterionRepository;
  missionAttempts: MemoryMissionAttemptRepository;
  missionEvaluations: MemoryMissionEvaluationRepository;
  runtimeSessionLinks: MemoryRuntimeSessionLinkRepository;
  missionEvents: MemoryMissionEventRepository;
}

export function createMissionMemoryRepos(): MissionMemoryRepos {
  const missionCriteria = new MemoryMissionCriterionRepository();
  const missionAttempts = new MemoryMissionAttemptRepository();
  const missionEvaluations = new MemoryMissionEvaluationRepository();
  const runtimeSessionLinks = new MemoryRuntimeSessionLinkRepository();
  const missionEvents = new MemoryMissionEventRepository();
  return {
    missions: new MemoryMissionRepository((missionId) => {
      missionCriteria.deleteByMission(missionId);
      missionAttempts.deleteByMission(missionId);
      missionEvaluations.deleteByMission(missionId);
      runtimeSessionLinks.deleteByMission(missionId);
      missionEvents.deleteByMission(missionId);
    }),
    missionCriteria,
    missionAttempts,
    missionEvaluations,
    runtimeSessionLinks,
    missionEvents,
  };
}
