import {
  ActivityRail,
  useDashboardMetrics,
  useOffisimRuntimeStatus,
  usePlanStepStore,
} from '@offisim/ui-office/web';
import { Button } from '@offisim/ui-core';
import { X } from 'lucide-react';

interface LiveRunOverlayProps {
  onClose: () => void;
}

const STEP_DOT: Record<string, string> = {
  active: 'bg-accent',
  completed: 'bg-ok',
  failed: 'bg-danger',
  pending: 'bg-line-strong',
};

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
    <div className="pointer-events-auto absolute left-1/2 top-10 z-dropdown w-full max-w-md -translate-x-1/2 overflow-hidden rounded-r-lg border border-line-strong bg-surface-1 shadow-elev-3">
      <header className="flex items-center justify-between gap-2 border-b border-line-soft px-3.5 py-2.5">
        <div className="flex min-w-0 items-center gap-2">
          <span
            aria-hidden="true"
            className={`size-2 shrink-0 rounded-full ${isRunning ? 'animate-pulse bg-accent' : 'bg-ink-4'}`}
          />
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
      </header>

      <div className="max-h-dvh overflow-y-auto">
        <section className="border-b border-line-soft px-3.5 py-3">
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
                  <li
                    key={step.stepIndex}
                    className={`flex items-start gap-2 rounded-r-sm border px-2.5 py-1.5 ${
                      isCurrent
                        ? 'border-accent-ring bg-accent-surface'
                        : 'border-line-soft bg-surface-2'
                    }`}
                  >
                    <span
                      aria-hidden="true"
                      className={`mt-1 size-2 shrink-0 rounded-full ${STEP_DOT[step.status] ?? 'bg-line-strong'}`}
                    />
                    <div className="min-w-0 flex-1">
                      <p className="truncate text-fs-meta font-medium text-ink-1">
                        #{step.stepIndex + 1} {step.description}
                      </p>
                      {assignee ? (
                        <p className="mt-0.5 truncate text-fs-micro text-ink-3">{assignee}</p>
                      ) : null}
                    </div>
                  </li>
                );
              })}
            </ol>
          )}
        </section>

        <section className="px-3.5 py-3">
          <div className="mb-2 text-fs-micro font-bold uppercase tracking-ls-caps text-ink-3">
            Activity
          </div>
          <ActivityRail variant="full" />
        </section>
      </div>
    </div>
  );
}
