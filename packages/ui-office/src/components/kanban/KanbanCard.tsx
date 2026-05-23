import { Button, cn } from '@offisim/ui-core';
import type { TaskInfo } from '../../hooks/useTaskDashboard';

// ---------------------------------------------------------------------------
// Status → visual mapping
// ---------------------------------------------------------------------------

function statusDot(status: string): string {
  switch (status) {
    case 'completed':
      return 'bg-success';
    case 'active':
    case 'running':
      return 'bg-info animate-pulse';
    case 'failed':
    case 'cancelled':
      return 'bg-error';
    case 'review_ready':
      return 'bg-warning';
    default:
      return 'bg-text-muted';
  }
}

function statusLabel(status: string): string {
  switch (status) {
    case 'completed':
      return 'Done';
    case 'active':
    case 'running':
      return 'Running';
    case 'failed':
      return 'Failed';
    case 'cancelled':
      return 'Cancelled';
    case 'review_ready':
      return 'Review';
    case 'planned':
      return 'Planned';
    default:
      return status;
  }
}

function roleBadgeColor(taskType: string): string {
  if (taskType.includes('dev') || taskType.includes('code')) return 'bg-info-muted text-info';
  if (taskType.includes('design') || taskType.includes('art'))
    return 'bg-accent-muted text-accent-text';
  if (taskType.includes('test') || taskType.includes('qa')) return 'bg-warning-muted text-warning';
  if (taskType.includes('review')) return 'bg-accent-muted text-accent-text';
  return 'bg-surface-muted text-text-secondary';
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
        'h-auto w-full flex-col items-stretch rounded-lg border text-left transition-colors duration-150',
        'flex flex-col gap-1.5 px-2.5 py-2',
        'border-border-default bg-surface hover:border-border-strong hover:bg-surface-hover',
        task.status === 'active' || task.status === 'running'
          ? 'border-info shadow-glow-accent'
          : '',
        task.status === 'failed' || task.status === 'cancelled' ? 'border-error' : '',
        onClick ? 'cursor-pointer' : 'cursor-default',
      )}
      onClick={() => onClick?.(task.taskRunId)}
    >
      {/* Top row: employee + status */}
      <div className="flex items-center gap-1.5">
        <span className={cn('size-1.5 shrink-0 rounded-full', statusDot(task.status))} />
        <span className="flex-1 truncate text-caption font-semibold text-text-primary">
          {task.employeeName ?? task.employeeId ?? 'Unassigned'}
        </span>
        <span className="shrink-0 text-caption uppercase tracking-wide text-text-muted">
          {statusLabel(task.status)}
        </span>
      </div>

      {/* Description */}
      <p className="line-clamp-2 text-caption leading-relaxed text-text-secondary">
        {task.description || task.taskType}
      </p>

      {/* Bottom row: role badge + cost */}
      <div className="flex items-center gap-1.5">
        {task.taskType && (
          <span className={cn('rounded px-1.5 py-0.5 text-caption', roleBadgeColor(task.taskType))}>
            {task.taskType}
          </span>
        )}
        {taskCost > 0 && (
          <span className="ml-auto font-mono text-caption text-success">
            ${taskCost.toFixed(4)}
          </span>
        )}
      </div>
    </Button>
  );
}
