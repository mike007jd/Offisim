import { cn } from '@offisim/ui-core';
import { ChevronDown } from 'lucide-react';
import type { DashboardStep } from '../../hooks/useTaskDashboard';
import { TaskItem } from './TaskItem';

// ---------------------------------------------------------------------------
// Step status → dot colour
// ---------------------------------------------------------------------------

function statusColor(status: 'pending' | 'active' | 'completed'): string {
  switch (status) {
    case 'completed':
      return 'bg-success';
    case 'active':
      return 'bg-koi';
    default:
      return 'bg-shell/40';
  }
}

// ---------------------------------------------------------------------------
// Component
// ---------------------------------------------------------------------------

export function TaskStepCard({
  step,
  onToggle,
  expandedTaskId,
  onTaskClick,
  getTaskCost,
}: {
  step: DashboardStep;
  onToggle: (i: number) => void;
  expandedTaskId?: string | null;
  onTaskClick?: (taskRunId: string) => void;
  getTaskCost?: (taskRunId: string) => number;
}) {
  return (
    <div className="rounded border border-ocean-mid/20 bg-ocean-deep/50">
      <button
        type="button"
        onClick={() => onToggle(step.stepIndex)}
        className="flex w-full items-center gap-2 px-2 py-1.5 text-left text-xs"
      >
        {/* Status dot */}
        <span className={cn('h-2 w-2 shrink-0 rounded-full', statusColor(step.status))} />
        <span className="flex-1 truncate text-pearl">
          Step {step.stepIndex + 1}: {step.description}
        </span>
        <ChevronDown
          className={cn(
            'h-3 w-3 shrink-0 text-shell transition-transform',
            step.expanded && 'rotate-180',
          )}
        />
      </button>

      {step.expanded && step.tasks.length > 0 && (
        <ul className="border-t border-ocean-mid/10 px-2 py-1 space-y-1">
          {step.tasks.map((task) => (
            <TaskItem
              key={task.taskRunId}
              task={task}
              expandedTaskId={expandedTaskId}
              onTaskClick={onTaskClick}
              taskCost={getTaskCost ? getTaskCost(task.taskRunId) : 0}
            />
          ))}
        </ul>
      )}
    </div>
  );
}
