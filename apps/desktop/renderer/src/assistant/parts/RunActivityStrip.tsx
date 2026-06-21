import { cn } from '@/lib/utils.js';
import { ChevronDown, ChevronRight } from 'lucide-react';
import { useState } from 'react';
import { isConversationRunActive, useConversationRun } from '../runtime/conversation-run-react.js';

/**
 * A compact, in-thread strip showing the agent's tool calls as they happen
 * (builtin + MCP, fed from the graph's `mcp.tool.*` events via the run store).
 * It turns a long run from a blank streaming bubble into visible work, and it
 * lives in the chat column — not the diegetic stage — so progress sits where the
 * user is actually reading. Renders only while a run is in flight with at least
 * one tool call.
 */
export function RunActivityStrip({ threadId }: { threadId: string }) {
  const [expanded, setExpanded] = useState(false);
  const run = useConversationRun(threadId);
  const isRunning = isConversationRunActive(run.phase);
  const activity = run.activity;
  const activityTotal = run.activityTotal;
  const delegations = run.delegations;
  // Render while active if there's either direct tool work or a delegation — a
  // run that only delegates has no tool calls of its own.
  if (!isRunning || (activity.length === 0 && delegations.length === 0)) return null;
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
      {delegations.length > 0 ? (
        <div className="off-run-delegations">
          {delegations.map((d) => (
            <div
              key={d.runId}
              className={cn('off-run-delegation', `is-${d.state}`)}
              title={d.employeeId ?? undefined}
            >
              <span className="off-run-delegation-arrow" aria-hidden>
                →
              </span>
              <span className="off-run-delegation-label">Delegated</span>
              <span className="off-run-delegation-objective">
                {d.objective || d.summary || 'teammate task'}
              </span>
              <span className="off-run-delegation-state">{d.state}</span>
            </div>
          ))}
        </div>
      ) : null}
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
