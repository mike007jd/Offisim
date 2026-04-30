import { Zap } from 'lucide-react';

interface EnergyMeterProps {
  usedTokens: number;
  costUsd: number;
}

function formatTokens(n: number): string {
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(1)}M`;
  if (n >= 1_000) return `${(n / 1_000).toFixed(1)}K`;
  return String(n);
}

export function EnergyMeter({ usedTokens, costUsd }: EnergyMeterProps) {
  if (usedTokens === 0 && costUsd === 0) return null;

  return (
    <div className="flex items-center space-x-2 group relative">
      {usedTokens > 0 && (
        <span className="flex items-center space-x-1 font-mono">
          <Zap className="h-3 w-3 text-warning" />
          <span>{formatTokens(usedTokens)}</span>
        </span>
      )}
      {costUsd > 0 && <span className="font-mono text-success">${costUsd.toFixed(4)}</span>}
      <div className="absolute bottom-full mb-2 left-1/2 -translate-x-1/2 hidden group-hover:block z-50">
        <div className="whitespace-nowrap rounded-lg border border-border-default bg-surface-elevated px-3 py-2 text-[10px] text-text-secondary shadow-xl">
          Energy is the user-friendly representation of model token usage.
          <br />
          Higher energy = deeper reasoning, longer context, more execution capacity.
        </div>
      </div>
    </div>
  );
}
