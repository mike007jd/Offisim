import { Activity, Cpu, Database, Zap } from 'lucide-react';
import { useDashboardMetrics } from '../../hooks/useDashboardMetrics';
import { usePipelineStage, STAGE_META } from '../../hooks/usePipelineStage';
import { useAicsRuntime } from '../../runtime/aics-runtime-context';

// ---------------------------------------------------------------------------

interface StatusBarProps {
  modelName?: string;
}

export function StatusBar({ modelName }: StatusBarProps) {
  const { isRunning, error } = useAicsRuntime();
  const metrics = useDashboardMetrics();
  const pipelineStage = usePipelineStage();
  const runStatus = isRunning ? 'running' : error ? 'error' : 'idle';

  return (
    <footer className="h-9 bg-black/60 backdrop-blur-xl text-slate-500 text-[9px] px-6 flex items-center justify-between relative overflow-hidden border-t border-white/5">
      <div className="absolute inset-0 opacity-[0.02] pointer-events-none bg-[linear-gradient(rgba(18,16,16,0)_50%,rgba(0,0,0,0.25)_50%),linear-gradient(90deg,rgba(255,0,0,0.06),rgba(0,255,0,0.02),rgba(0,0,255,0.06))] bg-[length:100%_2px,3px_100%]" />

      <div className="flex items-center space-x-5 relative z-10">
        <div className="flex items-center space-x-2">
          {pipelineStage ? (
            <>
              <div className={`w-2 h-2 rounded-full animate-pulse ${STAGE_META[pipelineStage].dotClass}`} />
              <span className={`uppercase tracking-[0.2em] font-black ${STAGE_META[pipelineStage].colorClass}`}>
                {STAGE_META[pipelineStage].label}
              </span>
            </>
          ) : (
            <>
              <div className={`w-2 h-2 rounded-full ${runStatus === 'running' ? 'bg-emerald-500 animate-pulse' : runStatus === 'error' ? 'bg-red-500' : 'bg-slate-600'}`} />
              <span className={`uppercase tracking-[0.2em] font-black ${runStatus === 'running' ? 'text-emerald-500/90' : runStatus === 'error' ? 'text-red-500/90' : 'text-slate-600'}`}>
                {runStatus === 'running' ? 'System Online' : runStatus === 'error' ? 'Error' : 'Standby'}
              </span>
            </>
          )}
        </div>

        <div className="w-px h-3 bg-white/10" />

        <div className="flex items-center space-x-4">
          {modelName && (
            <div className="flex items-center space-x-1.5">
              <Cpu className="w-3 h-3 text-blue-400/50" />
              <span className="font-mono">{modelName}</span>
            </div>
          )}
          {metrics.activeTaskCount > 0 && (
            <div className="flex items-center space-x-1.5">
              <Zap className="w-3 h-3 text-amber-400/50" />
              <span className="font-mono">{metrics.activeTaskCount} tasks</span>
            </div>
          )}
          <div className="flex items-center space-x-1.5">
            <Database className="w-3 h-3 text-purple-400/50" />
            <span className="font-mono">
              {metrics.employeeUtilization.active}/{metrics.employeeUtilization.total} agents
            </span>
          </div>
        </div>
      </div>

      <div className="flex items-center space-x-5 relative z-10">
        {metrics.totalInputTokens + metrics.totalOutputTokens > 0 && (
          <span className="font-mono">TKN: {(metrics.totalInputTokens + metrics.totalOutputTokens).toLocaleString()}</span>
        )}
        {metrics.estimatedCostUsd > 0 && (
          <span className="font-mono text-emerald-500/50">${metrics.estimatedCostUsd.toFixed(4)}</span>
        )}
        {metrics.elapsedMs != null && (
          <span className="font-mono">LAT: {(metrics.elapsedMs / 1000).toFixed(1)}s</span>
        )}
        <div className="w-px h-3 bg-white/10" />
        <div className="flex items-center space-x-2 opacity-40 hover:opacity-100 transition-opacity">
          <Activity className="w-3 h-3" />
          <span className="font-mono">v1.0.4</span>
        </div>
      </div>
    </footer>
  );
}
