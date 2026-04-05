import { cn } from '@offisim/ui-core';
import { useCallback, useRef } from 'react';
import { useDashboardMetrics } from '../../hooks/useDashboardMetrics';
import { useDeliverables } from '../../hooks/useDeliverables';
import { useTaskDashboard } from '../../hooks/useTaskDashboard';
import { useOffisimRuntime } from '../../runtime/offisim-runtime-context';
import { KanbanColumn } from './KanbanColumn';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface KanbanBoardProps {
  /** Agent map for name resolution */
  agents?: Map<string, { name: string }>;
  /** Summary text override (e.g. user's original request) */
  requestText?: string;
}

// ---------------------------------------------------------------------------
// Component
// ---------------------------------------------------------------------------

export function KanbanBoard({ agents, requestText }: KanbanBoardProps) {
  const dashboard = useTaskDashboard(agents);
  const { getTaskCost } = useDashboardMetrics();
  const deliverables = useDeliverables();
  const { eventBus } = useOffisimRuntime();
  const scrollRef = useRef<HTMLDivElement>(null);

  // ── Card click → emit ui.task.focused (same pattern as TaskDashboard) ──
  const handleTaskClick = useCallback(
    (taskRunId: string) => {
      for (const step of dashboard.steps) {
        const task = step.tasks.find((t) => t.taskRunId === taskRunId);
        if (task?.employeeId) {
          eventBus.emit({
            type: 'ui.task.focused',
            entityId: task.employeeId,
            entityType: 'employee',
            companyId: '',
            timestamp: Date.now(),
            payload: { employeeId: task.employeeId, taskRunId },
          });
          break;
        }
      }
    },
    [dashboard.steps, eventBus],
  );

  // ── Scroll navigation ──
  const scrollBy = useCallback((delta: number) => {
    scrollRef.current?.scrollBy({ left: delta, behavior: 'smooth' });
  }, []);

  if (!dashboard.planId) {
    return (
      <div className="flex flex-col items-center justify-center h-full gap-3 text-center px-6">
        <svg
          className="h-10 w-10 text-slate-500"
          fill="none"
          viewBox="0 0 24 24"
          stroke="currentColor"
          strokeWidth={1.5}
        >
          <title>No active plan</title>
          <path
            strokeLinecap="round"
            strokeLinejoin="round"
            d="M9 12h3.75M9 15h3.75M9 18h3.75m3 .75H18a2.25 2.25 0 0 0 2.25-2.25V6.108c0-1.135-.845-2.098-1.976-2.192a48.424 48.424 0 0 0-1.123-.08m-5.801 0c-.065.21-.1.433-.1.664 0 .414.336.75.75.75h4.5a.75.75 0 0 0 .75-.75 2.25 2.25 0 0 0-.1-.664m-5.8 0A2.251 2.251 0 0 1 13.5 2.25H15a2.25 2.25 0 0 1 2.15 1.586m-5.8 0c-.376.023-.75.05-1.124.08C9.095 4.01 8.25 4.973 8.25 6.108V8.25m0 0H4.875c-.621 0-1.125.504-1.125 1.125v11.25c0 .621.504 1.125 1.125 1.125h9.75c.621 0 1.125-.504 1.125-1.125V9.375c0-.621-.504-1.125-1.125-1.125H8.25z"
          />
        </svg>
        <p className="text-sm text-slate-500">No active plan</p>
        <p className="text-xs text-slate-500">
          Send your team a task in the chat to create a project board.
        </p>
      </div>
    );
  }

  const pct =
    dashboard.stats.total > 0
      ? Math.round((dashboard.stats.completed / dashboard.stats.total) * 100)
      : 0;

  return (
    <div className="flex flex-col h-full overflow-hidden">
      {/* ── Top bar: plan progress summary ── */}
      <div className="flex items-center gap-3 px-4 py-2.5 border-b border-white/[0.06] shrink-0">
        <h3 className="text-xs font-black uppercase tracking-wider text-slate-400">Board</h3>

        {/* Progress bar */}
        <div className="flex-1 max-w-[200px] h-1.5 rounded-full bg-white/[0.06] overflow-hidden">
          <div
            className={cn(
              'h-full rounded-full transition-all duration-500',
              dashboard.isComplete ? 'bg-green-400' : 'bg-blue-400',
            )}
            style={{ width: `${pct}%` }}
          />
        </div>

        <span className="text-[10px] font-mono text-slate-500 tabular-nums">
          {dashboard.stats.completed}/{dashboard.stats.total} tasks
        </span>

        {dashboard.stats.active > 0 && (
          <span className="flex items-center gap-1 text-[10px] text-blue-400">
            <span className="h-1.5 w-1.5 rounded-full bg-blue-400 animate-pulse" />
            {dashboard.stats.active} active
          </span>
        )}

        {dashboard.stats.failed > 0 && (
          <span className="text-[10px] text-red-400">{dashboard.stats.failed} failed</span>
        )}

        {/* Scroll arrows */}
        <div className="ml-auto flex gap-1">
          <button
            type="button"
            aria-label="Scroll left"
            className="p-1 rounded hover:bg-white/[0.06] text-slate-500 hover:text-slate-300 transition-colors focus-visible:ring-2 focus-visible:ring-blue-500/50 focus-visible:outline-none"
            onClick={() => scrollBy(-280)}
            title="Scroll left"
          >
            <svg
              className="w-3.5 h-3.5"
              fill="none"
              viewBox="0 0 24 24"
              stroke="currentColor"
              strokeWidth={2}
            >
              <title>Scroll left</title>
              <path strokeLinecap="round" strokeLinejoin="round" d="M15 19l-7-7 7-7" />
            </svg>
          </button>
          <button
            type="button"
            aria-label="Scroll right"
            className="p-1 rounded hover:bg-white/[0.06] text-slate-500 hover:text-slate-300 transition-colors focus-visible:ring-2 focus-visible:ring-blue-500/50 focus-visible:outline-none"
            onClick={() => scrollBy(280)}
            title="Scroll right"
          >
            <svg
              className="w-3.5 h-3.5"
              fill="none"
              viewBox="0 0 24 24"
              stroke="currentColor"
              strokeWidth={2}
            >
              <title>Scroll right</title>
              <path strokeLinecap="round" strokeLinejoin="round" d="M9 5l7 7-7 7" />
            </svg>
          </button>
        </div>
      </div>

      {/* ── Horizontal scrolling board ── */}
      <div ref={scrollRef} className="flex-1 overflow-x-auto overflow-y-hidden custom-scrollbar">
        <div className="flex gap-3 p-3 h-full min-w-max">
          {/* ═══ Requirements column ═══ */}
          <KanbanColumn title="Requirements" stepIndex={null} status="requirements" tasks={[]}>
            {/* User's original request */}
            {requestText && (
              <div className="rounded-lg border border-amber-500/20 bg-amber-500/[0.04] px-2.5 py-2 space-y-1">
                <span className="text-[10px] font-semibold uppercase tracking-wide text-amber-400/70">
                  User Request
                </span>
                <p className="text-[11px] text-slate-200 leading-relaxed whitespace-pre-wrap">
                  {requestText}
                </p>
              </div>
            )}
            {/* Plan summary from PM */}
            <div className="rounded-lg border border-white/[0.06] bg-[var(--surface)] px-2.5 py-2 space-y-1">
              <span className="text-[10px] font-semibold uppercase tracking-wide text-slate-500">
                {requestText ? 'Plan Summary' : 'Request'}
              </span>
              <p className="text-[11px] text-slate-300 leading-relaxed">
                {dashboard.summary ||
                  (requestText ? 'Waiting for PM to create a plan...' : 'User request')}
              </p>
            </div>
          </KanbanColumn>

          {/* ═══ Step columns ═══ */}
          {dashboard.steps.map((step) => (
            <KanbanColumn
              key={step.stepIndex}
              title={step.description}
              stepIndex={step.stepIndex}
              status={step.status}
              tasks={step.tasks}
              onTaskClick={handleTaskClick}
              getTaskCost={getTaskCost}
            />
          ))}

          {/* ═══ Deliverables column ═══ */}
          <KanbanColumn title="Deliverables" stepIndex={null} status="deliverables" tasks={[]}>
            {deliverables.length === 0 ? (
              <div className="flex items-center justify-center py-6 text-[10px] text-slate-500">
                Outputs will appear here
              </div>
            ) : (
              deliverables.map((d) => (
                <div
                  key={d.id}
                  className="rounded-lg border border-white/[0.06] bg-[var(--surface)] px-2.5 py-2 space-y-1"
                >
                  <span className="text-[11px] font-semibold text-slate-200 line-clamp-1">
                    {d.title}
                  </span>
                  <p className="text-[10px] text-slate-400 line-clamp-3 leading-relaxed">
                    {d.content}
                  </p>
                  {d.contributingEmployees.length > 0 && (
                    <div className="flex flex-wrap gap-1 pt-0.5">
                      {d.contributingEmployees.map((emp) => (
                        <span
                          key={emp.employeeId}
                          className="text-[10px] px-1.5 py-0.5 rounded bg-purple-500/20 text-purple-300"
                        >
                          {emp.employeeName}
                        </span>
                      ))}
                    </div>
                  )}
                </div>
              ))
            )}
          </KanbanColumn>
        </div>
      </div>
    </div>
  );
}
