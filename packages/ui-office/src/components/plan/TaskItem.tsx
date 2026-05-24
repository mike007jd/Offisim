import { Button, cn } from '@offisim/ui-core';
import type { TaskInfo } from '../../hooks/useTaskDashboard';
import { taskStatusBadgeClass, taskStatusLabel } from '../../lib/status-display';
import { TaskDetailPanel } from '../dashboard/TaskDetailPanel';

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
      <Button
        type="button"
        data-task-run-id={task.taskRunId}
        variant="ghost"
        className={cn(
          'h-auto w-full justify-start gap-2 text-left text-fs-micro transition-colors duration-500',
          'rounded px-1 py-0.5 hover:bg-surface-sunken',
          task.status === 'running' && 'border-l-2 border-accent pl-1',
          isExpanded && 'bg-surface-sunken',
          onTaskClick ? 'cursor-pointer' : 'cursor-default',
        )}
        onClick={() => onTaskClick?.(task.taskRunId)}
      >
        <span className={cn('shrink-0 rounded px-1 py-0.5', taskStatusBadgeClass(task.status))}>
          {taskStatusLabel(task.status)}
        </span>
        <span className="shrink-0 text-accent">
          {task.assigneeName ?? task.employeeName ?? task.employeeId ?? 'Unassigned'}
        </span>
        <span className="truncate text-ink-1">{task.description || task.taskType}</span>
        {taskCost > 0 && <span className="shrink-0 font-mono text-ok">${taskCost.toFixed(4)}</span>}
      </Button>

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
              employeeName: task.assigneeName ?? task.employeeName ?? undefined,
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
