import { Button } from '@offisim/ui-core';
import { ChevronDown } from 'lucide-react';
import type { DashboardStep } from '../../hooks/useTaskDashboard';
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
    <div className="task-step-card" data-status={step.status}>
      <Button
        type="button"
        variant="ghost"
        onClick={() => onToggle(step.stepIndex)}
        className="task-step-trigger"
        data-expanded={step.expanded ? 'true' : undefined}
      >
        {/* Status dot */}
        <span className="task-step-dot" data-status={step.status} />
        <span className="task-step-title">
          Step {step.stepIndex + 1}: {step.description}
        </span>
        <ChevronDown
          className="task-step-chevron"
          data-expanded={step.expanded ? 'true' : undefined}
        />
      </Button>

      {step.expanded && step.tasks.length > 0 && (
        <ul className="task-step-list">
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
