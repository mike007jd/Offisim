import { Button } from '@offisim/ui-core';
import {
  ActivityRail,
  useDashboardMetrics,
  useOffisimRuntimeStatus,
  usePlanStepStore,
} from '@offisim/ui-office/web';
import { X } from 'lucide-react';
import {
  StageRunHeader,
  StageRunPanel,
  StageRunScrollArea,
  StageRunSection,
  StageRunStatusDot,
  StageRunStepItem,
} from './StageRunSurfaces';

interface LiveRunOverlayProps {
  onClose: () => void;
}

type StageDotState = 'active' | 'completed' | 'failed' | 'pending';

function stageDotState(status: string): StageDotState {
  if (status === 'active' || status === 'completed' || status === 'failed') return status;
  return 'pending';
}

function formatCost(costUsd: number): string {
  if (costUsd <= 0) return '$0.00';
  return costUsd < 0.01 ? '$0.01<' : `$${costUsd.toFixed(2)}`;
}

/**
 * Run-broadcast overlay opened from the stage run-axis Live entry. Surfaces the
 * current run's Plan (steps + per-step assignee) and live Activity. Latency
 * relocates here from the deleted StatusBar — it lives in this header, NOT in the
 * persistent `.scene-cost` readout. This is the Live entry shell + active state;
 * the run-record sediment data contract is owned by the Phase 1 chat-rail rebuild.
 */
export function LiveRunOverlay({ onClose }: LiveRunOverlayProps) {
  const { steps, currentStepIndex, stats } = usePlanStepStore();
  const { isRunning } = useOffisimRuntimeStatus();
  const metrics = useDashboardMetrics();
  const latencyLabel =
    metrics.elapsedMs != null ? `${(metrics.elapsedMs / 1000).toFixed(1)}s latency` : null;

  return (
    <StageRunPanel>
      <StageRunHeader>
        <div className="flex min-w-0 items-center gap-2">
          <StageRunStatusDot state={isRunning ? 'running' : 'idle'} />
          <span className="text-fs-micro font-bold uppercase tracking-ls-caps text-ink-3">
            Live run
          </span>
          <span className="font-mono text-fs-micro tabular-nums text-ink-3">
            {latencyLabel ? `${latencyLabel} · ` : ''}
            {formatCost(metrics.estimatedCostUsd)}
          </span>
        </div>
        <Button
          type="button"
          variant="ghost"
          size="icon"
          aria-label="Close live run overlay"
          onClick={onClose}
          className="size-6 rounded-r-sm text-ink-4 transition-colors hover:bg-surface-sunken hover:text-ink-2"
        >
          <X className="size-3.5" />
        </Button>
      </StageRunHeader>

      <StageRunScrollArea>
        <StageRunSection>
          <div className="mb-2 flex items-center gap-2 text-fs-micro font-bold uppercase tracking-ls-caps text-ink-3">
            <span>Plan</span>
            {stats.total > 0 ? (
              <span className="rounded-r-pill bg-surface-sunken px-1.5 py-0.5 font-mono text-fs-meta font-semibold tracking-normal text-ink-3">
                {stats.completed}/{stats.total}
              </span>
            ) : null}
          </div>
          {steps.length === 0 ? (
            <p className="text-fs-meta text-ink-4">No plan yet — the run is still warming up.</p>
          ) : (
            <ol className="flex flex-col gap-1.5">
              {steps.map((step) => {
                const assignee =
                  step.tasks.find((t) => t.status === 'active')?.assigneeName ??
                  step.tasks[0]?.assigneeName ??
                  step.tasks[0]?.employeeName ??
                  null;
                const isCurrent = step.stepIndex === currentStepIndex;
                return (
                  <StageRunStepItem key={step.stepIndex} state={isCurrent ? 'current' : 'idle'}>
                    <StageRunStatusDot state={stageDotState(step.status)} className="mt-1" />
                    <div className="min-w-0 flex-1">
                      <p className="truncate text-fs-meta font-medium text-ink-1">
                        #{step.stepIndex + 1} {step.description}
                      </p>
                      {assignee ? (
                        <p className="mt-0.5 truncate text-fs-micro text-ink-3">{assignee}</p>
                      ) : null}
                    </div>
                  </StageRunStepItem>
                );
              })}
            </ol>
          )}
        </StageRunSection>

        <StageRunSection boundary="last">
          <div className="mb-2 text-fs-micro font-bold uppercase tracking-ls-caps text-ink-3">
            Activity
          </div>
          <ActivityRail variant="full" />
        </StageRunSection>
      </StageRunScrollArea>
    </StageRunPanel>
  );
}
