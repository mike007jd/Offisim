import { cn } from '@offisim/ui-core';
import type { TaskInfo } from '../../hooks/useTaskDashboard';
import { KanbanCard } from './KanbanCard';

// ---------------------------------------------------------------------------
// Column status → header accent
// ---------------------------------------------------------------------------

function columnAccent(
  status: 'pending' | 'active' | 'completed' | 'requirements' | 'deliverables',
): string {
  switch (status) {
    case 'completed':
      return 'border-t-green-400/60';
    case 'active':
      return 'border-t-blue-400/60';
    case 'requirements':
      return 'border-t-amber-400/60';
    case 'deliverables':
      return 'border-t-purple-400/60';
    default:
      return 'border-t-slate-500/40';
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
  /** Column title (step description or "Requirements" / "Deliverables") */
  title: string;
  /** Step index for display. null for special columns */
  stepIndex: number | null;
  /** Column status for accent color */
  status: 'pending' | 'active' | 'completed' | 'requirements' | 'deliverables';
  /** Tasks to render as cards */
  tasks: TaskInfo[];
  /** Called when a card is clicked */
  onTaskClick?: (taskRunId: string) => void;
  /** Cost lookup function */
  getTaskCost?: (taskRunId: string) => number;
  /** Freeform content for special columns (Requirements/Deliverables) */
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
        'flex flex-col shrink-0 w-[260px] rounded-lg',
        'border border-white/[0.06] border-t-2 bg-[var(--surface-light)]',
        columnAccent(status),
      )}
    >
      {/* Header */}
      <div className="flex items-center gap-2 px-3 py-2 border-b border-white/[0.06]">
        {stepIndex !== null && (
          <span className="text-[10px] font-mono text-slate-500 shrink-0">#{stepIndex + 1}</span>
        )}
        <span className="text-[11px] font-semibold text-slate-300 truncate flex-1">{title}</span>
        {progress && (
          <span className="text-[10px] font-mono text-slate-500 shrink-0 tabular-nums">
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
              <span className="flex items-center gap-1 text-[9px] text-blue-400">
                <span className="h-1.5 w-1.5 rounded-full bg-blue-400 animate-pulse" />
                {active}
              </span>
            );
          })()}
      </div>

      {/* Card list */}
      <div className="flex-1 overflow-y-auto custom-scrollbar px-2 py-2 space-y-1.5 min-h-[80px] max-h-[calc(100vh-240px)]">
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
          <div className="flex items-center justify-center py-6 text-[10px] text-slate-600">
            No tasks yet
          </div>
        )}
      </div>
    </div>
  );
}
