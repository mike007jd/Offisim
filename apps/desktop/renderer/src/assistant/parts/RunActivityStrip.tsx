import { cn } from '@/lib/utils.js';
import { ChevronDown, ChevronRight } from 'lucide-react';
import { useState } from 'react';
import { useRunStore } from '../run-store.js';

/**
 * A compact, in-thread strip showing the agent's tool calls as they happen
 * (builtin + MCP, fed from the graph's `mcp.tool.*` events via the run store).
 * It turns a long run from a blank streaming bubble into visible work, and it
 * lives in the chat column — not the diegetic stage — so progress sits where the
 * user is actually reading. Renders only while a run is in flight with at least
 * one tool call.
 */
export function RunActivityStrip() {
  const [expanded, setExpanded] = useState(false);
  const isRunning = useRunStore((s) => s.isRunning);
  const activity = useRunStore((s) => s.activity);
  const activityTotal = useRunStore((s) => s.activityTotal);
  if (!isRunning || activity.length === 0) return null;
  // Most recent calls, oldest→newest, capped so the strip stays one compact row.
  const recent = activity.slice(-6);
  const latest = recent[recent.length - 1];
  const latestError = [...recent].reverse().find((entry) => entry.state === 'error');
  // Count against the run-wide total (not the capped array) so the badge stays
  // accurate even after older entries are evicted from `activity`.
  const hidden = activityTotal - recent.length;
  return (
    <div
      className={cn('off-run-activity', expanded && 'is-expanded')}
      aria-live="polite"
      aria-label="Tool activity"
    >
      <button
        type="button"
        className="off-run-act-summary off-focusable"
        aria-expanded={expanded}
        onClick={() => setExpanded((open) => !open)}
      >
        {expanded ? <ChevronDown aria-hidden /> : <ChevronRight aria-hidden />}
        <span className="off-run-act-lead">{latestError ? 'Review' : 'Working'}</span>
        <span className="off-run-act-current">
          {latestError
            ? `${latestError.tool} failed${latestError.detail ? `: ${latestError.detail}` : ''}`
            : latest
              ? `${latest.tool}${latest.detail ? ` · ${latest.detail}` : ''}`
              : 'Preparing tools'}
        </span>
        {hidden > 0 ? <span className="off-run-act-more">+{hidden}</span> : null}
      </button>
      <div className="off-run-act-list">
        {recent.map((entry) => (
          <span key={entry.id} className={cn('off-run-act', `is-${entry.state}`)}>
            <span className="off-run-act-dot" />
            <span className="off-run-act-name">{entry.tool}</span>
            {entry.durationMs ? (
              <span className="off-run-act-ms">{Math.round(entry.durationMs)}ms</span>
            ) : null}
          </span>
        ))}
      </div>
      {expanded ? (
        <div className="off-run-act-detail">
          {recent.map((entry) => (
            <div
              key={`${entry.id}-detail`}
              className={cn('off-run-act-detail-row', `is-${entry.state}`)}
            >
              <span className="off-run-act-detail-tool">{entry.tool}</span>
              <span className="off-run-act-detail-copy">
                {entry.detail ?? (entry.state === 'running' ? 'Running' : 'No details')}
              </span>
            </div>
          ))}
        </div>
      ) : null}
    </div>
  );
}
