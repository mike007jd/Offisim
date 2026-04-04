import { cn } from '@offisim/ui-core';
import type { TaskInfo } from '../../hooks/useTaskDashboard';

// ---------------------------------------------------------------------------
// Status → visual mapping
// ---------------------------------------------------------------------------

function statusDot(status: string): string {
  switch (status) {
    case 'completed':
      return 'bg-green-400';
    case 'active':
    case 'running':
      return 'bg-blue-400 animate-pulse';
    case 'failed':
    case 'cancelled':
      return 'bg-red-400';
    case 'review_ready':
      return 'bg-amber-400';
    default:
      return 'bg-slate-500';
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
  if (taskType.includes('dev') || taskType.includes('code')) return 'bg-blue-500/20 text-blue-300';
  if (taskType.includes('design') || taskType.includes('art'))
    return 'bg-purple-500/20 text-purple-300';
  if (taskType.includes('test') || taskType.includes('qa')) return 'bg-amber-500/20 text-amber-300';
  if (taskType.includes('review')) return 'bg-cyan-500/20 text-cyan-300';
  return 'bg-slate-500/20 text-slate-400';
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
    <button
      type="button"
      data-task-run-id={task.taskRunId}
      className={cn(
        'w-full text-left rounded-lg border transition-colors duration-150',
        'px-2.5 py-2 space-y-1.5',
        'border-white/[0.06] bg-[var(--surface)] hover:bg-white/[0.06] hover:border-white/15',
        task.status === 'active' || task.status === 'running'
          ? 'border-blue-500/30 shadow-[0_0_8px_rgba(59,130,246,0.08)]'
          : '',
        task.status === 'failed' || task.status === 'cancelled' ? 'border-red-500/20' : '',
        onClick ? 'cursor-pointer' : 'cursor-default',
      )}
      onClick={() => onClick?.(task.taskRunId)}
    >
      {/* Top row: employee + status */}
      <div className="flex items-center gap-1.5">
        <span className={cn('h-1.5 w-1.5 shrink-0 rounded-full', statusDot(task.status))} />
        <span className="text-[11px] font-semibold text-slate-200 truncate flex-1">
          {task.employeeName ?? task.employeeId ?? 'Unassigned'}
        </span>
        <span className="text-[10px] text-slate-500 uppercase tracking-wide shrink-0">
          {statusLabel(task.status)}
        </span>
      </div>

      {/* Description */}
      <p className="text-[10px] text-slate-400 leading-relaxed line-clamp-2">
        {task.description || task.taskType}
      </p>

      {/* Bottom row: role badge + cost */}
      <div className="flex items-center gap-1.5">
        {task.taskType && (
          <span className={cn('text-[10px] px-1.5 py-0.5 rounded', roleBadgeColor(task.taskType))}>
            {task.taskType}
          </span>
        )}
        {taskCost > 0 && (
          <span className="ml-auto text-[10px] font-mono text-emerald-400/70">
            ${taskCost.toFixed(4)}
          </span>
        )}
      </div>
    </button>
  );
}
