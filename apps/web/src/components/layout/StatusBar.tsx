import { useDashboardMetrics } from '../../hooks/useDashboardMetrics';
import { useAicsRuntime } from '../../runtime/aics-runtime-context';
import { Badge } from '../ui/badge';

interface StatusBarProps {
  modelName?: string;
}

export function StatusBar({ modelName }: StatusBarProps) {
  const { isRunning, error } = useAicsRuntime();
  const metrics = useDashboardMetrics();

  const runStatus = isRunning ? 'running' : error ? 'error' : 'idle';
  const statusVariant =
    runStatus === 'error' ? 'error' : runStatus === 'running' ? 'info' : 'secondary';

  return (
    <footer className="flex h-8 items-center justify-between border-t-2 border-ocean-light bg-ocean-deep px-4 font-pixel-mono text-[10px] text-shell">
      <div className="flex items-center gap-2">
        <Badge variant={statusVariant} className="text-[10px] px-1.5 py-0">
          {runStatus}
        </Badge>
        {modelName && <span className="text-[10px] text-shell">MODEL: {modelName}</span>}
      </div>
      <div className="flex items-center gap-3 text-[10px] text-shell">
        {metrics.activeTaskCount > 0 && <span>⚡ {metrics.activeTaskCount} tasks</span>}
        <span>👥 {metrics.employeeUtilization.active}/{metrics.employeeUtilization.total}</span>
        {(metrics.totalInputTokens + metrics.totalOutputTokens) > 0 && (
          <span>TKN: {(metrics.totalInputTokens + metrics.totalOutputTokens).toLocaleString()}</span>
        )}
        {metrics.estimatedCostUsd > 0 && <span>~${metrics.estimatedCostUsd.toFixed(4)}</span>}
        {metrics.elapsedMs != null && <span>{(metrics.elapsedMs / 1000).toFixed(1)}s</span>}
      </div>
    </footer>
  );
}
