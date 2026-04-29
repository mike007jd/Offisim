import stateMachine from './kanban-state-machine.json' with { type: 'json' };

export const KANBAN_STATES = ['todo', 'doing', 'blocked', 'review', 'done'] as const;
export type KanbanState = (typeof KANBAN_STATES)[number];

export const KANBAN_ORIGINS = ['pm-planner', 'employee', 'manager', 'human'] as const;
export type KanbanOrigin = (typeof KANBAN_ORIGINS)[number];

export const KANBAN_TRANSITIONS = stateMachine.transitions as Record<
  KanbanState,
  readonly KanbanState[]
>;

export function isKanbanState(value: string): value is KanbanState {
  return (KANBAN_STATES as readonly string[]).includes(value);
}

export function isKanbanOrigin(value: string): value is KanbanOrigin {
  return (KANBAN_ORIGINS as readonly string[]).includes(value);
}

export function isKanbanTransitionAllowed(current: KanbanState, next: KanbanState): boolean {
  return KANBAN_TRANSITIONS[current].includes(next);
}
