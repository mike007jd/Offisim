import { useTaskDashboard } from '../../hooks/useTaskDashboard';
import { TaskStepCard } from './TaskStepCard';

export function TaskDashboard({ agents }: { agents?: Map<string, { name: string }> }) {
  const dashboard = useTaskDashboard(agents);

  if (!dashboard.planId) {
    return (
      <div className="flex items-center justify-center p-6 text-sm text-shell">No active plan</div>
    );
  }

  const pct =
    dashboard.stats.total > 0 ? (dashboard.stats.completed / dashboard.stats.total) * 100 : 0;

  return (
    <div className="flex flex-col gap-2 p-3">
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

      {/* Progress bar */}
      <div className="h-1.5 w-full rounded-full bg-ocean-mid/30">
        <div className="h-full rounded-full bg-koi transition-all" style={{ width: `${pct}%` }} />
      </div>

      {/* Steps */}
      {dashboard.steps.map((step) => (
        <TaskStepCard key={step.stepIndex} step={step} onToggle={dashboard.toggleStep} />
      ))}
    </div>
  );
}
