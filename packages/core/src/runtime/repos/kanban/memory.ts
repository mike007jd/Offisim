import type { KanbanState } from '@offisim/shared-types';
import type { EventBus } from '../../../events/event-bus.js';
import type { KanbanCardRow } from '../../repositories.js';
import { KanbanRepo, type KanbanRepoStorage } from '../kanban-repo.js';
import type { MemoryRepositoriesSnapshot } from '../memory-types.js';

function cloneRows<T extends object>(rows: Iterable<T>): T[] {
  return [...rows].map((row) => ({ ...row }));
}

export class MemoryKanbanStorage implements KanbanRepoStorage {
  private readonly store = new Map<string, KanbanCardRow>();

  constructor(initialRows?: Iterable<KanbanCardRow>) {
    if (!initialRows) return;
    for (const row of initialRows) {
      this.store.set(row.id, { ...row });
    }
  }

  async insert(row: KanbanCardRow): Promise<KanbanCardRow> {
    this.store.set(row.id, { ...row });
    return { ...row };
  }

  async update(
    id: string,
    patch: Partial<
      Pick<KanbanCardRow, 'state' | 'blocked_reason' | 'assigned_employee_id' | 'updated_at'>
    >,
  ): Promise<KanbanCardRow | null> {
    const current = this.store.get(id);
    if (!current) return null;
    const next = { ...current, ...patch };
    this.store.set(id, next);
    return { ...next };
  }

  async compareAndUpdate(
    id: string,
    expectedState: KanbanState,
    patch: Partial<
      Pick<KanbanCardRow, 'state' | 'blocked_reason' | 'assigned_employee_id' | 'updated_at'>
    >,
  ): Promise<KanbanCardRow | null> {
    const current = this.store.get(id);
    if (!current || current.state !== expectedState) return null;
    const next = { ...current, ...patch };
    this.store.set(id, next);
    return { ...next };
  }

  async findById(id: string): Promise<KanbanCardRow | null> {
    const row = this.store.get(id);
    return row ? { ...row } : null;
  }

  async listByProject(projectId: string): Promise<KanbanCardRow[]> {
    return this.sorted([...this.store.values()].filter((row) => row.project_id === projectId));
  }

  async listByEmployee(employeeId: string, state?: KanbanState): Promise<KanbanCardRow[]> {
    return this.sorted(
      [...this.store.values()].filter(
        (row) => row.assigned_employee_id === employeeId && (!state || row.state === state),
      ),
    );
  }

  async listByTaskRun(taskRunId: string): Promise<KanbanCardRow[]> {
    return this.sorted([...this.store.values()].filter((row) => row.task_run_id === taskRunId));
  }

  snapshot(): KanbanCardRow[] {
    return cloneRows(this.sorted(this.store.values()));
  }

  private sorted(rows: Iterable<KanbanCardRow>): KanbanCardRow[] {
    return [...rows]
      .map((row) => ({ ...row }))
      .sort((a, b) => a.sort_order - b.sort_order || a.created_at.localeCompare(b.created_at));
  }
}

export interface KanbanMemoryRepos {
  kanban: KanbanRepo;
  kanbanStorage: MemoryKanbanStorage;
}

export function createKanbanMemoryRepos(
  snapshot?: Partial<MemoryRepositoriesSnapshot>,
  eventBus?: EventBus,
): KanbanMemoryRepos {
  const kanbanStorage = new MemoryKanbanStorage(snapshot?.kanbanCards);
  return { kanban: new KanbanRepo(kanbanStorage, eventBus), kanbanStorage };
}
