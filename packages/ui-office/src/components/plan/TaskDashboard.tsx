import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useDashboardMetrics } from '../../hooks/useDashboardMetrics';
import { STAGE_META, usePipelineStage } from '../../hooks/usePipelineStage';
import { useTaskDashboard } from '../../hooks/useTaskDashboard';
import { useOffisimRuntime, useOffisimRuntimeStatus } from '../../runtime/offisim-runtime-context';
import { StepProgressBar } from '../dashboard/StepProgressBar';
import type { StepProgressSegment } from '../dashboard/StepProgressBar';
import { TaskStepCard } from './TaskStepCard';

export function TaskDashboard({ agents }: { agents?: Map<string, { name: string }> }) {
  const dashboard = useTaskDashboard(agents);
  const { getTaskCost } = useDashboardMetrics();
  const { eventBus } = useOffisimRuntime();
  const { isRunning } = useOffisimRuntimeStatus();
  const { stage, routeLabel } = usePipelineStage();
  const [expandedTaskId, setExpandedTaskId] = useState<string | null>(null);
  const [stepFilter, setStepFilter] = useState<number | null>(null);
  /** Ref to the scroll container for programmatic scrolling on scene.employee.selected */
  const scrollContainerRef = useRef<HTMLDivElement>(null);

  // Stable refs so the event-bus subscription doesn't resubscribe on every steps/toggle change
  const stepsRef = useRef(dashboard.steps);
  stepsRef.current = dashboard.steps;
  const toggleStepRef = useRef(dashboard.toggleStep);
  toggleStepRef.current = dashboard.toggleStep;

  // ── ANIM-015: task row click → emit ui.task.focused → scene flash ──
  const handleTaskClick = useCallback(
    (taskRunId: string) => {
      setExpandedTaskId((prev) => (prev === taskRunId ? null : taskRunId));

      // Find the task across all steps to get its employeeId
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

  // ── ANIM-015: scene.employee.selected → scroll to that employee's active task ──
  useEffect(() => {
    return eventBus.on('scene.employee.selected', (event) => {
      const { employeeId } = event.payload as { employeeId: string };
      if (!employeeId || !scrollContainerRef.current) return;

      const steps = stepsRef.current;
      const toggleStep = toggleStepRef.current;

      // Find a task with this employeeId
      for (const step of steps) {
        const task = step.tasks.find((t) => t.employeeId === employeeId);
        if (task) {
          // Expand step if not already expanded
          if (!step.expanded) {
            toggleStep(step.stepIndex);
          }
          // Scroll to the task row (uses data-task-run-id attribute)
          // Give React a tick to expand before scrolling
          setTimeout(() => {
            const el = scrollContainerRef.current?.querySelector(
              `[data-task-run-id="${task.taskRunId}"]`,
            );
            el?.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
            setExpandedTaskId(task.taskRunId);
          }, 50);
          break;
        }
      }
    });
  }, [eventBus]);

  const handleSegmentClick = useCallback(
    (stepIndex: number | null) => {
      setStepFilter(stepIndex);
      // When filtering to a step, auto-expand it
      if (stepIndex !== null) {
        const step = dashboard.steps.find((s) => s.stepIndex === stepIndex);
        if (step && !step.expanded) {
          dashboard.toggleStep(stepIndex);
        }
      }
    },
    [dashboard],
  );

  // Build step segments for StepProgressBar — memoized before early return (hooks must not be conditional)
  const segments = useMemo(
    (): StepProgressSegment[] =>
      dashboard.steps.map((step) => {
        let status: StepProgressSegment['status'];
        if (step.status === 'completed') {
          status = 'completed';
        } else if (step.status === 'active') {
          status = 'active';
        } else {
          const hasFailed = step.tasks.some(
            (t) => t.status === 'failed' || t.status === 'cancelled',
          );
          status = hasFailed ? 'failed' : 'pending';
        }
        return {
          index: step.stepIndex,
          description: step.description,
          status,
          taskCount: step.tasks.length,
        };
      }),
    [dashboard.steps],
  );

  // Filter steps if a segment is selected — memoized before early return
  const visibleSteps = useMemo(
    () =>
      stepFilter !== null
        ? dashboard.steps.filter((s) => s.stepIndex === stepFilter)
        : dashboard.steps,
    [dashboard.steps, stepFilter],
  );

  if (!dashboard.planId) {
    if (isRunning) {
      const stageLabel = stage ? STAGE_META[stage].chatLabel : 'Runtime active';
      return (
        <div className="p-3">
          <div className="rounded-2xl border border-cyan-400/20 bg-cyan-400/[0.06] px-4 py-5 text-center">
            <p className="text-sm font-semibold text-cyan-100">{stageLabel}</p>
            <p className="mt-2 text-xs leading-relaxed text-slate-400">
              {routeLabel ??
                'The boss is routing the request and the manager is building the first executable plan.'}
            </p>
          </div>
        </div>
      );
    }
    return null;
  }

  const pct =
    dashboard.stats.total > 0 ? (dashboard.stats.completed / dashboard.stats.total) * 100 : 0;

  return (
    <div ref={scrollContainerRef} className="flex flex-col gap-2 p-3">
      {/* Header */}
      <div className="flex items-center justify-between">
        <h3 className="text-xs font-semibold text-pearl">Plan Progress</h3>
        <div className="flex gap-2">
          <span className="text-[10px] text-koi">{dashboard.stats.active} active</span>
          <span className="text-[10px] text-shell">
            {dashboard.stats.completed}/{dashboard.stats.total}
          </span>
        </div>
      </div>

      {/* Numeric progress bar */}
      <div className="h-1.5 w-full rounded-full bg-ocean-mid/30">
        <div className="h-full rounded-full bg-koi transition-all" style={{ width: `${pct}%` }} />
      </div>

      {/* Step progress bar (segmented) */}
      {segments.length > 0 && (
        <StepProgressBar
          steps={segments}
          activeFilter={stepFilter}
          onSegmentClick={handleSegmentClick}
        />
      )}

      {/* Filter badge */}
      {stepFilter !== null && (
        <div className="flex items-center gap-1">
          <span className="text-[10px] text-shell">Filtered: Step {stepFilter + 1}</span>
          <button
            type="button"
            className="text-[10px] text-koi hover:underline"
            onClick={() => setStepFilter(null)}
          >
            clear
          </button>
        </div>
      )}

      {/* Steps */}
      {visibleSteps.map((step) => (
        <TaskStepCard
          key={step.stepIndex}
          step={step}
          onToggle={dashboard.toggleStep}
          expandedTaskId={expandedTaskId}
          onTaskClick={handleTaskClick}
          getTaskCost={getTaskCost}
        />
      ))}
    </div>
  );
}
