import type {
  LoopDefinitionRepository,
  LoopDefinitionRow,
  LoopDefinitionUpdate,
  LoopInvocationRepository,
  LoopInvocationRow,
  LoopRevisionRepository,
  LoopRevisionRow,
  LoopSkillBindingRepository,
  LoopSkillBindingRow,
  NewLoopDefinition,
  NewLoopInvocation,
  NewLoopRevision,
  NewLoopSkillBinding,
} from '../../repositories.js';

const DEFAULT_LIST_LIMIT = 100;

/**
 * In-memory Loop domain repos (tests / non-persistent backends). Loop rows are
 * user-authored definitions, but each store starts empty per construction — the
 * harness seeds via the public insert methods.
 */
export class MemoryLoopDefinitionRepository implements LoopDefinitionRepository {
  private readonly store = new Map<string, LoopDefinitionRow>();

  async insert(row: NewLoopDefinition): Promise<void> {
    // A duplicate loop_id is a real error, never a silent drop (a silent no-op
    // would let a second create hide/clobber the first). Mirror the PK violation
    // the persistent backends now raise.
    if (this.store.has(row.loop_id)) {
      throw new Error(`loop_definitions PRIMARY KEY violated: ${row.loop_id}`);
    }
    this.store.set(row.loop_id, { ...row });
  }

  async findById(loopId: string): Promise<LoopDefinitionRow | null> {
    const row = this.store.get(loopId);
    return row ? { ...row } : null;
  }

  async listByCompany(companyId: string, opts?: { limit?: number }): Promise<LoopDefinitionRow[]> {
    return [...this.store.values()]
      .filter((r) => r.company_id === companyId)
      .sort((a, b) => b.updated_at.localeCompare(a.updated_at))
      .slice(0, opts?.limit ?? DEFAULT_LIST_LIMIT)
      .map((r) => ({ ...r }));
  }

  async update(loopId: string, patch: LoopDefinitionUpdate): Promise<void> {
    const row = this.store.get(loopId);
    if (!row) return;
    this.store.set(loopId, {
      ...row,
      title: patch.title !== undefined ? patch.title : row.title,
      summary: patch.summary !== undefined ? patch.summary : row.summary,
      status: patch.status !== undefined ? patch.status : row.status,
      current_revision_id:
        patch.currentRevisionId !== undefined ? patch.currentRevisionId : row.current_revision_id,
      schedule_interval_minutes:
        patch.scheduleIntervalMinutes !== undefined
          ? patch.scheduleIntervalMinutes
          : row.schedule_interval_minutes,
      next_run_at: patch.nextRunAt !== undefined ? patch.nextRunAt : row.next_run_at,
      last_run_at: patch.lastRunAt !== undefined ? patch.lastRunAt : row.last_run_at,
      last_run_result:
        patch.lastRunResult !== undefined ? patch.lastRunResult : row.last_run_result,
      updated_at: patch.updatedAt,
    });
  }

  async delete(loopId: string): Promise<void> {
    this.store.delete(loopId);
  }
}

export class MemoryLoopRevisionRepository implements LoopRevisionRepository {
  private readonly store = new Map<string, LoopRevisionRow>();

  async insert(row: NewLoopRevision): Promise<void> {
    // Insert-only: a duplicate (loop_id, revision_number) is the concurrent-save
    // collision the UNIQUE index rejects on the real backend. Mirror that here so
    // the harness's concurrent-save oracle is meaningful.
    if (this.store.has(row.revision_id)) return;
    for (const existing of this.store.values()) {
      if (existing.loop_id === row.loop_id && existing.revision_number === row.revision_number) {
        throw new Error(
          `loop_revisions UNIQUE(loop_id, revision_number) violated: ${row.loop_id}#${row.revision_number}`,
        );
      }
    }
    this.store.set(row.revision_id, { ...row });
  }

