import { Activity, Sparkles, TerminalSquare, Wrench } from 'lucide-react';
import { useRuntimeActivityFeed } from '../../runtime/use-runtime-activity-feed';

const ENTRY_STYLES = {
  info: 'info',
  success: 'success',
  warning: 'warning',
  error: 'error',
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
      <div className="activity-rail-empty">Run a task to see live activity here.</div>
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
      <div className="activity-rail activity-rail-compact">
        <div className="activity-rail-badges">
          <span className="activity-rail-badge" data-tone="info">
            <Activity data-icon="pulse" />
            <span className="activity-rail-badge-label">{headline ?? 'Runtime active'}</span>
          </span>
          {costLabel && (
            <span className="activity-rail-badge" data-tone="info">
              <Sparkles data-icon="sparkles" />
              <span>{costLabel}</span>
            </span>
          )}
          {focusedEmployeeId && (
            <span className="activity-rail-badge" data-tone="neutral">
              <span className="activity-rail-badge-label">
                Focus: {focusedEmployeeName ?? focusedEmployeeId}
              </span>
            </span>
          )}
        </div>
        {latestEntry && <p className="activity-rail-latest">{latestEntry.label}</p>}
      </div>
    );
  }

  return (
    <div className="activity-rail activity-rail-full">
      <div className="activity-rail-badges">
        <span className="activity-rail-badge" data-tone="info">
          <Activity data-icon="pulse" />
          <span className="activity-rail-badge-label">{headline ?? 'Runtime active'}</span>
        </span>
        {costLabel && (
          <span className="activity-rail-badge" data-tone="info">
            <Sparkles data-icon="sparkles" />
            <span>{costLabel}</span>
          </span>
        )}
        {focusedEmployeeId && (
          <span className="activity-rail-badge" data-tone="neutral">
            <span className="activity-rail-badge-label">
              Focus: {focusedEmployeeName ?? focusedEmployeeId}
            </span>
          </span>
        )}
      </div>

      {activeTools.length > 0 && (
        <div className="activity-rail-tools">
          {activeTools.map((tool) => (
            <span key={tool.toolCallId} className="activity-rail-tool">
              <Wrench data-icon="tool" />
              <span className="activity-rail-tool-label">{tool.label}</span>
              <span className="activity-rail-tool-elapsed">{tool.elapsedSeconds}s</span>
            </span>
          ))}
        </div>
      )}

      {visibleEntries.length > 0 && (
        <div className="activity-rail-entry-list">
          {visibleEntries.slice(0, 3).map((entry) => (
            <div
              key={entry.id}
              className="activity-rail-entry"
              data-tone={ENTRY_STYLES[entry.tone]}
            >
              <TerminalSquare data-icon="entry" />
              <span className="activity-rail-entry-label">{entry.label}</span>
              {entry.burstCount && entry.burstCount > 1 ? (
                <span className="activity-rail-entry-count">x{entry.burstCount}</span>
              ) : null}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
