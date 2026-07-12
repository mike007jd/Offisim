import { getTauriDb } from '@/lib/tauri-db.js';
import { isTauriRuntime } from './adapters.js';
import type { RunCost, RunCostBreakdown } from './types.js';

// Run-cost reader: aggregates the live cost truth from `agent_runs.usage_json`
// (the rolled-up `{ input, output, cacheRead, cacheWrite, cost, turns }` blob
// written by reconcileRoot). Totals read only root rows; the employee/model
// breakdown subtracts child rows from each rolled-up root, then groups every
// run's own usage without double-counting. The old `llm_calls` +
// `model_cost_rates` pricing engine is gone (that table is dead).

function formatCostLabel(cost: number): string {
  if (cost > 0 && cost < 0.01) return `$${cost.toFixed(4)}`;
  return `$${cost.toFixed(2)}`;
}

export async function loadRunCost(): Promise<RunCost> {
  if (!isTauriRuntime()) return { tokens: 0, costLabel: '$0.00', live: false, breakdown: [] };
  try {
    const db = await getTauriDb();
    const rows = await db.select<
      Array<{
        run_id: string;
        root_run_id: string;
        employee_id: string | null;
        employee_name: string | null;
        usage_json: string | null;
        runtime_context_json: string | null;
      }>
    >(
      `SELECT ar.run_id, ar.root_run_id, ar.employee_id, e.name AS employee_name,
              ar.usage_json, ar.runtime_context_json
         FROM agent_runs ar
         LEFT JOIN employees e ON e.employee_id = ar.employee_id
        WHERE ar.usage_json IS NOT NULL`,
    );
    let input = 0;
    let output = 0;
    let cacheRead = 0;
    let cacheWrite = 0;
    let cost = 0;
    const parsedRows = rows.flatMap((row) => {
      if (!row.usage_json) return [];
      try {
        const u = JSON.parse(row.usage_json) as {
          input?: number;
          output?: number;
          cacheRead?: number;
          cacheWrite?: number;
          cost?: number;
        };
        return [{ ...row, usage: u }];
      } catch {
        return [];
      }
    });
    const roots = parsedRows.filter((row) => row.run_id === row.root_run_id);
    for (const row of roots) {
      input += row.usage.input ?? 0;
      output += row.usage.output ?? 0;
      cacheRead += row.usage.cacheRead ?? 0;
      cacheWrite += row.usage.cacheWrite ?? 0;
      cost += row.usage.cost ?? 0;
    }
    const tokens = input + output + cacheRead + cacheWrite;
    // Tokens flowed but cost is zero → the lane didn't report a price (e.g. the
    // compat default provider where cost is 0). Surface that honestly rather than
    // claiming a free run. With no tokens at all, '$0.00' is the correct label.
    const costLabel = tokens > 0 && cost === 0 ? 'Cost unavailable' : formatCostLabel(cost);
    type Usage = (typeof parsedRows)[number]['usage'];
    const groups = new Map<string, RunCostBreakdown & { cost: number }>();
    const add = (
      employeeId: string | null,
      employeeName: string,
      model: string,
      usage: Usage,
    ) => {
      const rowTokens =
        (usage.input ?? 0) +
        (usage.output ?? 0) +
        (usage.cacheRead ?? 0) +
        (usage.cacheWrite ?? 0);
      const rowCost = usage.cost ?? 0;
      if (rowTokens === 0 && rowCost === 0) return;
      const key = `${employeeId ?? 'root'}\0${model}`;
      const current = groups.get(key) ?? {
        employeeId,
        employeeName,
        model,
        tokens: 0,
        cost: 0,
        costLabel: '$0.00',
      };
      current.tokens += rowTokens;
      current.cost += rowCost;
      groups.set(key, current);
    };
    const contextModel = (value: string | null, fallback: string): string => {
      if (!value) return fallback;
      try {
        const context = JSON.parse(value) as { model?: unknown; inheritedModel?: unknown };
        if (typeof context.model === 'string' && context.model.trim()) return context.model.trim();
        return context.inheritedModel === true ? 'Inherited conversation model' : fallback;
      } catch {
        return fallback;
      }
    };
    for (const child of parsedRows.filter((row) => row.run_id !== row.root_run_id)) {
      add(
        child.employee_id,
        child.employee_name ?? 'Employee',
        contextModel(child.runtime_context_json, 'Inherited conversation model'),
        child.usage,
      );
    }
    for (const root of roots) {
      const descendants = parsedRows.filter(
        (row) => row.root_run_id === root.run_id && row.run_id !== root.run_id,
      );
      const own: Usage = { ...root.usage };
      for (const child of descendants) {
        own.input = Math.max(0, (own.input ?? 0) - (child.usage.input ?? 0));
        own.output = Math.max(0, (own.output ?? 0) - (child.usage.output ?? 0));
        own.cacheRead = Math.max(0, (own.cacheRead ?? 0) - (child.usage.cacheRead ?? 0));
        own.cacheWrite = Math.max(0, (own.cacheWrite ?? 0) - (child.usage.cacheWrite ?? 0));
        own.cost = Math.max(0, (own.cost ?? 0) - (child.usage.cost ?? 0));
      }
      add(
        root.employee_id,
        root.employee_name ?? 'Lead agent',
        contextModel(root.runtime_context_json, 'Pi default'),
        own,
      );
    }
    const breakdown = [...groups.values()]
      .map(({ cost: groupCost, ...group }) => ({
        ...group,
        costLabel:
          group.tokens > 0 && groupCost === 0 ? 'Cost unavailable' : formatCostLabel(groupCost),
      }))
      .sort((a, b) => b.tokens - a.tokens || a.employeeName.localeCompare(b.employeeName));
    return { tokens, costLabel, live: roots.length > 0, breakdown };
  } catch {
    // A missing/renamed table or column should degrade to a non-live zero cost,
    // not surface as a hard query error in the cost UI.
    return { tokens: 0, costLabel: '$0.00', live: false, breakdown: [] };
  }
}
