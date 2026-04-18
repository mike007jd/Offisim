import { Plug, Plus } from 'lucide-react';

export interface MarketExternalAgentCardProps {
  onClick: () => void;
  variant?: 'grid' | 'row';
}

export function MarketExternalAgentCard({
  onClick,
  variant = 'grid',
}: MarketExternalAgentCardProps) {
  if (variant === 'row') {
    return (
      <button
        type="button"
        onClick={onClick}
        className="flex w-full items-center justify-between gap-3 rounded-xl border border-dashed border-cyan-400/40 bg-cyan-500/5 px-4 py-3 text-left transition-colors hover:border-cyan-300 hover:bg-cyan-500/10"
      >
        <div className="flex items-center gap-3">
          <span className="flex h-9 w-9 items-center justify-center rounded-lg border border-cyan-400/40 bg-cyan-500/10 text-cyan-200">
            <Plug className="h-4 w-4" />
          </span>
          <div>
            <p className="text-sm font-semibold text-slate-100">Connect external A2A agent</p>
            <p className="text-xs text-slate-400">
              Paste a live agent URL to add it as a branded external employee.
            </p>
          </div>
        </div>
        <Plus className="h-4 w-4 text-cyan-200" />
      </button>
    );
  }

  return (
    <button
      type="button"
      onClick={onClick}
      className="flex h-full min-h-[180px] flex-col items-start justify-between gap-4 rounded-2xl border border-dashed border-cyan-400/40 bg-gradient-to-br from-cyan-500/10 via-slate-900/40 to-slate-950 p-5 text-left transition-colors hover:border-cyan-300 hover:from-cyan-500/15"
    >
      <div className="flex items-center gap-3">
        <span className="flex h-10 w-10 items-center justify-center rounded-xl border border-cyan-400/40 bg-cyan-500/10 text-cyan-200">
          <Plug className="h-5 w-5" />
        </span>
        <div>
          <p className="text-[11px] font-semibold uppercase tracking-[0.2em] text-cyan-300">
            External
          </p>
          <p className="text-sm font-semibold text-slate-100">Connect external A2A agent</p>
        </div>
      </div>
      <p className="text-xs text-slate-400">
        Hook in any JSON-RPC A2A endpoint — Hermes, OpenClaw, Codex, or your own brand — and it
        joins the office as a branded external employee.
      </p>
      <span className="inline-flex items-center gap-1.5 rounded-full border border-cyan-400/40 bg-cyan-500/10 px-3 py-1 text-xs text-cyan-200">
        <Plus className="h-3.5 w-3.5" /> Add agent
      </span>
    </button>
  );
}
