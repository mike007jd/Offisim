import { Button, cn } from '@offisim/ui-core';
import { ChevronDown } from 'lucide-react';
import type { DashboardStep } from '../../hooks/useTaskDashboard';
import { taskStatusDotClass } from '../../lib/status-display';
import { TaskItem } from './TaskItem';

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
    <div className="rounded border border-border-subtle bg-surface-elevated">
      <Button
        type="button"
        variant="ghost"
        onClick={() => onToggle(step.stepIndex)}
        className="h-auto w-full justify-start gap-2 rounded-none px-2 py-1.5 text-left text-xs"
      >
        {/* Status dot */}
        <span className={cn('size-2 shrink-0 rounded-full', taskStatusDotClass(step.status))} />
        <span className="flex-1 truncate text-text-primary">
          Step {step.stepIndex + 1}: {step.description}
        </span>
        <ChevronDown
          className={cn(
            'size-3 shrink-0 text-text-secondary transition-transform',
            step.expanded && 'rotate-180',
          )}
        />
      </Button>

      {step.expanded && step.tasks.length > 0 && (
        <ul className="flex flex-col gap-1 border-t border-border-subtle px-2 py-1">
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
