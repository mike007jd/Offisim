import { Card, CardContent, CardHeader, CardTitle } from '@offisim/ui-core';
import type { CostSummary } from '../../hooks/useCostDashboard';

function formatCost(usd: number): string {
  if (usd === 0) return '$0.00';
  if (usd < 0.0001) return `$${usd.toExponential(2)}`;
  return `$${usd.toFixed(4)}`;
}

interface CostOverviewCardProps {
  summary: CostSummary;
  loading: boolean;
}

function formatConfidence(confidence: CostSummary['costConfidence']): string {
  switch (confidence) {
    case 'exact':
      return 'Exact';
    case 'catalog':
      return 'Catalog estimate';
    case 'fallback':
      return 'Fallback estimate';
    default:
      return 'Unknown';
  }
}

export function CostOverviewCard({ summary, loading }: CostOverviewCardProps) {
  if (loading) {
    return (
      <Card>
        <CardHeader className="pb-2">
          <CardTitle className="text-sm font-semibold uppercase tracking-wider text-ink-2">
            Cost Overview
          </CardTitle>
        </CardHeader>
        <CardContent>
          <div className="text-xs text-ink-2/60">Loading...</div>
        </CardContent>
      </Card>
    );
  }

  return (
    <Card>
      <CardHeader className="pb-2">
        <CardTitle className="text-sm font-semibold uppercase tracking-wider text-ink-2">
          Cost Overview
        </CardTitle>
      </CardHeader>
      <CardContent>
        <div className="grid grid-cols-2 gap-3">
          <KpiCell label="Total Cost" value={formatCost(summary.totalCost)} />
          <KpiCell label="Today" value={formatCost(summary.todayCost)} />
          <KpiCell label="Total Calls" value={String(summary.totalCalls)} />
          <KpiCell label="Today Calls" value={String(summary.todayCalls)} />
          <KpiCell label="Pricing" value={formatConfidence(summary.costConfidence)} />
          <KpiCell label="Unpriced Calls" value={String(summary.unpricedCallCount)} />
        </div>
      </CardContent>
    </Card>
  );
}

function KpiCell({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-md border border-line bg-surface-sunken/20 p-2">
      <div className="text-fs-micro text-ink-2/70 font-mono uppercase">{label}</div>
      <div className="text-sm font-medium text-ink-1 font-mono">{value}</div>
    </div>
  );
}
