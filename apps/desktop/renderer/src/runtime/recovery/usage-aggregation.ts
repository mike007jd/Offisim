/**
 * Shared agent-run subtree usage aggregation (Epic A — durable resume).
 *
 * Extracted from `DesktopAgentRuntime.reconcileRoot` so the same summing rule is
 * used by BOTH the live finalize path and the startup interrupted-run reconciler
 * (DR-003). Pure: a function of the rows passed in + an optional root-usage param.
 */

import type { AgentRunRow } from '@offisim/core/browser';
import type { AgentRunUsage } from '@offisim/shared-types';

export interface AggregatedUsage {
  input: number;
  output: number;
  cacheRead: number;
  cacheWrite: number;
  cost: number;
  turns: number;
}

export interface SubtreeUsageResult {
  /** The summed usage across the subtree. */
  usage: AggregatedUsage;
  /** JSON to persist on the root row, or null when there's nothing worth recording. */
  usageJson: string | null;
  /** Non-root child run ids still `running` — the dangling set a finalize/reconcile cancels. */
  dangling: string[];
}

/**
 * Aggregate usage across a run subtree and collect children left `running`.
 *
 * `rows` is the full set under a root (as returned by `findByRoot`, INCLUDING the
 * root row). Each NON-root child's `usage_json` is summed. The root row's OWN
 * usage is never read from its row here — it must be passed as `rootUsage`, since
 * the root's terminal event isn't persisted to its own row by `persistAgentRun`
 * (the row's `usage_json` is null at finalize time, so reading it would lose the
 * root's usage; and at reconcile time passing it as a param avoids double-count).
 * `dangling` is every non-root child still `running`.
 *
 * The "is there anything worth writing" test deliberately ignores cache-only
 * usage (cacheRead/cacheWrite) — it matches the original finalize behavior.
 */
export function aggregateSubtreeUsage(
  rows: AgentRunRow[],
  rootRunId: string,
  rootUsage?: AgentRunUsage,
): SubtreeUsageResult {
  const usage: AggregatedUsage = {
    input: 0,
    output: 0,
    cacheRead: 0,
    cacheWrite: 0,
    cost: 0,
    turns: 0,
  };
  const dangling: string[] = [];
  for (const row of rows) {
    if (row.run_id === rootRunId) continue;
    if (row.usage_json) {
      try {
        const u = JSON.parse(row.usage_json) as Partial<AggregatedUsage>;
        usage.input += u.input ?? 0;
        usage.output += u.output ?? 0;
        usage.cacheRead += u.cacheRead ?? 0;
        usage.cacheWrite += u.cacheWrite ?? 0;
        usage.cost += u.cost ?? 0;
        usage.turns += u.turns ?? 0;
      } catch {
        /* ignore a malformed usage blob */
      }
    }
    if (row.status === 'running') dangling.push(row.run_id);
  }
  usage.input += rootUsage?.input ?? 0;
  usage.output += rootUsage?.output ?? 0;
  usage.cacheRead += rootUsage?.cacheRead ?? 0;
  usage.cacheWrite += rootUsage?.cacheWrite ?? 0;
  usage.cost += rootUsage?.cost ?? 0;
  usage.turns += rootUsage?.turns ?? 0;
  const usageJson =
    usage.input || usage.output || usage.cost || usage.turns ? JSON.stringify(usage) : null;
  return { usage, usageJson, dangling };
}
