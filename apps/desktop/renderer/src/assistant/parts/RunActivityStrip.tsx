import { cn } from '@/lib/utils.js';
import { WorkBench } from '@/surfaces/office/scene/work-bench/WorkBench.js';
import { ChevronDown, ChevronRight } from 'lucide-react';
import { useMemo, useState } from 'react';
import { isConversationRunActive, useConversationRun } from '../runtime/conversation-run-react.js';
import { RunActivitySummary, WorkspaceDisclosure } from './WorkspaceDisclosure.js';

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
  const runtimeStatus = run.runtimeStatus;
  const rootId = run.attemptId;
  // Flatten the delegation forest into DFS order with depth, so the strip shows
  // the real run tree (who delegated whom, nested) rather than a flat list. A
  // direct child's parentRunId is the root run's attemptId; a nested child's is
  // another delegation's runId. Memoized so it only rebuilds when delegations
  // change, not on every activity/streaming tick. (Computed before the early
  // return to satisfy the rules of hooks.)
  const orderedDelegations = useMemo(() => {
    type Delegation = (typeof delegations)[number];
    const byParent = new Map<string, Delegation[]>();
    for (const d of delegations) {
      const key = d.parentRunId ?? '';
      const siblings = byParent.get(key);
      if (siblings) siblings.push(d);
      else byParent.set(key, [d]);
    }
    const ordered: Array<{ d: Delegation; depth: number }> = [];
    const seen = new Set<string>();
    const visit = (parentId: string, depth: number) => {
      for (const d of byParent.get(parentId) ?? []) {
        if (seen.has(d.runId)) continue; // guard against cycles / duplicate ids
        seen.add(d.runId);
        ordered.push({ d, depth });
        visit(d.runId, depth + 1);
      }
    };
    visit(rootId ?? '', 0);
    // Orphans (parent not in this tree, e.g. an out-of-order terminal) at depth 0.
    for (const d of delegations) {
      if (!seen.has(d.runId)) ordered.push({ d, depth: 0 });
    }
    return ordered;
  }, [delegations, rootId]);
  // Render while active if there's either direct tool work or a delegation — a
  // run that only delegates has no tool calls of its own.
  const hasLifecycle =
    Boolean(runtimeStatus.message) ||
    runtimeStatus.contextPercent !== null ||
    runtimeStatus.steeringQueued + runtimeStatus.followUpQueued > 0;
  if (!isRunning || (activity.length === 0 && delegations.length === 0 && !hasLifecycle))
    return null;
  // Most recent calls, oldest→newest, capped so the strip stays one compact row.
  const recent = activity.slice(-6);
  const latest = recent[recent.length - 1];
  const latestError = [...recent].reverse().find((entry) => entry.state === 'error');
  const latestSummary = latestError
    ? `${latestError.tool} failed${latestError.detail ? `: ${latestError.detail}` : ''}`
    : latest
      ? `${latest.tool}${latest.detail ? ` · ${latest.detail}` : ''}`
      : (runtimeStatus.message ?? 'Preparing tools');
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
        <RunActivitySummary summary={latestSummary} />
        {hidden > 0 ? <span className="off-run-act-more">+{hidden}</span> : null}
      </button>
      {orderedDelegations.length > 0 ? (
        <div className="off-run-delegations">
          {orderedDelegations.map(({ d, depth }) => (
            <div
              key={d.runId}
              className={cn('off-run-delegation', `is-${d.state}`)}
              style={{ paddingLeft: `calc(${depth} * var(--off-sp-3))` }}
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
        {runtimeStatus.contextPercent !== null ? (
          <span className="off-run-act is-running">
            <span className="off-run-act-dot" />
            <span className="off-run-act-name">
              Context {Math.round(runtimeStatus.contextPercent)}%
            </span>
          </span>
        ) : null}
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
              {entry.workspaceProvenance ? (
                <WorkspaceDisclosure provenance={entry.workspaceProvenance} status={entry.state} />
              ) : (
                <WorkBench detail={entry.richDetail} status={entry.state} />
              )}
            </div>
          ))}
        </div>
      ) : null}
    </div>
  );
}
