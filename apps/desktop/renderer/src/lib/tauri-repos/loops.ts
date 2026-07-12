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
} from '@offisim/core/browser';
import * as schema from '@offisim/db-local';
import { asc, desc, eq, sql } from 'drizzle-orm';
import type { TauriDrizzleDb } from '../tauri-drizzle';

const DEFAULT_LIST_LIMIT = 100;

export interface LoopTauriRepos {
  loopDefinitions: LoopDefinitionRepository;
  loopRevisions: LoopRevisionRepository;
  loopSkillBindings: LoopSkillBindingRepository;
  loopInvocations: LoopInvocationRepository;
}

export function createLoopTauriRepos(db: TauriDrizzleDb): LoopTauriRepos {
  const loopDefinitions: LoopDefinitionRepository = {
    async insert(row: NewLoopDefinition) {
      // No onConflictDoNothing: a duplicate loop_id must surface as a PK violation,
      // never silently drop the second create.
      await db.insert(schema.loopDefinitions).values(row);
    },
    async findById(loopId) {
      const rows = (await db
        .select()
        .from(schema.loopDefinitions)
        .where(eq(schema.loopDefinitions.loop_id, loopId))) as LoopDefinitionRow[];
      return rows[0] ?? null;
    },
    async listByCompany(companyId, opts) {
      return (await db
        .select()
        .from(schema.loopDefinitions)
        .where(eq(schema.loopDefinitions.company_id, companyId))
        .orderBy(desc(schema.loopDefinitions.updated_at))
        .limit(opts?.limit ?? DEFAULT_LIST_LIMIT)) as LoopDefinitionRow[];
    },
    async update(loopId, patch: LoopDefinitionUpdate) {
      const set: Partial<LoopDefinitionRow> = { updated_at: patch.updatedAt };
      if (patch.title !== undefined) set.title = patch.title;
      if (patch.summary !== undefined) set.summary = patch.summary;
      if (patch.status !== undefined) set.status = patch.status;
      if (patch.currentRevisionId !== undefined) set.current_revision_id = patch.currentRevisionId;
      if (patch.scheduleIntervalMinutes !== undefined)
        set.schedule_interval_minutes = patch.scheduleIntervalMinutes;
      if (patch.nextRunAt !== undefined) set.next_run_at = patch.nextRunAt;
      if (patch.lastRunAt !== undefined) set.last_run_at = patch.lastRunAt;
      if (patch.lastRunResult !== undefined) set.last_run_result = patch.lastRunResult;
      await db
        .update(schema.loopDefinitions)
        .set(set)
        .where(eq(schema.loopDefinitions.loop_id, loopId));
    },
    async delete(loopId) {
      await db.delete(schema.loopDefinitions).where(eq(schema.loopDefinitions.loop_id, loopId));
    },
  };

  const loopRevisions: LoopRevisionRepository = {
    async insert(row: NewLoopRevision) {
      // Insert-only — a duplicate (loop_id, revision_number) must surface as a real
      // error (the UNIQUE index), so the caller retries with a fresh number.
      await db.insert(schema.loopRevisions).values(row);
    },
    async findById(revisionId) {
      const rows = (await db
        .select()
        .from(schema.loopRevisions)
        .where(eq(schema.loopRevisions.revision_id, revisionId))) as LoopRevisionRow[];
      return rows[0] ?? null;
    },
    async listByLoop(loopId) {
      return (await db
        .select()
        .from(schema.loopRevisions)
        .where(eq(schema.loopRevisions.loop_id, loopId))
        .orderBy(asc(schema.loopRevisions.revision_number))) as LoopRevisionRow[];
    },
    async maxRevisionNumber(loopId) {
      const rows = (await db
        .select({ max: sql<number | null>`max(${schema.loopRevisions.revision_number})` })
        .from(schema.loopRevisions)
        .where(eq(schema.loopRevisions.loop_id, loopId))) as Array<{ max: number | null }>;
      return rows[0]?.max ?? 0;
    },
  };

  const loopSkillBindings: LoopSkillBindingRepository = {
    async insert(row: NewLoopSkillBinding) {
      // No onConflictDoNothing: a duplicate binding_id must surface as a PK
      // violation, never silently drop a skill binding (which would change the
      // loop's resolved skills and thus its behavior).
      await db.insert(schema.loopSkillBindings).values(row);
    },
    async listByRevision(revisionId) {
      return (await db
        .select()
        .from(schema.loopSkillBindings)
        .where(eq(schema.loopSkillBindings.revision_id, revisionId))
        .orderBy(asc(schema.loopSkillBindings.order_index))) as LoopSkillBindingRow[];
    },
  };

  const loopInvocations: LoopInvocationRepository = {
    async insert(row: NewLoopInvocation) {
      // No onConflictDoNothing: invocation ids are fresh per send and the no-orphan
      // compensation deletes-then-re-inserts with a NEW id, so insert is never
      // idempotent by design. A duplicate id must surface as a PK violation (mirrors
      // loop_definitions / loop_revisions) — a silent skip would let a later
      // setMissionId() link a new mission onto an OLD row.
      await db.insert(schema.loopInvocations).values(row);
    },
    async findById(invocationId) {
      const rows = (await db
        .select()
        .from(schema.loopInvocations)
        .where(eq(schema.loopInvocations.invocation_id, invocationId))) as LoopInvocationRow[];
      return rows[0] ?? null;
    },
    async listByLoop(loopId) {
      return (await db
        .select()
        .from(schema.loopInvocations)
        .where(eq(schema.loopInvocations.loop_id, loopId))
        .orderBy(asc(schema.loopInvocations.created_at))) as LoopInvocationRow[];
    },
    async countByLoop(loopId) {
      const rows = (await db
        .select({ count: sql<number>`count(*)` })
        .from(schema.loopInvocations)
        .where(eq(schema.loopInvocations.loop_id, loopId))) as Array<{ count: number }>;
      return rows[0]?.count ?? 0;
    },
    async setMissionId(invocationId, missionId) {
      await db
        .update(schema.loopInvocations)
        .set({ mission_id: missionId })
        .where(eq(schema.loopInvocations.invocation_id, invocationId));
    },
    async deleteById(invocationId) {
      // Send-time compensation only (PR-10): undo a just-inserted orphan invocation
      // when the rest of the Send transaction fails, so no orphan survives.
      await db
        .delete(schema.loopInvocations)
        .where(eq(schema.loopInvocations.invocation_id, invocationId));
    },
  };

  return { loopDefinitions, loopRevisions, loopSkillBindings, loopInvocations };
}
