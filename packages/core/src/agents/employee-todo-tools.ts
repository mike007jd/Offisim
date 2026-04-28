import { isKanbanState } from '@offisim/shared-types';
import type { OffisimGraphState } from '../graph/state.js';
import type { ToolDef } from '../llm/gateway.js';
import type { RuntimeContext } from '../runtime/runtime-context.js';
import type { PreflightResult } from './employee-preflight.js';

export const TODO_TOOL_NAMES = ['todo_create', 'todo_update', 'todo_list'] as const;
export type TodoToolName = (typeof TODO_TOOL_NAMES)[number];

const TODO_TOOLS: readonly ToolDef[] = Object.freeze([
  {
    name: 'todo_create',
    description: 'Create a kanban todo card for this employee-led task.',
    parameters: {
      type: 'object',
      properties: {
        title: { type: 'string', description: 'Short card title' },
        note: { type: 'string', description: 'Optional implementation notes' },
        projectId: { type: 'string', description: 'Project ID; defaults to current project' },
        assignedEmployeeId: {
          type: 'string',
          description: 'Employee to assign; defaults to the current employee',
        },
      },
      required: ['title'],
    },
  },
  {
    name: 'todo_update',
    description: 'Move a kanban todo card to todo, doing, blocked, review, or done.',
    parameters: {
      type: 'object',
      properties: {
        id: { type: 'string', description: 'Kanban card ID' },
        state: {
          type: 'string',
          enum: ['todo', 'doing', 'blocked', 'review', 'done'],
          description: 'Next kanban card state',
        },
        blockedReason: { type: 'string', description: 'Reason when blocked or in review' },
      },
      required: ['id', 'state'],
    },
  },
  {
    name: 'todo_list',
    description: 'List kanban todo cards assigned to this employee.',
    parameters: {
      type: 'object',
      properties: {
        state: {
          type: 'string',
          enum: ['todo', 'doing', 'blocked', 'review', 'done'],
          description: 'Optional state filter',
        },
        projectId: { type: 'string', description: 'Optional project filter' },
      },
    },
  },
]);

export function buildTodoTools(): ToolDef[] {
  return TODO_TOOLS as ToolDef[];
}

export function isTodoTool(name: string): name is TodoToolName {
  return (TODO_TOOL_NAMES as readonly string[]).includes(name);
}

export async function handleTodoTool(
  name: TodoToolName,
  args: unknown,
  preflight: PreflightResult,
  runtimeCtx: RuntimeContext,
  state: OffisimGraphState,
): Promise<unknown> {
  const parsed = objectArgs(args);
  if (name === 'todo_create') {
    const title = stringArg(parsed, 'title');
    if (!title) return { success: false, error: 'todo_create requires title' };
    const projectId = stringArg(parsed, 'projectId') ?? state.projectId;
    if (!projectId) return { success: false, error: 'todo_create requires a projectId' };
    const card = await runtimeCtx.repos.kanban.create({
      project_id: projectId,
      company_id: runtimeCtx.companyId,
      title,
      note: stringArg(parsed, 'note') ?? '',
      origin: 'employee',
      created_by_employee_id: preflight.employee.employee_id,
      assigned_employee_id:
        stringArg(parsed, 'assignedEmployeeId') ?? preflight.employee.employee_id,
      task_run_id: preflight.taskRunId ?? state.currentTaskRunId,
    });
    return { success: true, card };
  }

  if (name === 'todo_update') {
    const id = stringArg(parsed, 'id');
    const nextState = stringArg(parsed, 'state');
    if (!id) return { success: false, error: 'todo_update requires id' };
    if (!nextState || !isKanbanState(nextState)) {
      return { success: false, error: 'todo_update requires a valid state' };
    }
    const card = await runtimeCtx.repos.kanban.transition(
      id,
      nextState,
      stringArg(parsed, 'blockedReason'),
    );
    return card ? { success: true, card } : { success: false, error: `Card ${id} not found` };
  }

  const filterState = stringArg(parsed, 'state');
  if (filterState && !isKanbanState(filterState)) {
    return { success: false, error: 'todo_list state filter is invalid' };
  }
  const stateFilter = filterState && isKanbanState(filterState) ? filterState : undefined;
  const cards = await runtimeCtx.repos.kanban.listByEmployee(
    preflight.employee.employee_id,
    stateFilter,
  );
  const projectId = stringArg(parsed, 'projectId');
  return {
    success: true,
    cards: projectId ? cards.filter((card) => card.project_id === projectId) : cards,
  };
}

function objectArgs(args: unknown): Record<string, unknown> {
  return args && typeof args === 'object' ? (args as Record<string, unknown>) : {};
}

function stringArg(args: Record<string, unknown>, key: string): string | undefined {
  const value = args[key];
  return typeof value === 'string' && value.trim().length > 0 ? value.trim() : undefined;
}
