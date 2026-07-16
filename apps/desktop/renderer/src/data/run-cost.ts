import { getTauriDb } from '@/lib/tauri-db.js';
import type { AgentRunCost, AgentRunUsage } from '@offisim/shared-types';
import { isTauriRuntime } from './adapters.js';
import type { RunAccountingAccount, RunCost, RunCostBreakdown } from './types.js';
import {
  type UsageTokenSummary,
  combineUsageTokenSummaries,
  exactUsageTokens,
  summarizeUsageTokens,
} from './usage-token-coverage.js';

// `agent_runs.usage_json` is the only run accounting source. Root rows carry a
// task aggregate with exact per-run contributions; child rows carry their own
// account-scoped usage. No token rate is inferred in the renderer.

type CostKind = RunCost['costKind'];

interface AggregateCostActual {
  kind: 'actual';
  amountUsd: number;
}

interface AggregateCostEstimate {
  kind: 'estimate';
  amountUsd: number;
}

interface AggregateCostUnavailable {
  kind: 'unavailable';
  reason: string;
  knownAmountUsd?: number;
}

type CostRecord =
  | AgentRunCost
  | AggregateCostActual
  | AggregateCostEstimate
  | AggregateCostUnavailable;

interface TaskAggregateUsage {
  scope: { kind: 'task-aggregate' };
  input?: number;
  output?: number;
  cacheRead?: number;
  cacheWrite?: number;
  reasoning?: number;
  turns?: number;
  cost: CostRecord;
  contributions: Array<{ runId: string; usage: AgentRunUsage }>;
}

type UsageRecord = AgentRunUsage | TaskAggregateUsage;

interface RunCostDatabase {
  select<T>(query: string, bindValues?: unknown[]): Promise<T>;
}

interface RunCostRow {
  run_id: string;
  root_run_id: string;
  thread_id: string;
  started_at: string;
  finished_at: string | null;
  status: string;
  employee_id: string | null;
  employee_name: string | null;
  usage_json: string;
  runtime_context_json: string | null;
}

interface CostSummary {
  kind: Exclude<CostKind, 'none'>;
  amountUsd?: number;
  knownAmountUsd?: number;
}

function finiteNonNegative(value: unknown): number | undefined {
  return typeof value === 'number' && Number.isFinite(value) && value >= 0 ? value : undefined;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value);
}

function isAgentUsage(value: unknown): value is AgentRunUsage {
  return (
    isRecord(value) &&
    isRecord(value.scope) &&
    (value.scope.kind === 'api-run' || value.scope.kind === 'subscription-run-diagnostic') &&
    isRecord(value.cost) &&
    (value.cost.kind === 'actual' ||
      value.cost.kind === 'estimate' ||
      value.cost.kind === 'unavailable')
  );
}

function isTaskAggregateUsage(value: UsageRecord): value is TaskAggregateUsage {
  return value.scope.kind === 'task-aggregate';
}

function parseUsage(value: string): UsageRecord | undefined {
  try {
    const parsed: unknown = JSON.parse(value);
    if (isAgentUsage(parsed)) return parsed;
    if (
      isRecord(parsed) &&
      isRecord(parsed.scope) &&
      parsed.scope.kind === 'task-aggregate' &&
      isRecord(parsed.cost) &&
      Array.isArray(parsed.contributions) &&
      parsed.contributions.every(
        (entry) => isRecord(entry) && typeof entry.runId === 'string' && isAgentUsage(entry.usage),
      )
    ) {
      return parsed as unknown as TaskAggregateUsage;
    }
  } catch {
    // Invalid prelaunch rows are ignored instead of becoming a fabricated zero.
  }
  return undefined;
}

function tokenCount(usage: UsageRecord): UsageTokenSummary {
  return summarizeUsageTokens(usage);
}

function accountingAccounts(usages: readonly UsageRecord[]): RunAccountingAccount[] {
  const accounts = new Map<string, RunAccountingAccount>();
  for (const usage of usages) {
    const contributions = isTaskAggregateUsage(usage)
      ? usage.contributions.map((entry) => entry.usage)
      : [usage];
    for (const contribution of contributions) {
      const billingMode =
        contribution.scope.kind === 'subscription-run-diagnostic' ? 'subscription' : 'api';
      const account = {
        engineId: contribution.scope.engineId,
        accountId: contribution.scope.accountId,
        billingMode,
      } satisfies RunAccountingAccount;
      accounts.set(`${account.engineId}\0${account.accountId}\0${account.billingMode}`, account);
    }
  }
  return [...accounts.values()].sort(
    (left, right) =>
      left.engineId.localeCompare(right.engineId) ||
      left.accountId.localeCompare(right.accountId) ||
      left.billingMode.localeCompare(right.billingMode),
  );
}

