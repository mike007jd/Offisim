import { Button } from '@offisim/ui-core';
import { Activity, Cpu, Database, Zap } from 'lucide-react';
import { useDashboardMetrics } from '../../hooks/useDashboardMetrics';
import { STAGE_META, usePipelineStage } from '../../hooks/usePipelineStage';
import { useOffisimRuntime, useOffisimRuntimeStatus } from '../../runtime/offisim-runtime-context';
import { useRuntimeActivityFeed } from '../../runtime/use-runtime-activity-feed';
import { EnergyMeter } from './EnergyMeter.js';

function pendingInteractionLabel(
  pendingInteraction: NonNullable<ReturnType<typeof useOffisimRuntime>['pendingInteraction']>,
): string {
  switch (pendingInteraction.kind) {
    case 'permission_request':
      return pendingInteraction.severity === 'high' ? 'Approval required' : 'Awaiting approval';
    case 'plan_review':
      return 'Awaiting plan review';
    case 'agent_question':
      return 'Awaiting clarification';
    default:
      return pendingInteraction.severity === 'high' ? 'Decision required' : 'Awaiting input';
  }
}

// ---------------------------------------------------------------------------

import type { ProjectStatus } from '@offisim/shared-types';

const PROJECT_STATUS_STYLE: Record<ProjectStatus, { label: string; color: string }> = {
  planning: { label: 'Planning', color: 'text-blue-400' },
  active: { label: 'Active', color: 'text-emerald-400' },
  paused: { label: 'Paused', color: 'text-amber-400' },
  completed: { label: 'Done', color: 'text-slate-500' },
  archived: { label: 'Archived', color: 'text-slate-500' },
};

interface StatusBarProps {
  modelName?: string;
  activeProjectStatus?: ProjectStatus | null;
}

