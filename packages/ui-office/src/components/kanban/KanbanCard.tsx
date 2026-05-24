import { Button, cn } from '@offisim/ui-core';
import type { TaskInfo } from '../../hooks/useTaskDashboard';
import { taskStatusCardClass, taskStatusDotClass, taskStatusLabel } from '../../lib/status-display';

function roleBadgeColor(taskType: string): string {
  if (taskType.includes('dev') || taskType.includes('code')) return 'bg-accent-surface text-accent';
  if (taskType.includes('design') || taskType.includes('art'))
    return 'bg-accent-surface text-accent';
  if (taskType.includes('test') || taskType.includes('qa')) return 'bg-warn-surface text-warn';
  if (taskType.includes('review')) return 'bg-accent-surface text-accent';
  return 'bg-surface-2 text-ink-3';
}

// ---------------------------------------------------------------------------
// Component
// ---------------------------------------------------------------------------

export interface KanbanCardProps {
  task: TaskInfo;
  onClick?: (taskRunId: string) => void;
  taskCost?: number;
}

export function KanbanCard({ task, onClick, taskCost = 0 }: KanbanCardProps) {
  return (
    <Button
      type="button"
      data-task-run-id={task.taskRunId}
      variant="ghost"
      className={cn(
        'h-auto w-full flex-col items-stretch rounded-r-md border text-left transition-colors duration-150',
        'flex flex-col gap-1.5 px-2.5 py-2',
        'border-line bg-bg hover:border-line-strong hover:bg-surface-sunken',
        taskStatusCardClass(task.status),
        onClick ? 'cursor-pointer' : 'cursor-default',
      )}
      onClick={() => onClick?.(task.taskRunId)}
    >
      {/* Top row: employee + status */}
      <div className="flex items-center gap-1.5">
        <span className={cn('size-1.5 shrink-0 rounded-r-pill', taskStatusDotClass(task.status))} />
        <span className="flex-1 truncate text-fs-meta font-semibold text-ink-1">
          {task.employeeName ?? task.employeeId ?? 'Unassigned'}
        </span>
        <span className="shrink-0 text-fs-meta uppercase tracking-wide text-ink-4">
          {taskStatusLabel(task.status)}
        </span>
      </div>

      {/* Description */}
      <p className="line-clamp-2 text-fs-meta leading-relaxed text-ink-3">
        {task.description || task.taskType}
      </p>

      {/* Bottom row: role badge + cost */}
      <div className="flex items-center gap-1.5">
        {task.taskType && (
          <span
            className={cn('rounded-r-xs px-1.5 py-0.5 text-fs-meta', roleBadgeColor(task.taskType))}
          >
            {task.taskType}
          </span>
        )}
        {taskCost > 0 && (
          <span className="ml-auto font-mono text-fs-meta text-ok">${taskCost.toFixed(4)}</span>
        )}
      </div>
    </Button>
  );
}