function summarizeCosts(costs: CostRecord[]): CostSummary | undefined {
  if (costs.length === 0) return undefined;
  const unavailable = costs.filter((cost) => cost.kind === 'unavailable');
  const known = costs.filter((cost) => cost.kind !== 'unavailable');
  const partialKnown = unavailable
    .map((cost) => finiteNonNegative(cost.knownAmountUsd))
    .filter((amount): amount is number => amount !== undefined);
  const knownAmountUsd =
    known.reduce((sum, cost) => sum + (finiteNonNegative(cost.amountUsd) ?? 0), 0) +
    partialKnown.reduce((sum, amount) => sum + amount, 0);
  if (unavailable.length > 0) {
    return {
      kind: 'unavailable',
      ...(known.length > 0 || partialKnown.length > 0 ? { knownAmountUsd } : {}),
    };
  }
  return {
    kind: known.some((cost) => cost.kind === 'estimate') ? 'estimate' : 'actual',
    amountUsd: knownAmountUsd,
  };
}

function formatAmount(amount: number): string {
  if (amount > 0 && amount < 0.01) return `$${amount.toFixed(4)}`;
  return `$${amount.toFixed(2)}`;
}

function formatCostLabel(cost: CostSummary | undefined): string {
  if (!cost) return 'No API usage';
  if (cost.kind === 'actual') return `Actual ${formatAmount(cost.amountUsd ?? 0)}`;
  if (cost.kind === 'estimate') return `Estimated ${formatAmount(cost.amountUsd ?? 0)}`;
  return cost.knownAmountUsd === undefined
    ? 'Cost unavailable'
    : `Cost unavailable · ${formatAmount(cost.knownAmountUsd)} known`;
}