  async findById(revisionId: string): Promise<LoopRevisionRow | null> {
    const row = this.store.get(revisionId);
    return row ? { ...row } : null;
  }

  async listByLoop(loopId: string): Promise<LoopRevisionRow[]> {
    return [...this.store.values()]
      .filter((r) => r.loop_id === loopId)
      .sort((a, b) => a.revision_number - b.revision_number)
      .map((r) => ({ ...r }));
  }

  async maxRevisionNumber(loopId: string): Promise<number> {
    let max = 0;
    for (const row of this.store.values()) {
      if (row.loop_id === loopId && row.revision_number > max) max = row.revision_number;
    }
    return max;
  }
}

export class MemoryLoopSkillBindingRepository implements LoopSkillBindingRepository {
  private readonly store = new Map<string, LoopSkillBindingRow>();

  async insert(row: NewLoopSkillBinding): Promise<void> {
    // A duplicate binding_id is a real error, never a silent drop — silently
    // dropping a binding would change the loop's resolved skills (and thus its
    // behavior). Mirror the PK violation the persistent backends now raise.
    if (this.store.has(row.binding_id)) {
      throw new Error(`loop_skill_bindings PRIMARY KEY violated: ${row.binding_id}`);
    }
    this.store.set(row.binding_id, { ...row });
  }

  async listByRevision(revisionId: string): Promise<LoopSkillBindingRow[]> {
    return [...this.store.values()]
      .filter((r) => r.revision_id === revisionId)
      .sort((a, b) => a.order_index - b.order_index)
      .map((r) => ({ ...r }));
  }
}

export class MemoryLoopInvocationRepository implements LoopInvocationRepository {
  private readonly store = new Map<string, LoopInvocationRow>();

  async insert(row: NewLoopInvocation): Promise<void> {
    // A duplicate invocation_id is a real error, never a silent skip — invocation
    // ids are fresh per send and the no-orphan compensation deletes-then-re-inserts
    // with a NEW id, so insert is never idempotent. A silent no-op would let a later
    // setMissionId() link a new mission onto an OLD row. Mirror the PK violation the
    // persistent backends now raise (and loop_definitions / loop_revisions).
    if (this.store.has(row.invocation_id)) {
      throw new Error(`loop_invocations PRIMARY KEY violated: ${row.invocation_id}`);
    }
    this.store.set(row.invocation_id, { ...row });
  }

  async findById(invocationId: string): Promise<LoopInvocationRow | null> {
    const row = this.store.get(invocationId);
    return row ? { ...row } : null;
  }

  async listByLoop(loopId: string): Promise<LoopInvocationRow[]> {
    return [...this.store.values()]
      .filter((r) => r.loop_id === loopId)
      .sort((a, b) => a.created_at.localeCompare(b.created_at))
      .map((r) => ({ ...r }));
  }

  async countByLoop(loopId: string): Promise<number> {
    let count = 0;
    for (const row of this.store.values()) {
      if (row.loop_id === loopId) count += 1;
    }
    return count;
  }

  async setMissionId(invocationId: string, missionId: string): Promise<void> {
    const row = this.store.get(invocationId);
    if (!row) return;
    this.store.set(invocationId, { ...row, mission_id: missionId });
  }

  async deleteById(invocationId: string): Promise<void> {
    this.store.delete(invocationId);
  }
}

export interface LoopMemoryRepos {
  loopDefinitions: MemoryLoopDefinitionRepository;
  loopRevisions: MemoryLoopRevisionRepository;
  loopSkillBindings: MemoryLoopSkillBindingRepository;
  loopInvocations: MemoryLoopInvocationRepository;
}

export function createLoopMemoryRepos(): LoopMemoryRepos {
  return {
    loopDefinitions: new MemoryLoopDefinitionRepository(),
    loopRevisions: new MemoryLoopRevisionRepository(),
    loopSkillBindings: new MemoryLoopSkillBindingRepository(),
    loopInvocations: new MemoryLoopInvocationRepository(),
  };
}
