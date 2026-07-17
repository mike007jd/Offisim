import * as schema from '@offisim/db-local/dist/schema.js';
import { and, desc, eq, inArray, sql } from 'drizzle-orm';
import type { BetterSQLite3Database } from 'drizzle-orm/better-sqlite3';
import type {
  EmployeeProjectMemoryRepository,
  EmployeeProjectMemoryRow,
  NewEmployeeProjectMemory,
} from '../../repositories.js';

type Db = BetterSQLite3Database<typeof schema>;

export function createEmployeeProjectMemoriesDrizzleRepo(db: Db): EmployeeProjectMemoryRepository {
  return {
    async create(input: NewEmployeeProjectMemory) {
      const row: EmployeeProjectMemoryRow = {
        ...input,
        source_run_id: input.source_run_id ?? null,
        pinned: input.pinned ?? false,
        hit_count: input.hit_count ?? 0,
        last_hit_at: input.last_hit_at ?? null,
      };
      db.insert(schema.employeeProjectMemories).values(row).run();
      return row;
    },
    async findById(memoryId) {
      return (
        (db
          .select()
          .from(schema.employeeProjectMemories)
          .where(eq(schema.employeeProjectMemories.memory_id, memoryId))
          .get() as EmployeeProjectMemoryRow | undefined) ?? null
      );
    },
    async listByEmployee(employeeId) {
      return db
        .select()
        .from(schema.employeeProjectMemories)
        .where(eq(schema.employeeProjectMemories.employee_id, employeeId))
        .orderBy(desc(schema.employeeProjectMemories.updated_at))
        .all() as EmployeeProjectMemoryRow[];
    },
    async listByProject(employeeId, projectId) {
      return db
        .select()
        .from(schema.employeeProjectMemories)
        .where(
          and(
            eq(schema.employeeProjectMemories.employee_id, employeeId),
            eq(schema.employeeProjectMemories.project_id, projectId),
          ),
        )
        .orderBy(
          desc(schema.employeeProjectMemories.pinned),
          desc(schema.employeeProjectMemories.hit_count),
          desc(schema.employeeProjectMemories.updated_at),
        )
        .all() as EmployeeProjectMemoryRow[];
    },
    async listByProjectScope(companyId, projectId) {
      return db
        .select()
        .from(schema.employeeProjectMemories)
        .where(
          and(
            eq(schema.employeeProjectMemories.company_id, companyId),
            eq(schema.employeeProjectMemories.project_id, projectId),
          ),
        )
        .orderBy(
          desc(schema.employeeProjectMemories.pinned),
          desc(schema.employeeProjectMemories.hit_count),
          desc(schema.employeeProjectMemories.updated_at),
        )
        .all() as EmployeeProjectMemoryRow[];
    },
    async update(memoryId, patch) {
      db.update(schema.employeeProjectMemories)
        .set(patch)
        .where(eq(schema.employeeProjectMemories.memory_id, memoryId))
        .run();
    },
    async delete(memoryId) {
      db.delete(schema.employeeProjectMemories)
        .where(eq(schema.employeeProjectMemories.memory_id, memoryId))
        .run();
    },
    async incrementHits(memoryIds, hitAt) {
      if (memoryIds.length === 0) return;
      db.update(schema.employeeProjectMemories)
        .set({
          hit_count: sql`${schema.employeeProjectMemories.hit_count} + 1`,
          last_hit_at: hitAt,
        })
        .where(inArray(schema.employeeProjectMemories.memory_id, [...memoryIds]))
        .run();
    },
  };
}