export function StatusBar({ modelName, activeProjectStatus }: StatusBarProps) {
  const { error, interactionMode, setInteractionMode, pendingInteraction } = useOffisimRuntime();
  const { isRunning } = useOffisimRuntimeStatus();
  const metrics = useDashboardMetrics();
  const { stage: pipelineStage } = usePipelineStage();
  const { headline, activeTools } = useRuntimeActivityFeed({ maxEntries: 0 });
  const runStatus = isRunning ? 'running' : error ? 'error' : 'idle';

  return (
    <footer
      className="bg-black/60 backdrop-blur-xl text-slate-500 text-[10px] flex items-center justify-between relative overflow-hidden border-t border-white/5"
      style={{ minHeight: '40px', paddingInline: 'var(--sp-lg)' }}
    >
      <div className="absolute inset-0 opacity-[0.02] pointer-events-none bg-[linear-gradient(rgba(18,16,16,0)_50%,rgba(0,0,0,0.25)_50%),linear-gradient(90deg,rgba(255,0,0,0.06),rgba(0,255,0,0.02),rgba(0,0,255,0.06))] bg-[length:100%_2px,3px_100%]" />

      <div className="flex items-center space-x-5 relative z-10">
        <div className="flex items-center space-x-2">
          {pipelineStage ? (
            <>
              <div
                className={`w-2 h-2 rounded-full animate-pulse ${STAGE_META[pipelineStage].dotClass}`}
                title={`Pipeline stage: ${STAGE_META[pipelineStage].label}`}
              />
              <span
                className={`uppercase tracking-[0.2em] font-black ${STAGE_META[pipelineStage].colorClass}`}
                title={`Pipeline stage: ${STAGE_META[pipelineStage].label}`}
              >
                {STAGE_META[pipelineStage].label}
              </span>
            </>
          ) : (
            <>
              <div
                className={`w-2 h-2 rounded-full ${runStatus === 'running' ? 'bg-emerald-500 animate-pulse' : runStatus === 'error' ? 'bg-red-500' : 'bg-slate-600'}`}
                title={`Runtime status: ${runStatus}`}
              />
              <span
                className={`uppercase tracking-[0.2em] font-black ${runStatus === 'running' ? 'text-emerald-500/90' : runStatus === 'error' ? 'text-red-500/90' : 'text-slate-500'}`}
                title={`Runtime status: ${runStatus}`}
              >
                {runStatus === 'running'
                  ? 'System Online'
                  : runStatus === 'error'
                    ? 'Error'
                    : 'Standby'}
              </span>
            </>
          )}
        </div>

        {activeProjectStatus && (
          <>
            <div className="w-px h-3 bg-white/10" />
            <span
              className={`uppercase tracking-[0.15em] font-semibold ${PROJECT_STATUS_STYLE[activeProjectStatus].color}`}
              title={`Project status: ${PROJECT_STATUS_STYLE[activeProjectStatus].label}`}
            >
              {PROJECT_STATUS_STYLE[activeProjectStatus].label}
            </span>
          </>
        )}

        <div className="w-px h-3 bg-white/10" />

        <div className="flex items-center space-x-4">
          {headline && (
            <div className="flex items-center space-x-1.5 max-w-[18rem]" title={headline}>
              <Activity className="w-3 h-3 text-cyan-400/60" />
              <span className="truncate font-mono text-cyan-200/70">{headline}</span>
            </div>
          )}
          {activeTools.length > 0 && (
            <div
              className="flex items-center space-x-1.5"
              title={`${activeTools.length} tool calls currently running`}
            >
              <span className="font-mono text-emerald-300/70">{activeTools.length} tools live</span>
            </div>
          )}
          {modelName && (
            <div className="flex items-center space-x-1.5" title={`Model: ${modelName}`}>
              <Cpu className="w-3 h-3 text-blue-400/50" />
              <span className="font-mono">{modelName}</span>
            </div>
          )}
          {metrics.activeTaskCount > 0 && (
            <div
              className="flex items-center space-x-1.5"
              title={`${metrics.activeTaskCount} active tasks`}
            >
              <Zap className="w-3 h-3 text-amber-400/50" />
              <span className="font-mono">{metrics.activeTaskCount} tasks</span>
            </div>
          )}
          <div
            className="flex items-center space-x-1.5"
            title={`${metrics.employeeUtilization.active} active of ${metrics.employeeUtilization.total} employees`}
          >
            <Database className="w-3 h-3 text-purple-400/50" />
            <span className="font-mono">
              {metrics.employeeUtilization.active}/{metrics.employeeUtilization.total} agents
            </span>
          </div>
        </div>
      </div>

      <div className="flex items-center space-x-5 relative z-10">
        <EnergyMeter
          usedTokens={metrics.totalInputTokens + metrics.totalOutputTokens}
          costUsd={metrics.estimatedCostUsd}
        />
        {metrics.elapsedMs != null && (
          <span
            className="font-mono"
            title={`Latency ${(metrics.elapsedMs / 1000).toFixed(1)} seconds`}
          >
            LAT: {(metrics.elapsedMs / 1000).toFixed(1)}s
          </span>
        )}
        <div className="w-px h-3 bg-white/10" />
        {setInteractionMode && (
          <div className="flex items-center gap-1">
            <Button
              type="button"
              size="sm"
              variant={interactionMode === 'boss_proxy' ? 'secondary' : 'ghost'}
              className="h-6 px-2 text-[10px]"
              onClick={() => setInteractionMode('boss_proxy')}
              title="Route instructions through the boss proxy"
            >
              Proxy
            </Button>
            <Button
              type="button"
              size="sm"
              variant={interactionMode === 'human_in_loop' ? 'secondary' : 'ghost'}
              className="h-6 px-2 text-[10px]"
              onClick={() => setInteractionMode('human_in_loop')}
              title="Keep approvals and steering in the loop"
            >
              Human
            </Button>
          </div>
        )}
        {pendingInteraction && (
          <span
            className="font-mono text-amber-200/80"
            title={pendingInteractionLabel(pendingInteraction)}
          >
            {pendingInteractionLabel(pendingInteraction)}
          </span>
        )}
        <div className="w-px h-3 bg-white/10" />
        <div
          className="flex items-center space-x-2 opacity-40 hover:opacity-100 transition-opacity"
          title="Offisim runtime build v1.0.0-rc.1"
        >
          <Activity className="w-3 h-3" />
          <span className="font-mono">v1.0.0-rc.1</span>
        </div>
      </div>
    </footer>
  );
}
