import { Badge, Button } from '@offisim/ui-core';
import type { TaskInfo } from '../../hooks/useTaskDashboard';
import { taskStatusBadgeVariant, taskStatusLabel } from '../../lib/status-display';
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
    <li className="task-item">
      <Button
        type="button"
        data-task-run-id={task.taskRunId}
        data-status={task.status}
        data-expanded={isExpanded ? 'true' : undefined}
        data-clickable={onTaskClick ? 'true' : 'false'}
        variant="ghost"
        className="task-item-trigger"
        onClick={() => onTaskClick?.(task.taskRunId)}
      >
        <Badge variant={taskStatusBadgeVariant(task.status)} size="xs" className="task-item-status">
          {taskStatusLabel(task.status)}
        </Badge>
        <span className="task-item-assignee">
          {task.assigneeName ?? task.employeeName ?? task.employeeId ?? 'Unassigned'}
        </span>
        <span className="task-item-description">{task.description || task.taskType}</span>
        {taskCost > 0 && <span className="task-item-cost">${taskCost.toFixed(4)}</span>}
      </Button>

      {/* Inline detail panel with CSS transition */}
      <div className="task-item-detail" data-expanded={isExpanded ? 'true' : 'false'}>
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
