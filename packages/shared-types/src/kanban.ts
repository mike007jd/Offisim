import stateMachine from './kanban-state-machine.json' with { type: 'json' };

const STATE_MACHINE_TRANSITIONS = stateMachine.transitions;

export type KanbanState = keyof typeof STATE_MACHINE_TRANSITIONS;
export const KANBAN_STATES = Object.keys(STATE_MACHINE_TRANSITIONS) as readonly KanbanState[];

export const KANBAN_ORIGINS = ['pm-planner', 'employee', 'manager', 'human'] as const;
export type KanbanOrigin = (typeof KANBAN_ORIGINS)[number];

export const KANBAN_TRANSITIONS = STATE_MACHINE_TRANSITIONS as Record<
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
