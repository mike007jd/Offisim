import type { TaskInfo } from '../../hooks/useTaskDashboard';
import { cn } from '@aics/ui-core';
import { TaskDetailPanel } from '../dashboard/TaskDetailPanel';

// ---------------------------------------------------------------------------
// Status → badge colour mapping
// ---------------------------------------------------------------------------

function statusBadgeColor(status: string): string {
  switch (status) {
    case 'completed':
      return 'bg-success/20 text-success';
    case 'active':
      return 'bg-koi/20 text-koi';
    case 'failed':
    case 'cancelled':
      return 'bg-lobster-red/20 text-lobster-red';
    case 'review_ready':
      return 'bg-sand/20 text-sand';
    default:
      return 'bg-ocean-mid/30 text-shell';
  }
}

// ---------------------------------------------------------------------------
// Component
// ---------------------------------------------------------------------------

export function TaskItem({
  task,
  expandedTaskId,
  onTaskClick,
  taskCost = 0,
}: {
  task: TaskInfo;
  expandedTaskId?: string | null;
  onTaskClick?: (taskRunId: string) => void;
  taskCost?: number;
}) {
  const isExpanded = expandedTaskId === task.taskRunId;

  return (
    <li className="flex flex-col">
      <button
        type="button"
        data-task-run-id={task.taskRunId}
        className={cn(
          'flex w-full items-center gap-2 text-left text-[10px] transition-colors duration-500',
          'rounded px-1 py-0.5 hover:bg-ocean-mid/20',
          task.status === 'running' && 'border-l-2 border-koi pl-1',
          isExpanded && 'bg-ocean-mid/10',
          onTaskClick ? 'cursor-pointer' : 'cursor-default',
        )}
        onClick={() => onTaskClick?.(task.taskRunId)}
      >
        <span className={cn('shrink-0 rounded px-1 py-0.5', statusBadgeColor(task.status))}>
          {task.status}
        </span>
        <span className="shrink-0 text-koi">{task.employeeName ?? task.employeeId ?? 'Unassigned'}</span>
        <span className="truncate text-shell">{task.description || task.taskType}</span>
        {taskCost > 0 && (
          <span className="shrink-0 font-mono text-emerald-400">${taskCost.toFixed(4)}</span>
        )}
      </button>

      {/* Inline detail panel with CSS transition */}
      <div
        className={cn(
          'transition-all duration-200 ease-in-out overflow-hidden',
          isExpanded ? 'max-h-96 opacity-100' : 'max-h-0 opacity-0',
        )}
      >
        {isExpanded && (
          <TaskDetailPanel
            task={{
              taskRunId: task.taskRunId,
              description: task.description,
              employeeName: task.employeeName ?? undefined,
              taskType: task.taskType,
              status: task.status,
            }}
            taskCost={taskCost}
          />
        )}
      </div>
    </li>
  );
}
