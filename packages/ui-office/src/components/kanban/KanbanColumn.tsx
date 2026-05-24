import { EmptyState } from '@offisim/ui-core';
import type { TaskInfo } from '../../hooks/useTaskDashboard';
import { KanbanCard } from './KanbanCard';

function progressText(tasks: TaskInfo[]): string {
  if (tasks.length === 0) return '';
  const done = tasks.filter((t) => t.status === 'completed').length;
  return `${done}/${tasks.length}`;
}

// ---------------------------------------------------------------------------
// Component
// ---------------------------------------------------------------------------

export interface KanbanColumnProps {
  /** Column title (step description or "Requirements") */
  title: string;
  /** Step index for display. null for special columns */
  stepIndex: number | null;
  /** Column status for accent color */
  status: 'pending' | 'active' | 'completed' | 'failed' | 'requirements';
  /** Tasks to render as cards */
  tasks: TaskInfo[];
  /** Called when a card is clicked */
  onTaskClick?: (taskRunId: string) => void;
  /** Cost lookup function */
  getTaskCost?: (taskRunId: string) => number;
  /** Freeform content for special columns (Requirements) */
  children?: React.ReactNode;
}

export function KanbanColumn({
  title,
  stepIndex,
  status,
  tasks,
  onTaskClick,
  getTaskCost,
  children,
}: KanbanColumnProps) {
  const progress = progressText(tasks);

  return (
    <div className="kanban-task-column" data-status={status}>
      {/* Header */}
      <div className="kanban-task-column-header">
        {stepIndex !== null && <span data-slot="step-index">#{stepIndex + 1}</span>}
        <span data-slot="title">{title}</span>
        {progress && <span data-slot="progress">{progress}</span>}
        {tasks.length > 0 &&
          (() => {
            const active = tasks.filter(
              (t) => t.status === 'active' || t.status === 'running',
            ).length;
            if (active === 0) return null;
            return (
              <span data-slot="active-count">
                <span data-slot="active-dot" />
                {active}
              </span>
            );
          })()}
      </div>

      {/* Card list */}
      <div className="kanban-task-list custom-scrollbar">
        {children}
        {tasks.map((task) => (
          <KanbanCard
            key={task.taskRunId}
            task={task}
            onClick={onTaskClick}
            taskCost={getTaskCost?.(task.taskRunId)}
          />
        ))}
        {!children && tasks.length === 0 && (
          <EmptyState title="No tasks yet" variant="compact" className="kanban-task-empty" />
        )}
      </div>
    </div>
  );
}
