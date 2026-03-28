import { Card, CardContent, CardHeader, CardTitle } from '@offisim/ui-core';
import type { CostSummary } from '../../hooks/useCostDashboard';

function formatCost(usd: number): string {
  if (usd === 0) return '$0.0000';
  if (usd < 0.0001) return `$${usd.toExponential(2)}`;
  return `$${usd.toFixed(4)}`;
}

interface CostOverviewCardProps {
  summary: CostSummary;
  loading: boolean;
}

export function CostOverviewCard({ summary, loading }: CostOverviewCardProps) {
  if (loading) {
    return (
      <Card>
        <CardHeader className="pb-2">
          <CardTitle className="text-sm font-pixel-display uppercase tracking-wider text-shell">
            Cost Overview
          </CardTitle>
        </CardHeader>
        <CardContent>
          <div className="text-xs text-shell/60">Loading...</div>
        </CardContent>
      </Card>
    );
  }

  return (
    <Card>
      <CardHeader className="pb-2">
        <CardTitle className="text-sm font-pixel-display uppercase tracking-wider text-shell">
          Cost Overview
        </CardTitle>
      </CardHeader>
      <CardContent>
        <div className="grid grid-cols-2 gap-3">
          <KpiCell label="Total Cost" value={formatCost(summary.totalCost)} />
          <KpiCell label="Today" value={formatCost(summary.todayCost)} />
          <KpiCell label="Total Calls" value={String(summary.totalCalls)} />
          <KpiCell label="Today Calls" value={String(summary.todayCalls)} />
        </div>
      </CardContent>
    </Card>
  );
}

function KpiCell({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-md border border-ocean-light bg-ocean-mid/20 p-2">
      <div className="text-[10px] text-shell/70 font-pixel-mono uppercase">{label}</div>
      <div className="text-sm font-medium text-sand font-pixel-mono">{value}</div>
    </div>
  );
}
