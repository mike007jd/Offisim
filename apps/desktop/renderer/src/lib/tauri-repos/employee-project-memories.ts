import type {
  EmployeeProjectMemoryRepository,
  EmployeeProjectMemoryRow,
  NewEmployeeProjectMemory,
} from '@offisim/core/browser';
import * as schema from '@offisim/db-local';
import { and, desc, eq, inArray, sql } from 'drizzle-orm';
import type { TauriDrizzleDb } from '../tauri-drizzle';

export function createEmployeeProjectMemoriesTauriRepo(
  db: TauriDrizzleDb,
): EmployeeProjectMemoryRepository {
  return {
    async create(input: NewEmployeeProjectMemory) {
      const row: EmployeeProjectMemoryRow = {
        ...input,
        source_run_id: input.source_run_id ?? null,
        pinned: input.pinned ?? false,
        hit_count: input.hit_count ?? 0,
        last_hit_at: input.last_hit_at ?? null,
      };
      await db.insert(schema.employeeProjectMemories).values(row);
      return row;
    },
    async findById(memoryId) {
      const rows = (await db
        .select()
        .from(schema.employeeProjectMemories)
        .where(
          eq(schema.employeeProjectMemories.memory_id, memoryId),
        )) as EmployeeProjectMemoryRow[];
      return rows[0] ?? null;
    },
    async listByEmployee(employeeId) {
      return (await db
        .select()
        .from(schema.employeeProjectMemories)
        .where(eq(schema.employeeProjectMemories.employee_id, employeeId))
        .orderBy(desc(schema.employeeProjectMemories.updated_at))) as EmployeeProjectMemoryRow[];
    },
    async listByProject(employeeId, projectId) {
      return (await db
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
        )) as EmployeeProjectMemoryRow[];
    },
    async listByProjectScope(companyId, projectId) {
      return (await db
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
        )) as EmployeeProjectMemoryRow[];
    },
    async update(memoryId, patch) {
      await db
        .update(schema.employeeProjectMemories)
        .set(patch)
        .where(eq(schema.employeeProjectMemories.memory_id, memoryId));
    },
    async delete(memoryId) {
      await db
        .delete(schema.employeeProjectMemories)
        .where(eq(schema.employeeProjectMemories.memory_id, memoryId));
    },
    async incrementHits(memoryIds, hitAt) {
      if (memoryIds.length === 0) return;
      await db
        .update(schema.employeeProjectMemories)
        .set({
          hit_count: sql`${schema.employeeProjectMemories.hit_count} + 1`,
          last_hit_at: hitAt,
        })
        .where(inArray(schema.employeeProjectMemories.memory_id, [...memoryIds]));
    },
  };
}
