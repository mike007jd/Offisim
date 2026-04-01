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
          <Zap className="w-3 h-3 text-amber-400/60" />
          <span>{formatTokens(usedTokens)}</span>
        </span>
      )}
      {costUsd > 0 && <span className="font-mono text-emerald-500/50">${costUsd.toFixed(4)}</span>}
      <div className="absolute bottom-full mb-2 left-1/2 -translate-x-1/2 hidden group-hover:block z-50">
        <div className="bg-zinc-800 border border-white/10 rounded-lg px-3 py-2 text-[10px] text-slate-300 whitespace-nowrap shadow-xl">
          Energy is the user-friendly representation of model token usage.
          <br />
          Higher energy = deeper reasoning, longer context, more execution capacity.
        </div>
      </div>
    </div>
  );
}