function emptyRunCost(): RunCost {
  return {
    tokens: null,
    knownTokens: 0,
    tokenCoverage: 'unavailable',
    monthlyTokens: null,
    monthlyKnownTokens: 0,
    monthlyTokenCoverage: 'unavailable',
    sessionTokens: null,
    sessionKnownTokens: 0,
    sessionTokenCoverage: 'unavailable',
    sessionDurationMs: 0,
    sessionAccounts: [],
    sessionCostKind: 'none',
    sessionCostLabel: 'No task usage',
    costKind: 'none',
    costLabel: 'No API usage',
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
  const nextMonthStart = new Date(monthStart);
  nextMonthStart.setMonth(nextMonthStart.getMonth() + 1);
  const monthStartIso = monthStart.toISOString();
  const nextMonthStartIso = nextMonthStart.toISOString();
  const [rows, sessionRows] = await Promise.all([
    db.select<RunCostRow[]>(
      `SELECT ar.run_id, ar.root_run_id, ar.thread_id, ar.started_at,
              ar.employee_id, e.name AS employee_name, ar.usage_json, ar.runtime_context_json
         FROM agent_runs ar
         LEFT JOIN employees e ON e.employee_id = ar.employee_id
        WHERE ar.company_id = $1
          AND ar.started_at >= $2
          AND ar.started_at < $3
          AND ar.usage_json IS NOT NULL
          AND json_valid(ar.usage_json)`,
      [companyId, monthStartIso, nextMonthStartIso],
    ),
    threadId
      ? db.select<RunCostRow[]>(
          `SELECT run_id, root_run_id, thread_id, started_at, finished_at, status,
                  employee_id, NULL AS employee_name, usage_json, runtime_context_json
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

  const parsedRows = rows.flatMap((row) => {
    const usage = parseUsage(row.usage_json);
    return usage ? [{ ...row, usage }] : [];
  });
  const roots = parsedRows.filter((row) => row.run_id === row.root_run_id);
  const children = parsedRows.filter((row) => row.run_id !== row.root_run_id);
  const monthlyTokenSummary = combineUsageTokenSummaries(roots.map((row) => tokenCount(row.usage)));
  const sessionUsages = sessionRows.flatMap((row) => {
    const usage = parseUsage(row.usage_json);
    return usage ? [usage] : [];
  });
  const nowMs = now.getTime();
  const sessionDurationMs = sessionRows.reduce((total, row) => {
    const startedAt = Date.parse(row.started_at);
    const persistedFinishedAt = row.finished_at ? Date.parse(row.finished_at) : Number.NaN;
    const finishedAt = Number.isFinite(persistedFinishedAt)
      ? persistedFinishedAt
      : row.status === 'running'
        ? nowMs
        : startedAt;
    return total + (Number.isFinite(startedAt) ? Math.max(0, finishedAt - startedAt) : 0);
  }, 0);
  const sessionTokenSummary = combineUsageTokenSummaries(sessionUsages.map(tokenCount));
  const monthlyCost = summarizeCosts(roots.map((row) => row.usage.cost));
  const sessionCost = summarizeCosts(sessionUsages.map((usage) => usage.cost));

  type MutableBreakdown = Omit<RunCostBreakdown, 'tokens' | 'knownTokens' | 'tokenCoverage'> & {
    costs: CostRecord[];
    tokenSummaries: UsageTokenSummary[];
  };
  const groups = new Map<string, MutableBreakdown>();
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
  const usageModel = (usage: AgentRunUsage, fallback: string) => usage.scope.modelId || fallback;
  const add = (
    employeeId: string | null,
    employeeName: string,
    model: string,
    usage: AgentRunUsage,
  ) => {
    const key = `${employeeId ?? 'root'}\0${model}`;
    const current = groups.get(key) ?? {
      employeeId,
      employeeName,
      model,
      costKind: 'unavailable' as const,
      costLabel: 'Cost unavailable',
      costs: [],
      tokenSummaries: [],
    };
    current.tokenSummaries.push(tokenCount(usage));
    current.costs.push(usage.cost);
    groups.set(key, current);
  };

  for (const child of children) {
    if (!isAgentUsage(child.usage)) continue;
    add(
      child.employee_id,
      child.employee_name ?? 'Employee',
      contextModel(child.runtime_context_json, usageModel(child.usage, 'Conversation model')),
      child.usage,
    );
  }
  for (const root of roots) {
    const ownUsage = isTaskAggregateUsage(root.usage)
      ? root.usage.contributions.find((entry) => entry.runId === root.run_id)?.usage
      : root.usage;
    if (!ownUsage) continue;
    add(
      root.employee_id,
      root.employee_name ?? 'Lead agent',
      contextModel(root.runtime_context_json, usageModel(ownUsage, 'Conversation model')),
      ownUsage,
    );
  }

  const breakdown = [...groups.values()]
    .map(({ costs, tokenSummaries, ...group }) => {
      const cost = summarizeCosts(costs) ?? { kind: 'unavailable' as const };
      const tokens = combineUsageTokenSummaries(tokenSummaries);
      return {
        ...group,
        tokens: exactUsageTokens(tokens),
        knownTokens: tokens.knownTokens,
        tokenCoverage: tokens.coverage,
        costKind: cost.kind,
        costLabel: formatCostLabel(cost),
      };
    })
    .sort(
      (left, right) =>
        right.knownTokens - left.knownTokens || left.employeeName.localeCompare(right.employeeName),
    );
  const costKind = monthlyCost?.kind ?? 'none';
  return {
    tokens: exactUsageTokens(monthlyTokenSummary),
    knownTokens: monthlyTokenSummary.knownTokens,
    tokenCoverage: monthlyTokenSummary.coverage,
    monthlyTokens: exactUsageTokens(monthlyTokenSummary),
    monthlyKnownTokens: monthlyTokenSummary.knownTokens,
    monthlyTokenCoverage: monthlyTokenSummary.coverage,
    sessionTokens: exactUsageTokens(sessionTokenSummary),
    sessionKnownTokens: sessionTokenSummary.knownTokens,
    sessionTokenCoverage: sessionTokenSummary.coverage,
    sessionDurationMs,
    sessionAccounts: accountingAccounts(sessionUsages),
    sessionCostKind: sessionCost?.kind ?? 'none',
    sessionCostLabel: formatCostLabel(sessionCost),
    costKind,
    costLabel: formatCostLabel(monthlyCost),
    live: roots.length > 0,
    breakdown,
    alerts: [],
  };
}
