import { useDashboardMetrics, useOffisimRuntimeStatus } from '@offisim/ui-office/web';
import { Sparkles } from 'lucide-react';
import type { ReactNode } from 'react';
import {
  SceneCostCluster,
  SceneCostDivider,
  SceneCostDot,
  SceneCostIconSlot,
  SceneCostMetricGroup,
  SceneCostPill,
  SceneCostValue,
} from './OfficeShellSurfaces';

function formatTokens(n: number): string {
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(1)}M`;
  if (n >= 1_000) return `${(n / 1_000).toFixed(1)}K`;
  return String(n);
}

interface SceneCostReadoutProps {
  /** Notification surface rendered immediately to the right of the readout. */
  notificationSlot?: ReactNode;
}

/** Cumulative token/cost readout for the shell run rail. */
export function SceneCostReadout({ notificationSlot }: SceneCostReadoutProps) {
  const metrics = useDashboardMetrics();
  const { isRunning } = useOffisimRuntimeStatus();
  const usedTokens = metrics.totalInputTokens + metrics.totalOutputTokens;
  const costUsd = metrics.estimatedCostUsd;

  return (
    <SceneCostCluster live={isRunning}>
      <SceneCostPill
        state={isRunning ? 'live' : 'idle'}
        title="Cumulative tokens · estimated spend for this company. Beats while a run is live; latency lives in the run flow, not here."
      >
        <SceneCostIconSlot>
          <Sparkles aria-hidden="true" />
        </SceneCostIconSlot>
        <SceneCostMetricGroup>
          <SceneCostDot state={isRunning ? 'live' : 'idle'} />
          <SceneCostValue>{formatTokens(usedTokens)}</SceneCostValue> tok
        </SceneCostMetricGroup>
        <SceneCostDivider />
        <SceneCostValue>${costUsd.toFixed(2)}</SceneCostValue>
      </SceneCostPill>
      {notificationSlot}
    </SceneCostCluster>
  );
}
