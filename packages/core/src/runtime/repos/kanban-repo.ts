import type { KanbanOrigin, KanbanState } from '@offisim/shared-types';
import type { EventBus } from '../../events/event-bus.js';
import type { KanbanCardRow, NewKanbanCard } from '../repositories.js';

const ALLOWED_TRANSITIONS: Record<KanbanState, ReadonlySet<KanbanState>> = {
  todo: new Set(['doing', 'blocked', 'review', 'done']),
  doing: new Set(['todo', 'blocked', 'review', 'done']),
  blocked: new Set(['todo', 'doing', 'review']),
  review: new Set(['doing', 'blocked', 'done']),
  done: new Set(),
};

export class KanbanInvalidTransitionError extends Error {
  constructor(
    readonly current: KanbanState,
    readonly next: KanbanState,
  ) {
    super(`Invalid kanban transition: ${current} -> ${next}`);
    this.name = 'KanbanInvalidTransitionError';
  }
}

export interface KanbanRepoStorage {
  insert(row: KanbanCardRow): Promise<KanbanCardRow>;
  update(
    id: string,
    patch: Partial<
      Pick<KanbanCardRow, 'state' | 'blocked_reason' | 'assigned_employee_id' | 'updated_at'>
    >,
  ): Promise<KanbanCardRow | null>;
  findById(id: string): Promise<KanbanCardRow | null>;
  listByProject(projectId: string): Promise<KanbanCardRow[]>;
  listByEmployee(employeeId: string, state?: KanbanState): Promise<KanbanCardRow[]>;
  listByTaskRun(taskRunId: string): Promise<KanbanCardRow[]>;
}

export class KanbanRepo {
  constructor(
    private readonly storage: KanbanRepoStorage,
    private readonly eventBus?: EventBus,
  ) {}

  async create(input: NewKanbanCard): Promise<KanbanCardRow> {
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
    const card = await this.storage.insert(row);
    this.emit('created', card);
    return card;
  }

  async transition(
    id: string,
    next: KanbanState,
    blockedReason?: string | null,
  ): Promise<KanbanCardRow | null> {
    const current = await this.storage.findById(id);
    if (!current) return null;
    if (current.state === next && current.blocked_reason === (blockedReason ?? null)) {
      return current;
    }
    if (!ALLOWED_TRANSITIONS[current.state].has(next)) {
      throw new KanbanInvalidTransitionError(current.state, next);
    }
    const card = await this.storage.update(id, {
      state: next,
      blocked_reason: blockedReason ?? null,
      updated_at: new Date().toISOString(),
    });
    if (card) this.emit('transitioned', card);
    return card;
  }

  async transitionByTaskRun(
    taskRunId: string,
    next: KanbanState,
    blockedReason?: string | null,
  ): Promise<void> {
    const cards = await this.storage.listByTaskRun(taskRunId);
    for (const card of cards) {
      await this.transition(card.id, next, blockedReason);
    }
  }

  async listByProject(projectId: string): Promise<KanbanCardRow[]> {
    return this.storage.listByProject(projectId);
  }

  async listByEmployee(employeeId: string, state?: KanbanState): Promise<KanbanCardRow[]> {
    return this.storage.listByEmployee(employeeId, state);
  }

  async assign(id: string, employeeId: string): Promise<void> {
    const card = await this.storage.update(id, {
      assigned_employee_id: employeeId,
      updated_at: new Date().toISOString(),
    });
    if (card) this.emit('assigned', card);
  }

  private emit(op: 'created' | 'transitioned' | 'assigned', card: KanbanCardRow): void {
    this.eventBus?.emit({
      type: `kanban.card.${op}`,
      entityId: card.id,
      entityType: 'task',
      companyId: card.company_id,
      timestamp: Date.now(),
      payload: { kind: 'kanban', op, card },
    });
  }
}

export type { KanbanOrigin, KanbanState };
