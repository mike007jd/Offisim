import { Activity, Sparkles, TerminalSquare, Wrench } from 'lucide-react';
import { useRuntimeActivityFeed } from '../../runtime/use-runtime-activity-feed';

const ENTRY_STYLES = {
  info: 'border-info/30 bg-info-muted text-info',
  success: 'border-success/30 bg-success-muted text-success',
  warning: 'border-warning/30 bg-warning-muted text-warning',
  error: 'border-error/30 bg-error-muted text-error',
} as const;

function formatCost(totalCostUsd: number | null): string | null {
  if (totalCostUsd == null || totalCostUsd <= 0) return null;
  return totalCostUsd < 0.01 ? '$0.01<' : `$${totalCostUsd.toFixed(2)}`;
}

function shouldShowCompactEntry(entry: { kind: string; tone: string }): boolean {
  return entry.kind !== 'system' || entry.tone === 'warning' || entry.tone === 'error';
}

interface ActivityRailProps {
  focusedEmployeeId?: string | null;
  focusedEmployeeName?: string | null;
  variant?: 'compact' | 'full';
}

export function ActivityRail({
  focusedEmployeeId = null,
  focusedEmployeeName = null,
  variant = 'full',
}: ActivityRailProps) {
  const { headline, entries, activeTools, totalCostUsd, hasActivity } = useRuntimeActivityFeed();

  if (!hasActivity) {
    return variant === 'compact' ? null : (
      <div className="mb-2 rounded-2xl border border-border-subtle bg-surface-muted px-3 py-2 text-[11px] text-text-muted">
        Run a task to see live activity here.
      </div>
    );
  }

  const costLabel = formatCost(totalCostUsd);
  const scopedEntries = focusedEmployeeId
    ? entries.filter((entry) => entry.employeeId == null || entry.employeeId === focusedEmployeeId)
    : entries;
  const visibleEntries =
    variant === 'compact' ? scopedEntries.filter(shouldShowCompactEntry) : scopedEntries;
  const latestEntry = visibleEntries[0] ?? null;

  if (variant === 'compact') {
    if (!latestEntry && activeTools.length === 0 && !costLabel) return null;
    return (
      <div className="mb-2 rounded-2xl border border-border-subtle bg-surface-muted px-3 py-2">
        <div className="flex flex-wrap items-center gap-2 text-[11px] text-text-secondary">
          <span className="inline-flex items-center gap-1 rounded-full border border-info/30 bg-info-muted px-2 py-0.5 text-info">
            <Activity className="h-3 w-3 animate-pulse" />
            <span className="font-medium">{headline ?? 'Runtime active'}</span>
          </span>
          {costLabel && (
            <span className="inline-flex items-center gap-1 rounded-full border border-accent/30 bg-accent-muted px-2 py-0.5 text-accent">
              <Sparkles className="h-3 w-3" />
              <span>{costLabel}</span>
            </span>
          )}
          {focusedEmployeeId && (
            <span className="inline-flex items-center gap-1 rounded-full border border-border-default bg-surface-elevated px-2 py-0.5 text-text-secondary">
              <span className="font-medium">Focus: {focusedEmployeeName ?? focusedEmployeeId}</span>
            </span>
          )}
        </div>
        {latestEntry && (
          <p className="mt-2 truncate text-[11px] text-text-muted">{latestEntry.label}</p>
        )}
      </div>
    );
  }

  return (
    <div className="mb-2 rounded-2xl border border-border-subtle bg-surface-muted px-3 py-2 shadow-overlay">
      <div className="flex flex-wrap items-center gap-2 text-[11px] text-text-secondary">
        <span className="inline-flex items-center gap-1 rounded-full border border-info/30 bg-info-muted px-2 py-0.5 text-info">
          <Activity className="h-3 w-3 animate-pulse" />
          <span className="font-medium">{headline ?? 'Runtime active'}</span>
        </span>
        {costLabel && (
          <span className="inline-flex items-center gap-1 rounded-full border border-accent/30 bg-accent-muted px-2 py-0.5 text-accent">
            <Sparkles className="h-3 w-3" />
            <span>{costLabel}</span>
          </span>
        )}
        {focusedEmployeeId && (
          <span className="inline-flex items-center gap-1 rounded-full border border-border-default bg-surface-elevated px-2 py-0.5 text-text-secondary">
            <span className="font-medium">Focus: {focusedEmployeeName ?? focusedEmployeeId}</span>
          </span>
        )}
      </div>

      {activeTools.length > 0 && (
        <div className="mt-2 flex flex-wrap gap-2">
          {activeTools.map((tool) => (
            <span
              key={tool.toolCallId}
              className="inline-flex items-center gap-1.5 rounded-full border border-success/30 bg-success-muted px-2 py-1 text-[11px] text-success"
            >
              <Wrench className="h-3 w-3" />
              <span className="font-medium">{tool.label}</span>
              <span className="rounded-full bg-surface-elevated px-1.5 py-px font-mono text-[10px] text-success">
                {tool.elapsedSeconds}s
              </span>
            </span>
          ))}
        </div>
      )}

      {visibleEntries.length > 0 && (
        <div className="mt-2 grid gap-1">
          {visibleEntries.slice(0, 3).map((entry) => (
            <div
              key={entry.id}
              className={`flex items-start gap-2 rounded-xl border px-2.5 py-1.5 text-[11px] ${ENTRY_STYLES[entry.tone]}`}
            >
              <TerminalSquare className="mt-0.5 h-3 w-3 shrink-0 opacity-80" />
              <span className="min-w-0 break-words leading-relaxed">{entry.label}</span>
              {entry.burstCount && entry.burstCount > 1 ? (
                <span className="ml-auto shrink-0 rounded-full bg-surface-elevated px-1.5 py-px font-mono text-[10px] opacity-85">
                  x{entry.burstCount}
                </span>
              ) : null}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
