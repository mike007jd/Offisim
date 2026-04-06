import { Activity, Sparkles, TerminalSquare, Wrench } from 'lucide-react';
import { useRuntimeActivityFeed } from '../../runtime/use-runtime-activity-feed';

const ENTRY_STYLES = {
  info: 'border-cyan-400/20 bg-cyan-400/8 text-cyan-100',
  success: 'border-emerald-400/20 bg-emerald-400/8 text-emerald-100',
  warning: 'border-amber-400/20 bg-amber-400/8 text-amber-100',
  error: 'border-rose-400/20 bg-rose-400/8 text-rose-100',
} as const;

function formatCost(totalCostUsd: number | null): string | null {
  if (totalCostUsd == null || totalCostUsd <= 0) return null;
  return totalCostUsd < 0.01 ? '$0.01<' : `$${totalCostUsd.toFixed(2)}`;
}

interface ActivityRailProps {
  focusedEmployeeId?: string | null;
  focusedEmployeeName?: string | null;
}

export function ActivityRail({
  focusedEmployeeId = null,
  focusedEmployeeName = null,
}: ActivityRailProps) {
  const { headline, entries, activeTools, totalCostUsd, hasActivity } = useRuntimeActivityFeed();

  if (!hasActivity) {
    return (
      <div className="mb-2 rounded-2xl border border-white/8 bg-white/3 px-3 py-2 text-[11px] text-slate-500">
        Waiting for a task to start…
      </div>
    );
  }

  const costLabel = formatCost(totalCostUsd);
  const visibleEntries = focusedEmployeeId
    ? entries.filter((entry) => entry.employeeId == null || entry.employeeId === focusedEmployeeId)
    : entries;

  return (
    <div className="mb-2 rounded-2xl border border-white/10 bg-[radial-gradient(circle_at_top_left,rgba(59,130,246,0.18),transparent_42%),linear-gradient(180deg,rgba(255,255,255,0.06),rgba(255,255,255,0.02))] px-3 py-2 shadow-[0_0_0_1px_rgba(255,255,255,0.02),0_16px_40px_rgba(2,6,23,0.18)]">
      <div className="flex flex-wrap items-center gap-2 text-[11px] text-slate-200">
        <span className="inline-flex items-center gap-1 rounded-full border border-cyan-400/20 bg-cyan-400/10 px-2 py-0.5 text-cyan-100">
          <Activity className="h-3 w-3 animate-pulse" />
          <span className="font-medium">{headline ?? 'Runtime active'}</span>
        </span>
        {costLabel && (
          <span className="inline-flex items-center gap-1 rounded-full border border-violet-400/20 bg-violet-400/10 px-2 py-0.5 text-violet-100">
            <Sparkles className="h-3 w-3" />
            <span>{costLabel}</span>
          </span>
        )}
        {focusedEmployeeId && (
          <span className="inline-flex items-center gap-1 rounded-full border border-blue-400/20 bg-blue-500/10 px-2 py-0.5 text-blue-100">
            <span className="font-medium">Focus: {focusedEmployeeName ?? focusedEmployeeId}</span>
          </span>
        )}
      </div>

      {activeTools.length > 0 && (
        <div className="mt-2 flex flex-wrap gap-2">
          {activeTools.map((tool) => (
            <span
              key={tool.toolCallId}
              className="inline-flex items-center gap-1.5 rounded-full border border-emerald-400/20 bg-emerald-400/10 px-2 py-1 text-[11px] text-emerald-100"
            >
              <Wrench className="h-3 w-3" />
              <span className="font-medium">{tool.label}</span>
              <span className="rounded-full bg-black/20 px-1.5 py-px font-mono text-[10px] text-emerald-200/80">
                {tool.elapsedSeconds}s
              </span>
            </span>
          ))}
        </div>
      )}

      {visibleEntries.length > 0 && (
        <div className="mt-2 grid gap-1">
          {visibleEntries.slice(0, 4).map((entry) => (
            <div
              key={entry.id}
              className={`flex items-start gap-2 rounded-xl border px-2.5 py-1.5 text-[11px] ${ENTRY_STYLES[entry.tone]}`}
            >
              <TerminalSquare className="mt-0.5 h-3 w-3 shrink-0 opacity-80" />
              <span className="min-w-0 break-words leading-relaxed">{entry.label}</span>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
