import { getTauriDb } from '@/lib/tauri-db.js';
import { isTauriRuntime } from './adapters.js';
import type { RunCost } from './types.js';

// Run-cost reader: aggregates the live cost truth from `agent_runs.usage_json`
// (the rolled-up `{ input, output, cacheRead, cacheWrite, cost, turns }` blob
// written by reconcileRoot). Reads ONLY root rows (`run_id = root_run_id`) — each
// root row already includes its own usage plus its children's, so summing root
// rows alone avoids double-counting child runs. The old `llm_calls` +
// `model_cost_rates` pricing engine is gone (that table is dead).

function formatCostLabel(cost: number): string {
  if (cost > 0 && cost < 0.01) return `$${cost.toFixed(4)}`;
  return `$${cost.toFixed(2)}`;
}

export async function loadRunCost(): Promise<RunCost> {
  if (!isTauriRuntime()) return { tokens: 0, costLabel: '$0.00', live: false };
  try {
    const db = await getTauriDb();
    // Root rows only — each already aggregates its subtree, so child rows would
    // double-count.
    const rows = await db.select<Array<{ usage_json: string | null }>>(
      'SELECT usage_json FROM agent_runs WHERE run_id = root_run_id AND usage_json IS NOT NULL',
    );
    let input = 0;
    let output = 0;
    let cacheRead = 0;
    let cacheWrite = 0;
    let cost = 0;
    for (const row of rows) {
      if (!row.usage_json) continue;
      try {
        const u = JSON.parse(row.usage_json) as {
          input?: number;
          output?: number;
          cacheRead?: number;
          cacheWrite?: number;
          cost?: number;
        };
        input += u.input ?? 0;
        output += u.output ?? 0;
        cacheRead += u.cacheRead ?? 0;
        cacheWrite += u.cacheWrite ?? 0;
        cost += u.cost ?? 0;
      } catch {
        /* ignore a malformed usage blob */
      }
    }
    const tokens = input + output + cacheRead + cacheWrite;
    // Tokens flowed but cost is zero → the lane didn't report a price (e.g. the
    // compat default provider where cost is 0). Surface that honestly rather than
    // claiming a free run. With no tokens at all, '$0.00' is the correct label.
    const costLabel = tokens > 0 && cost === 0 ? 'Cost unavailable' : formatCostLabel(cost);
    return { tokens, costLabel, live: rows.length > 0 };
  } catch {
    // A missing/renamed table or column should degrade to a non-live zero cost,
    // not surface as a hard query error in the cost UI.
    return { tokens: 0, costLabel: '$0.00', live: false };
  }
}
