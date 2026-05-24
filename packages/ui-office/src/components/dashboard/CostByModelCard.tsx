import type { CostAggregate } from '@offisim/core/browser';
import { Card, CardContent, CardHeader, CardTitle } from '@offisim/ui-core';

/** Provider → bar color mapping. */
const PROVIDER_COLORS: Record<string, string> = {
  openai: 'bg-ok',
  anthropic: 'bg-warn',
  'openai-compat': 'bg-accent',
};

function getBarColor(groupKey: string): string {
  const provider = groupKey.split('/')[0] ?? '';
  return PROVIDER_COLORS[provider] ?? 'bg-ink-3';
}

function formatCost(usd: number): string {
  if (usd === 0) return '$0';
  if (usd < 0.01) return `$${usd.toFixed(4)}`;
  return `$${usd.toFixed(2)}`;
}

function formatPricingNote(agg: CostAggregate): string | null {
  const notes: string[] = [];
  if (agg.unpricedCallCount > 0) {
    notes.push(`${agg.unpricedCallCount} unpriced`);
  }
  if (agg.pricingConfidence === 'unknown') {
    notes.push('unknown pricing');
  } else if (agg.pricingConfidence === 'catalog') {
    notes.push('catalog estimate');
  } else if (agg.pricingConfidence === 'fallback') {
    notes.push('fallback estimate');
  }
  return notes.length > 0 ? notes.join(' • ') : null;
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
        <CardTitle className="text-sm font-semibold uppercase tracking-wider text-ink-2">
          Cost by Model
        </CardTitle>
      </CardHeader>
      <CardContent>
        {loading ? (
          <div className="text-xs text-ink-2/60">Loading...</div>
        ) : byModel.length === 0 ? (
          <div className="text-xs text-ink-2/60">No LLM calls recorded yet.</div>
        ) : (
          <div className="flex flex-col gap-2">
            {byModel.map((agg) => {
              const widthPct = maxCost > 0 ? Math.max((agg.totalCost / maxCost) * 100, 2) : 0;
              const pricingNote = formatPricingNote(agg);
              const barStyle = { width: `${widthPct}%` };
              return (
                <div key={agg.groupKey} className="flex flex-col gap-0.5">
                  <div className="flex items-center justify-between text-fs-micro">
                    <span className="text-ink-1 font-mono truncate max-w-cost-model-name">
                      {agg.groupKey}
                    </span>
                    <span className="text-ink-2/70 font-mono">
                      {formatCost(agg.totalCost)} ({agg.callCount} calls)
                    </span>
                  </div>
                  <div className="h-2 w-full rounded-full bg-surface-sunken">
                    <div
                      className={`h-2 rounded-full transition-all ${getBarColor(agg.groupKey)}`}
                      // ui-hardcode-allowed: runtime geometry or third-party primitive style bridge.
                      style={barStyle}
                    />
                  </div>
                  {pricingNote ? (
                    <div className="text-fs-micro font-mono text-ink-2/55">{pricingNote}</div>
                  ) : null}
                </div>
              );
            })}
          </div>
        )}
      </CardContent>
    </Card>
  );
}
