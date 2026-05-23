import { cn } from '@offisim/ui-core';
import { useDashboardMetrics, useOffisimRuntimeStatus } from '@offisim/ui-office/web';
import { Sparkles } from 'lucide-react';
import type { ReactNode } from 'react';

function formatTokens(n: number): string {
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(1)}M`;
  if (n >= 1_000) return `${(n / 1_000).toFixed(1)}K`;
  return String(n);
}

interface SceneCostReadoutProps {
  /** Notification surface rendered immediately to the right of the readout. */
  notificationSlot?: ReactNode;
}

/**
 * Diegetic cumulative cost readout pinned to the stage bottom-right (replaces the
 * deleted StatusBar EnergyMeter). Tokens + estimated spend only — latency lives in
 * the Live run overlay, not here. While a run is live the readout gains an
 * accent-ring border and a pulsing beat dot (过程即价值 — money burning is felt).
 */
export function SceneCostReadout({ notificationSlot }: SceneCostReadoutProps) {
  const metrics = useDashboardMetrics();
  const { isRunning } = useOffisimRuntimeStatus();
  const usedTokens = metrics.totalInputTokens + metrics.totalOutputTokens;
  const costUsd = metrics.estimatedCostUsd;

  return (
    <div
      className={cn(
        'pointer-events-auto absolute bottom-sp-6 right-sp-7 z-elevated flex items-center gap-sp-3',
        isRunning && 'scene-cost-live',
      )}
    >
      <span
        className={cn(
          'inline-flex h-7 items-center gap-2 rounded-r-pill border border-line bg-surface-1/80 px-3 text-fs-meta font-medium tabular-nums text-ink-3 shadow-elev-1 backdrop-blur-sm',
          isRunning && 'border-accent-ring text-ink-2',
        )}
        title="Cumulative tokens · estimated spend for this company. Beats while a run is live; latency lives in the run flow, not here."
      >
        <Sparkles className="size-3 text-accent" aria-hidden="true" />
        <span className="inline-flex items-center gap-1">
          <span
            aria-hidden="true"
            className={cn(
              'size-1.5 rounded-full',
              isRunning ? 'animate-pulse bg-accent' : 'bg-ok',
            )}
          />
          <b className="font-semibold text-ink-2">{formatTokens(usedTokens)}</b> tok
        </span>
        <span aria-hidden="true" className="h-3 w-px bg-line" />
        <b className="font-semibold text-ink-2">${costUsd.toFixed(2)}</b>
      </span>
      {notificationSlot}
    </div>
  );
}
