import type { CostAggregate } from '@aics/core/browser';
import { Card, CardContent, CardHeader, CardTitle } from '@aics/ui-core';

/** Provider → bar color mapping. */
const PROVIDER_COLORS: Record<string, string> = {
  openai: 'bg-emerald-500',
  anthropic: 'bg-amber-500',
  'openai-compat': 'bg-sky-500',
};

function getBarColor(groupKey: string): string {
  const provider = groupKey.split('/')[0] ?? '';
  return PROVIDER_COLORS[provider] ?? 'bg-slate-400';
}

function formatCost(usd: number): string {
  if (usd === 0) return '$0';
  if (usd < 0.01) return `$${usd.toFixed(4)}`;
  return `$${usd.toFixed(2)}`;
}

interface CostByModelCardProps {
  byModel: CostAggregate[];
  loading: boolean;
}

export function CostByModelCard({ byModel, loading }: CostByModelCardProps) {
  const maxCost = byModel.length > 0 ? Math.max(...byModel.map((m) => m.totalCost)) : 0;

  return (
    <Card>
      <CardHeader className="pb-2">
        <CardTitle className="text-sm font-pixel-display uppercase tracking-wider text-shell">
          Cost by Model
        </CardTitle>
      </CardHeader>
      <CardContent>
        {loading ? (
          <div className="text-xs text-shell/60">Loading...</div>
        ) : byModel.length === 0 ? (
          <div className="text-xs text-shell/60">No LLM calls recorded yet.</div>
        ) : (
          <div className="flex flex-col gap-2">
            {byModel.map((agg) => {
              const widthPct = maxCost > 0 ? Math.max((agg.totalCost / maxCost) * 100, 2) : 0;
              return (
                <div key={agg.groupKey} className="flex flex-col gap-0.5">
                  <div className="flex items-center justify-between text-[10px]">
                    <span className="text-sand font-pixel-mono truncate max-w-[60%]">
                      {agg.groupKey}
                    </span>
                    <span className="text-shell/70 font-pixel-mono">
                      {formatCost(agg.totalCost)} ({agg.callCount} calls)
                    </span>
                  </div>
                  <div className="h-2 w-full rounded-full bg-ocean-mid/30">
                    <div
                      className={`h-2 rounded-full transition-all ${getBarColor(agg.groupKey)}`}
                      style={{ width: `${widthPct}%` }}
                    />
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </CardContent>
    </Card>
  );
}
