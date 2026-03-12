import type { TaskInfo } from '../../hooks/useTaskDashboard';
import { cn } from '../../lib/utils';

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

export function TaskItem({ task }: { task: TaskInfo }) {
  return (
    <li className={cn(
      'flex items-center gap-2 text-[10px] transition-colors duration-500',
      task.status === 'running' && 'border-l-2 border-koi pl-1',
    )}>
      <span className={cn('rounded px-1 py-0.5', statusBadgeColor(task.status))}>
        {task.status}
      </span>
      <span className="text-koi">{task.employeeName ?? task.employeeId ?? 'Unassigned'}</span>
      <span className="truncate text-shell">{task.description || task.taskType}</span>
    </li>
  );
}
