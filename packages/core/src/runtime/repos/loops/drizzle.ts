import * as schema from '@offisim/db-local/dist/schema.js';
import { asc, desc, eq, sql } from 'drizzle-orm';
import type { BetterSQLite3Database } from 'drizzle-orm/better-sqlite3';
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

type Db = BetterSQLite3Database<typeof schema>;

const DEFAULT_LIST_LIMIT = 100;

export interface LoopDrizzleRepos {
  loopDefinitions: LoopDefinitionRepository;
  loopRevisions: LoopRevisionRepository;
  loopSkillBindings: LoopSkillBindingRepository;
  loopInvocations: LoopInvocationRepository;
}

export function createLoopDrizzleRepos(db: Db): LoopDrizzleRepos {
  const loopDefinitions: LoopDefinitionRepository = {
    async insert(row: NewLoopDefinition) {
      // No onConflictDoNothing: a duplicate loop_id must surface as a PK violation,
      // never silently drop the second create (which would hide a real id clash).
      db.insert(schema.loopDefinitions).values(row).run();
    },
    async findById(loopId) {
      const rows = db
        .select()
        .from(schema.loopDefinitions)
        .where(eq(schema.loopDefinitions.loop_id, loopId))
        .all() as LoopDefinitionRow[];
      return rows[0] ?? null;
    },
    async listByCompany(companyId, opts) {
      return db
        .select()
        .from(schema.loopDefinitions)
        .where(eq(schema.loopDefinitions.company_id, companyId))
        .orderBy(desc(schema.loopDefinitions.updated_at))
        .limit(opts?.limit ?? DEFAULT_LIST_LIMIT)
        .all() as LoopDefinitionRow[];
    },
    async update(loopId, patch: LoopDefinitionUpdate) {
      const set: Partial<LoopDefinitionRow> = { updated_at: patch.updatedAt };
      if (patch.title !== undefined) set.title = patch.title;
      if (patch.summary !== undefined) set.summary = patch.summary;
      if (patch.status !== undefined) set.status = patch.status;
      if (patch.currentRevisionId !== undefined) set.current_revision_id = patch.currentRevisionId;
      db.update(schema.loopDefinitions)
        .set(set)
        .where(eq(schema.loopDefinitions.loop_id, loopId))
        .run();
    },
    async delete(loopId) {
      db.delete(schema.loopDefinitions)
        .where(eq(schema.loopDefinitions.loop_id, loopId))
        .run();
    },
  };

  const loopRevisions: LoopRevisionRepository = {
    async insert(row: NewLoopRevision) {
      // Insert-only — never onConflictDoNothing for the (loop_id, revision_number)
      // UNIQUE: a duplicate must surface as a real error so a concurrent save loses
      // and the caller retries with a fresh number, rather than silently dropping.
      db.insert(schema.loopRevisions).values(row).run();
    },
    async findById(revisionId) {
      const rows = db
        .select()
        .from(schema.loopRevisions)
        .where(eq(schema.loopRevisions.revision_id, revisionId))
        .all() as LoopRevisionRow[];
      return rows[0] ?? null;
    },
    async listByLoop(loopId) {
      return db
        .select()
        .from(schema.loopRevisions)
        .where(eq(schema.loopRevisions.loop_id, loopId))
        .orderBy(asc(schema.loopRevisions.revision_number))
        .all() as LoopRevisionRow[];
    },
    async maxRevisionNumber(loopId) {
      const rows = db
        .select({ max: sql<number | null>`max(${schema.loopRevisions.revision_number})` })
        .from(schema.loopRevisions)
        .where(eq(schema.loopRevisions.loop_id, loopId))
        .all() as Array<{ max: number | null }>;
      return rows[0]?.max ?? 0;
    },
  };

  const loopSkillBindings: LoopSkillBindingRepository = {
    async insert(row: NewLoopSkillBinding) {
      // No onConflictDoNothing: a duplicate binding_id must surface as a PK
      // violation, never silently drop a skill binding (which would change the
      // loop's resolved skills and thus its behavior).
      db.insert(schema.loopSkillBindings).values(row).run();
    },
    async listByRevision(revisionId) {
      return db
        .select()
        .from(schema.loopSkillBindings)
        .where(eq(schema.loopSkillBindings.revision_id, revisionId))
        .orderBy(asc(schema.loopSkillBindings.order_index))
        .all() as LoopSkillBindingRow[];
    },
  };

  const loopInvocations: LoopInvocationRepository = {
    async insert(row: NewLoopInvocation) {
      db.insert(schema.loopInvocations)
        .values(row)
        .onConflictDoNothing({ target: schema.loopInvocations.invocation_id })
        .run();
    },
    async findById(invocationId) {
      const rows = db
        .select()
        .from(schema.loopInvocations)
        .where(eq(schema.loopInvocations.invocation_id, invocationId))
        .all() as LoopInvocationRow[];
      return rows[0] ?? null;
    },
    async listByLoop(loopId) {
      return db
        .select()
        .from(schema.loopInvocations)
        .where(eq(schema.loopInvocations.loop_id, loopId))
        .orderBy(asc(schema.loopInvocations.created_at))
        .all() as LoopInvocationRow[];
    },
    async countByLoop(loopId) {
      const rows = db
        .select({ count: sql<number>`count(*)` })
        .from(schema.loopInvocations)
        .where(eq(schema.loopInvocations.loop_id, loopId))
        .all() as Array<{ count: number }>;
      return rows[0]?.count ?? 0;
    },
    async setMissionId(invocationId, missionId) {
      db.update(schema.loopInvocations)
        .set({ mission_id: missionId })
        .where(eq(schema.loopInvocations.invocation_id, invocationId))
        .run();
    },
  };

  return { loopDefinitions, loopRevisions, loopSkillBindings, loopInvocations };
}
