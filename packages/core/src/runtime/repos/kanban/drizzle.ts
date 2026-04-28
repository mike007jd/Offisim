import * as schema from '@offisim/db-local/dist/schema.js';
import type { KanbanState } from '@offisim/shared-types';
import { and, asc, eq } from 'drizzle-orm';
import type { BetterSQLite3Database } from 'drizzle-orm/better-sqlite3';
import type { EventBus } from '../../../events/event-bus.js';
import type { KanbanCardRow } from '../../repositories.js';
import { KanbanRepo, type KanbanRepoStorage } from '../kanban-repo.js';

type Db = BetterSQLite3Database<typeof schema>;

class DrizzleKanbanStorage implements KanbanRepoStorage {
  constructor(private readonly db: Db) {}

  async insert(row: KanbanCardRow): Promise<KanbanCardRow> {
    this.db.insert(schema.kanbanCards).values(row).run();
    return row;
  }

  async update(
    id: string,
    patch: Partial<
      Pick<KanbanCardRow, 'state' | 'blocked_reason' | 'assigned_employee_id' | 'updated_at'>
    >,
  ): Promise<KanbanCardRow | null> {
    this.db.update(schema.kanbanCards).set(patch).where(eq(schema.kanbanCards.id, id)).run();
    return this.findById(id);
  }

  async findById(id: string): Promise<KanbanCardRow | null> {
    const rows = this.db
      .select()
      .from(schema.kanbanCards)
      .where(eq(schema.kanbanCards.id, id))
      .all();
    return (rows[0] as KanbanCardRow | undefined) ?? null;
  }

  async listByProject(projectId: string): Promise<KanbanCardRow[]> {
    return this.db
      .select()
      .from(schema.kanbanCards)
      .where(eq(schema.kanbanCards.project_id, projectId))
      .orderBy(asc(schema.kanbanCards.sort_order), asc(schema.kanbanCards.created_at))
      .all() as KanbanCardRow[];
  }

  async listByEmployee(employeeId: string, state?: KanbanState): Promise<KanbanCardRow[]> {
    const where = state
      ? and(
          eq(schema.kanbanCards.assigned_employee_id, employeeId),
          eq(schema.kanbanCards.state, state),
        )
      : eq(schema.kanbanCards.assigned_employee_id, employeeId);
    return this.db
      .select()
      .from(schema.kanbanCards)
      .where(where)
      .orderBy(asc(schema.kanbanCards.sort_order), asc(schema.kanbanCards.created_at))
      .all() as KanbanCardRow[];
  }

  async listByTaskRun(taskRunId: string): Promise<KanbanCardRow[]> {
    return this.db
      .select()
      .from(schema.kanbanCards)
      .where(eq(schema.kanbanCards.task_run_id, taskRunId))
      .orderBy(asc(schema.kanbanCards.sort_order), asc(schema.kanbanCards.created_at))
      .all() as KanbanCardRow[];
  }
}

export interface KanbanDrizzleRepos {
  kanban: KanbanRepo;
}

export function createKanbanDrizzleRepos(db: Db, eventBus?: EventBus): KanbanDrizzleRepos {
  return { kanban: new KanbanRepo(new DrizzleKanbanStorage(db), eventBus) };
}
