import { Badge, type BadgeProps, Button, cn } from '@offisim/ui-core';
import type { TaskInfo } from '../../hooks/useTaskDashboard';
import { taskStatusCardClass, taskStatusDotClass, taskStatusLabel } from '../../lib/status-display';

function roleBadgeVariant(taskType: string): BadgeProps['variant'] {
  if (taskType.includes('test') || taskType.includes('qa')) return 'warning';
  if (
    taskType.includes('dev') ||
    taskType.includes('code') ||
    taskType.includes('design') ||
    taskType.includes('art') ||
    taskType.includes('review')
  ) {
    return 'info';
  }
  return 'secondary';
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
      className={cn('kanban-task-card', taskStatusCardClass(task.status))}
      data-interactive={onClick ? 'true' : 'false'}
      onClick={() => onClick?.(task.taskRunId)}
    >
      {/* Top row: employee + status */}
      <div className="kanban-task-card-head">
        <span className={cn('kanban-task-status-dot', taskStatusDotClass(task.status))} />
        <span data-slot="employee">{task.employeeName ?? task.employeeId ?? 'Unassigned'}</span>
        <span data-slot="status">{taskStatusLabel(task.status)}</span>
      </div>

      {/* Description */}
      <p data-slot="description">{task.description || task.taskType}</p>

      {/* Bottom row: role badge + cost */}
      <div className="kanban-task-card-foot">
        {task.taskType && (
          <Badge variant={roleBadgeVariant(task.taskType)} size="xs">
            {task.taskType}
          </Badge>
        )}
        {taskCost > 0 && <span data-slot="cost">${taskCost.toFixed(4)}</span>}
      </div>
    </Button>
  );
}
