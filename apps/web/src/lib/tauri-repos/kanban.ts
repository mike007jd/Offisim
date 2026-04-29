import type { EventBus, KanbanCardRow, RuntimeRepositories } from '@offisim/core/browser';
import * as schema from '@offisim/db-local';
import type { KanbanState } from '@offisim/shared-types';
import { and, asc, eq } from 'drizzle-orm';
import type { TauriDrizzleDb } from '../tauri-drizzle';

type InvokeFn = <T>(cmd: string, args?: Record<string, unknown>) => Promise<T>;
type KanbanCardPatch = Partial<
  Pick<KanbanCardRow, 'state' | 'blocked_reason' | 'assigned_employee_id' | 'updated_at'>
>;

const ALLOWED_TRANSITIONS: Record<KanbanState, ReadonlySet<KanbanState>> = {
  todo: new Set(['doing', 'blocked', 'review', 'done']),
  doing: new Set(['todo', 'blocked', 'review', 'done']),
  blocked: new Set(['todo', 'doing', 'review']),
  review: new Set(['doing', 'blocked', 'done']),
  done: new Set(),
};

function emitKanban(
  eventBus: EventBus | undefined,
  op: 'created' | 'transitioned' | 'assigned',
  card: KanbanCardRow,
): void {
  eventBus?.emit({
    type: `kanban.card.${op}`,
    entityId: card.id,
    entityType: 'task',
    companyId: card.company_id,
    timestamp: Date.now(),
    payload: { kind: 'kanban', op, card },
  });
}

export interface KanbanTauriRepos {
  kanban: RuntimeRepositories['kanban'];
}

export function createKanbanTauriRepos(db: TauriDrizzleDb, eventBus?: EventBus): KanbanTauriRepos {
  const findById = async (id: string): Promise<KanbanCardRow | null> => {
    const rows = await db.select().from(schema.kanbanCards).where(eq(schema.kanbanCards.id, id));
    return (rows[0] as KanbanCardRow | undefined) ?? null;
  };

  const compareAndUpdateViaRust = async (
    id: string,
    expectedState: KanbanState,
    patch: KanbanCardPatch,
  ): Promise<KanbanCardRow | null> => {
    try {
      const { invoke } = (await import('@tauri-apps/api/core')) as { invoke: InvokeFn };
      const card = await invoke<Record<string, unknown> | null>('transition_kanban_card', {
        id,
        next: patch.state,
        reason: patch.blocked_reason ?? null,
        expectedState,
      });
      if (!card) return null;
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      if (message.includes('kanban transition stale')) return null;
      throw error;
    }
    return findById(id);
  };

  const listByTaskRun = async (taskRunId: string): Promise<KanbanCardRow[]> =>
    (await db
      .select()
      .from(schema.kanbanCards)
      .where(eq(schema.kanbanCards.task_run_id, taskRunId))
      .orderBy(
        asc(schema.kanbanCards.sort_order),
        asc(schema.kanbanCards.created_at),
      )) as KanbanCardRow[];

  const kanban: RuntimeRepositories['kanban'] = {
    async create(input) {
      const ts = new Date().toISOString();
      const row: KanbanCardRow = {
        id: input.id ?? crypto.randomUUID(),
        project_id: input.project_id,
        company_id: input.company_id,
        title: input.title,
        note: input.note ?? '',
        state: input.state ?? 'todo',
        origin: input.origin,
        created_by_employee_id: input.created_by_employee_id ?? null,
        assigned_employee_id: input.assigned_employee_id ?? null,
        parent_card_id: input.parent_card_id ?? null,
        blocked_reason: input.blocked_reason ?? null,
        task_run_id: input.task_run_id ?? null,
        sort_order: input.sort_order ?? 0,
        created_at: ts,
        updated_at: ts,
      };
      await db.insert(schema.kanbanCards).values(row);
      emitKanban(eventBus, 'created', row);
      return row;
    },
    async transition(id, next, blockedReason) {
      const current = await findById(id);
      if (!current) return null;
      if (current.state === next && current.blocked_reason === (blockedReason ?? null)) {
        return current;
      }
      if (!ALLOWED_TRANSITIONS[current.state].has(next)) {
        throw new Error(`Invalid kanban transition: ${current.state} -> ${next}`);
      }
      const card = await compareAndUpdateViaRust(id, current.state, {
        state: next,
        blocked_reason: blockedReason ?? null,
        updated_at: new Date().toISOString(),
      });
      if (!card) {
        const actual = await findById(id);
        throw new Error(
          `Kanban transition stale: ${id} moved from ${current.state} to ${actual?.state ?? '<missing>'}; cannot transition to ${next}`,
        );
      }
      emitKanban(eventBus, 'transitioned', card);
      return card;
    },
    async transitionByTaskRun(taskRunId, next, blockedReason) {
      const cards = await listByTaskRun(taskRunId);
      for (const card of cards) {
        await kanban.transition(card.id, next, blockedReason);
      }
    },
    async listByProject(projectId) {
      return (await db
        .select()
        .from(schema.kanbanCards)
        .where(eq(schema.kanbanCards.project_id, projectId))
        .orderBy(
          asc(schema.kanbanCards.sort_order),
          asc(schema.kanbanCards.created_at),
        )) as KanbanCardRow[];
    },
    async listByEmployee(employeeId, state?: KanbanState) {
      const where = state
        ? and(
            eq(schema.kanbanCards.assigned_employee_id, employeeId),
            eq(schema.kanbanCards.state, state),
          )
        : eq(schema.kanbanCards.assigned_employee_id, employeeId);
      return (await db
        .select()
        .from(schema.kanbanCards)
        .where(where)
        .orderBy(
          asc(schema.kanbanCards.sort_order),
          asc(schema.kanbanCards.created_at),
        )) as KanbanCardRow[];
    },
    async assign(id, employeeId) {
      await db
        .update(schema.kanbanCards)
        .set({ assigned_employee_id: employeeId, updated_at: new Date().toISOString() })
        .where(eq(schema.kanbanCards.id, id));
      const card = await findById(id);
      if (card) emitKanban(eventBus, 'assigned', card);
    },
  };

  return { kanban };
}
