import { cn } from '@offisim/ui-core';
import type { TaskInfo } from '../../hooks/useTaskDashboard';
import { KanbanCard } from './KanbanCard';

// ---------------------------------------------------------------------------
// Column status → header accent
// ---------------------------------------------------------------------------

function columnAccent(
  status: 'pending' | 'active' | 'completed' | 'failed' | 'requirements',
): string {
  switch (status) {
    case 'completed':
      return 'border-t-ok';
    case 'active':
      return 'border-t-accent';
    case 'failed':
      return 'border-t-danger';
    case 'requirements':
      return 'border-t-warn';
    default:
      return 'border-t-line';
  }
}

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
    <div
      className={cn(
        'flex w-kanban-column shrink-0 flex-col rounded-r-md',
        'border border-line border-t-2 bg-surface-1',
        columnAccent(status),
      )}
    >
      {/* Header */}
      <div className="flex items-center gap-2 border-b border-line-soft px-3 py-2">
        {stepIndex !== null && (
          <span className="shrink-0 font-mono text-fs-meta text-ink-4">#{stepIndex + 1}</span>
        )}
        <span className="flex-1 truncate text-fs-meta font-semibold text-ink-1">{title}</span>
        {progress && (
          <span className="shrink-0 font-mono text-fs-meta tabular-nums text-ink-4">
            {progress}
          </span>
        )}
        {tasks.length > 0 &&
          (() => {
            const active = tasks.filter(
              (t) => t.status === 'active' || t.status === 'running',
            ).length;
            if (active === 0) return null;
            return (
              <span className="flex items-center gap-1 text-fs-meta text-accent">
                <span className="h-1.5 w-1.5 animate-pulse rounded-r-pill bg-accent" />
                {active}
              </span>
            );
          })()}
      </div>

      {/* Card list */}
      <div className="custom-scrollbar min-h-kanban-task-list flex-1 flex flex-col gap-1.5 overflow-y-auto px-2 py-2">
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
          <div className="flex items-center justify-center py-6 text-fs-meta text-ink-4">
            No tasks yet
          </div>
        )}
      </div>
    </div>
  );
}
