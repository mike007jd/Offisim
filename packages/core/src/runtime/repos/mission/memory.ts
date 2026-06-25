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

  async insert(row: NewMission): Promise<void> {
    if (this.store.has(row.mission_id)) return;
    this.store.set(row.mission_id, { ...row });
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

  async updateStatus(missionId: string, patch: MissionStatusUpdate): Promise<void> {
    const row = this.store.get(missionId);
    if (!row) return;
    this.store.set(missionId, {
      ...row,
      status: patch.status,
      updated_at: patch.updatedAt,
      current_attempt_id:
        patch.currentAttemptId !== undefined ? patch.currentAttemptId : row.current_attempt_id,
      completed_at: patch.completedAt !== undefined ? patch.completedAt : row.completed_at,
    });
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

  async listByMission(missionId: string): Promise<RuntimeSessionLinkRow[]> {
    return [...this.store.values()]
      .filter((r) => r.mission_id === missionId)
      .map((r) => ({ ...r }));
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
}

export class MemoryMissionEventRepository implements MissionEventRepository {
  private readonly store = new Map<string, MissionEventRow>();

  async insert(row: NewMissionEvent): Promise<void> {
    if (this.store.has(row.mission_event_id)) return;
    this.store.set(row.mission_event_id, { ...row });
  }

  async listByMission(missionId: string, opts?: { limit?: number }): Promise<MissionEventRow[]> {
    return [...this.store.values()]
      .filter((r) => r.mission_id === missionId)
      .sort((a, b) => a.created_at.localeCompare(b.created_at))
      .slice(0, opts?.limit ?? DEFAULT_LIST_LIMIT)
      .map((r) => ({ ...r }));
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
  return {
    missions: new MemoryMissionRepository(),
    missionCriteria: new MemoryMissionCriterionRepository(),
    missionAttempts: new MemoryMissionAttemptRepository(),
    missionEvaluations: new MemoryMissionEvaluationRepository(),
    runtimeSessionLinks: new MemoryRuntimeSessionLinkRepository(),
    missionEvents: new MemoryMissionEventRepository(),
  };
}
