import type {
  EmployeeProjectMemoryPatch,
  EmployeeProjectMemoryRepository,
  EmployeeProjectMemoryRow,
  NewEmployeeProjectMemory,
} from '../../repositories.js';

export class MemoryEmployeeProjectMemoryRepository implements EmployeeProjectMemoryRepository {
  private readonly store = new Map<string, EmployeeProjectMemoryRow>();

  async create(input: NewEmployeeProjectMemory): Promise<EmployeeProjectMemoryRow> {
    const row: EmployeeProjectMemoryRow = {
      ...input,
      source_run_id: input.source_run_id ?? null,
      pinned: input.pinned ?? false,
      hit_count: input.hit_count ?? 0,
      last_hit_at: input.last_hit_at ?? null,
    };
    this.store.set(row.memory_id, row);
    return row;
  }

  async findById(memoryId: string): Promise<EmployeeProjectMemoryRow | null> {
    return this.store.get(memoryId) ?? null;
  }

  async listByEmployee(employeeId: string): Promise<EmployeeProjectMemoryRow[]> {
    return [...this.store.values()]
      .filter((row) => row.employee_id === employeeId)
      .sort((left, right) => right.updated_at.localeCompare(left.updated_at));
  }

  async listByProject(employeeId: string, projectId: string): Promise<EmployeeProjectMemoryRow[]> {
    return [...this.store.values()]
      .filter((row) => row.employee_id === employeeId && row.project_id === projectId)
      .sort(
        (left, right) =>
          Number(right.pinned) - Number(left.pinned) ||
          right.hit_count - left.hit_count ||
          right.updated_at.localeCompare(left.updated_at),
      );
  }

  async listByProjectScope(
    companyId: string,
    projectId: string,
  ): Promise<EmployeeProjectMemoryRow[]> {
    return [...this.store.values()]
      .filter((row) => row.company_id === companyId && row.project_id === projectId)
      .sort(
        (left, right) =>
          Number(right.pinned) - Number(left.pinned) ||
          right.hit_count - left.hit_count ||
          right.updated_at.localeCompare(left.updated_at),
      );
  }

  async update(memoryId: string, patch: EmployeeProjectMemoryPatch): Promise<void> {
    const row = this.store.get(memoryId);
    if (row) this.store.set(memoryId, { ...row, ...patch });
  }

  async delete(memoryId: string): Promise<void> {
    this.store.delete(memoryId);
  }

  async incrementHits(memoryIds: readonly string[], hitAt: string): Promise<void> {
    for (const memoryId of memoryIds) {
      const row = this.store.get(memoryId);
      if (row) {
        this.store.set(memoryId, {
          ...row,
          hit_count: row.hit_count + 1,
          last_hit_at: hitAt,
        });
      }
    }
  }
}
