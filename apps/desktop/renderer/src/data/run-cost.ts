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

interface RunCostDatabase {
  select<T>(query: string, bindValues?: unknown[]): Promise<T>;
}

interface RunCostRow {
  run_id: string;
  root_run_id: string;
  thread_id: string;
  started_at: string;
  employee_id: string | null;
  employee_name: string | null;
  usage_json: string;
  runtime_context_json: string | null;
}

interface Usage {
  input?: number;
  output?: number;
  cacheRead?: number;
  cacheWrite?: number;
  cost?: number;
}

function emptyRunCost(): RunCost {
  return {
    tokens: 0,
    monthlyTokens: 0,
    sessionTokens: 0,
    costLabel: '$0.00',
    live: false,
    breakdown: [],
    alerts: [],
  };
}

export async function loadRunCost(
  companyId: string | null = null,
  threadId: string | null = null,
): Promise<RunCost> {
  const empty = emptyRunCost();
  if (!isTauriRuntime() || !companyId) return empty;
  try {
    const db = await getTauriDb();
    return await loadRunCostFromDatabase(db, companyId, threadId);
  } catch {
    // A missing/renamed table or column should degrade to a non-live zero cost,
    // not surface as a hard query error in the cost UI.
    return empty;
  }
}

/** Database-backed seam used by the deterministic scope harness. */
export async function loadRunCostFromDatabase(
  db: RunCostDatabase,
  companyId: string,
  threadId: string | null,
  now = new Date(),
): Promise<RunCost> {
  const monthStart = new Date(now);
  monthStart.setDate(1);
  monthStart.setHours(0, 0, 0, 0);
  const monthStartIso = monthStart.toISOString();
  const [rows, sessionRows] = await Promise.all([
    db.select<RunCostRow[]>(
      `SELECT ar.run_id, ar.root_run_id, ar.thread_id, ar.started_at,
              ar.employee_id, e.name AS employee_name, ar.usage_json, ar.runtime_context_json
         FROM agent_runs ar
         LEFT JOIN employees e ON e.employee_id = ar.employee_id
        WHERE ar.company_id = $1
          AND ar.started_at >= $2
          AND ar.usage_json IS NOT NULL
          AND json_valid(ar.usage_json)`,
      [companyId, monthStartIso],
    ),
    threadId
      ? db.select<Array<{ session_tokens: number | null }>>(
          `SELECT SUM(
                    COALESCE(CAST(json_extract(usage_json, '$.input') AS REAL), 0) +
                    COALESCE(CAST(json_extract(usage_json, '$.output') AS REAL), 0) +
                    COALESCE(CAST(json_extract(usage_json, '$.cacheRead') AS REAL), 0) +
                    COALESCE(CAST(json_extract(usage_json, '$.cacheWrite') AS REAL), 0)
                  ) AS session_tokens
             FROM agent_runs
            WHERE company_id = $1
              AND thread_id = $2
              AND run_id = root_run_id
              AND usage_json IS NOT NULL
              AND json_valid(usage_json)`,
          [companyId, threadId],
        )
      : Promise.resolve([]),
  ]);
  let input = 0;
  let output = 0;
  let cacheRead = 0;
  let cacheWrite = 0;
  let cost = 0;
  const parsedRows = rows.flatMap((row) => {
    try {
      const u = JSON.parse(row.usage_json) as Usage;
      return [{ ...row, usage: u }];
    } catch {
      return [];
    }
  });
  const roots: typeof parsedRows = [];
  const childrenByRoot = new Map<string, typeof parsedRows>();
  for (const row of parsedRows) {
    if (row.run_id === row.root_run_id) {
      roots.push(row);
      continue;
    }
    const children = childrenByRoot.get(row.root_run_id) ?? [];
    children.push(row);
    childrenByRoot.set(row.root_run_id, children);
  }
  for (const row of roots) {
    input += row.usage.input ?? 0;
    output += row.usage.output ?? 0;
    cacheRead += row.usage.cacheRead ?? 0;
    cacheWrite += row.usage.cacheWrite ?? 0;
    cost += row.usage.cost ?? 0;
  }
  const tokens = input + output + cacheRead + cacheWrite;
  const sessionTokens = Number(sessionRows[0]?.session_tokens ?? 0);
  // Tokens flowed but cost is zero → the lane didn't report a price (e.g. the
  // compat default provider where cost is 0). Surface that honestly rather than
  // claiming a free run. With no tokens at all, '$0.00' is the correct label.
  const costLabel = tokens > 0 && cost === 0 ? 'Cost unavailable' : formatCostLabel(cost);
  const groups = new Map<string, RunCostBreakdown & { cost: number }>();
  const add = (employeeId: string | null, employeeName: string, model: string, usage: Usage) => {
    const rowTokens =
      (usage.input ?? 0) + (usage.output ?? 0) + (usage.cacheRead ?? 0) + (usage.cacheWrite ?? 0);
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
  for (const children of childrenByRoot.values()) {
    for (const child of children) {
      add(
        child.employee_id,
        child.employee_name ?? 'Employee',
        contextModel(child.runtime_context_json, 'Inherited conversation model'),
        child.usage,
      );
    }
  }
  for (const root of roots) {
    const descendants = childrenByRoot.get(root.run_id) ?? [];
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
  return {
    tokens,
    monthlyTokens: tokens,
    sessionTokens,
    costLabel,
    live: roots.length > 0,
    breakdown,
    alerts: [],
  };
}
