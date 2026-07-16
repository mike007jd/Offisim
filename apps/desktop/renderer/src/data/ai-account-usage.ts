import { getTauriDb } from '@/lib/tauri-db.js';
import type { AgentRunCost, AgentRunUsage } from '@offisim/shared-types';
import { isTauriRuntime } from './adapters.js';

// `agent_runs.usage_json` root rows are the only Settings accounting source.
// Task aggregates already carry each root/child contribution, so persisted
// child rows must never be queried here or the same API use would be doubled.

export interface ApiUsageSnapshot {
  readonly kind: 'api';
  readonly inputTokens?: number;
  readonly outputTokens?: number;
  readonly cacheReadTokens?: number;
  readonly cacheWriteTokens?: number;
  readonly reasoningTokens?: number;
  readonly updatedAt?: string;
  readonly periodLabel: 'This month';
  readonly runCount: number;
}

export type AccountCostSnapshot =
  | {
      readonly kind: 'actual' | 'estimate';
      readonly amountUsd: number;
      readonly updatedAt?: string;
    }
  | {
      readonly kind: 'unavailable';
      readonly reason: string;
      readonly knownAmountUsd?: number;
      readonly updatedAt?: string;
    };

export interface AiAccountUsageSnapshot {
  readonly engineId: string;
  readonly accountId: string;
  readonly billingMode: 'api';
  readonly usage: ApiUsageSnapshot;
  readonly cost: AccountCostSnapshot;
}

interface AiAccountUsageDatabase {
  select<T>(query: string, bindValues?: readonly unknown[]): Promise<T>;
}

interface AccountUsageRow {
  usage_json: string;
}

interface TaskAggregateUsage {
  readonly scope: { readonly kind: 'task-aggregate' };
  readonly contributions: readonly { readonly runId: string; readonly usage: AgentRunUsage }[];
}

interface BucketAccumulator {
  complete: boolean;
  total: number;
}

interface AccountAccumulator {
  readonly engineId: string;
  readonly accountId: string;
  readonly input: BucketAccumulator;
  readonly output: BucketAccumulator;
  readonly cacheRead: BucketAccumulator;
  readonly cacheWrite: BucketAccumulator;
  readonly reasoning: BucketAccumulator;
  readonly costs: AgentRunCost[];
  runCount: number;
  updatedAt?: string;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value);
}

function isFiniteNonNegative(value: unknown): value is number {
  return typeof value === 'number' && Number.isFinite(value) && value >= 0;
}

function hasValidOptionalCount(value: Record<string, unknown>, key: string): boolean {
  return value[key] === undefined || isFiniteNonNegative(value[key]);
}

function isAgentRunCost(value: unknown): value is AgentRunCost {
  if (!isRecord(value) || typeof value.kind !== 'string') return false;
  if (value.kind === 'actual') {
    return (
      isFiniteNonNegative(value.amountUsd) &&
      typeof value.source === 'string' &&
      typeof value.capturedAt === 'string'
    );
  }
  if (value.kind === 'estimate') {
    return (
      isFiniteNonNegative(value.amountUsd) &&
      typeof value.sourceUrl === 'string' &&
      typeof value.checkedAt === 'string'
    );
  }
  return (
    value.kind === 'unavailable' &&
    typeof value.reason === 'string' &&
    (value.knownAmountUsd === undefined || isFiniteNonNegative(value.knownAmountUsd))
  );
}

function isAgentRunUsage(value: unknown): value is AgentRunUsage {
  if (!isRecord(value) || !isRecord(value.scope) || !isRecord(value.usageSource)) return false;
  const scope = value.scope;
  if (scope.kind !== 'api-run' && scope.kind !== 'subscription-run-diagnostic') return false;
  return (
    typeof scope.accountId === 'string' &&
    scope.accountId.length > 0 &&
    typeof scope.engineId === 'string' &&
    typeof scope.modelId === 'string' &&
    hasValidOptionalCount(value, 'input') &&
    hasValidOptionalCount(value, 'output') &&
    hasValidOptionalCount(value, 'cacheRead') &&
    hasValidOptionalCount(value, 'cacheWrite') &&
    hasValidOptionalCount(value, 'reasoning') &&
    value.inputAccounting === 'excludes-cache' &&
    value.outputAccounting === 'includes-reasoning' &&
    (value.usageSource.kind === 'provider' || value.usageSource.kind === 'adapter') &&
    typeof value.usageSource.capturedAt === 'string' &&
    isAgentRunCost(value.cost)
  );
}

function parseRootContributions(value: string): readonly AgentRunUsage[] | undefined {
  try {
    const parsed: unknown = JSON.parse(value);
    if (isAgentRunUsage(parsed)) return [parsed];
    if (
      isRecord(parsed) &&
      isRecord(parsed.scope) &&
      parsed.scope.kind === 'task-aggregate' &&
      Array.isArray(parsed.contributions) &&
      parsed.contributions.every(
        (entry) =>
          isRecord(entry) && typeof entry.runId === 'string' && isAgentRunUsage(entry.usage),
      )
    ) {
      return (parsed as unknown as TaskAggregateUsage).contributions.map((entry) => entry.usage);
    }
  } catch {
    // Invalid prelaunch rows stay absent instead of becoming fabricated zeroes.
  }
  return undefined;
}

function emptyBucket(): BucketAccumulator {
  return { complete: true, total: 0 };
}

function addBucket(bucket: BucketAccumulator, value: number | undefined): void {
  if (value === undefined) {
    bucket.complete = false;
    return;
  }
  bucket.total += value;
}

function laterTimestamp(current: string | undefined, candidate: string | undefined) {
  if (!candidate) return current;
  if (!current) return candidate;
  const currentTime = Date.parse(current);
  const candidateTime = Date.parse(candidate);
  if (!Number.isFinite(candidateTime)) return current;
  if (!Number.isFinite(currentTime)) return candidate;
  return candidateTime > currentTime ? candidate : current;
}

function costTimestamp(cost: AgentRunCost): string | undefined {
  if (cost.kind === 'actual') return cost.capturedAt;
  if (cost.kind === 'estimate') return cost.checkedAt;
  return undefined;
}

function normalizedUsd(value: number): number {
  return Math.round(value * 1_000_000_000_000) / 1_000_000_000_000;
}

function summarizeCosts(costs: readonly AgentRunCost[], updatedAt?: string): AccountCostSnapshot {
  const unavailable = costs.filter(
    (cost): cost is Extract<AgentRunCost, { kind: 'unavailable' }> => cost.kind === 'unavailable',
  );
  const knownAmountUsd = normalizedUsd(
    costs.reduce((total, cost) => {
      if (cost.kind === 'unavailable') return total + (cost.knownAmountUsd ?? 0);
      return total + cost.amountUsd;
    }, 0),
  );
  if (unavailable.length > 0) {
    const reasons = [...new Set(unavailable.map((cost) => cost.reason.trim()).filter(Boolean))];
    const hasKnownAmount = costs.some(
      (cost) => cost.kind !== 'unavailable' || cost.knownAmountUsd !== undefined,
    );
    return {
      kind: 'unavailable',
      reason: reasons.join(' ') || 'Provider cost was unavailable.',
      ...(hasKnownAmount ? { knownAmountUsd } : {}),
      ...(updatedAt ? { updatedAt } : {}),
    };
  }
  return {
    kind: costs.some((cost) => cost.kind === 'estimate') ? 'estimate' : 'actual',
    amountUsd: knownAmountUsd,
    ...(updatedAt ? { updatedAt } : {}),
  };
}

function bucketValue(bucket: BucketAccumulator): number | undefined {
  return bucket.complete ? bucket.total : undefined;
}

function monthWindow(now: Date): readonly [string, string] {
  const start = new Date(now);
  start.setDate(1);
  start.setHours(0, 0, 0, 0);
  const end = new Date(start);
  end.setMonth(end.getMonth() + 1);
  return [start.toISOString(), end.toISOString()];
}

export async function loadAiAccountUsage(): Promise<readonly AiAccountUsageSnapshot[]> {
  if (!isTauriRuntime()) return [];
  return loadAiAccountUsageFromDatabase(await getTauriDb());
}

/** Database-backed seam used by the deterministic accounting harness. */
export async function loadAiAccountUsageFromDatabase(
  db: AiAccountUsageDatabase,
  now = new Date(),
): Promise<readonly AiAccountUsageSnapshot[]> {
  const [monthStart, nextMonthStart] = monthWindow(now);
  const rows = await db.select<AccountUsageRow[]>(
    `SELECT usage_json
       FROM agent_runs
      WHERE run_id = root_run_id
        AND started_at >= $1
        AND started_at < $2
        AND usage_json IS NOT NULL
        AND json_valid(usage_json)`,
    [monthStart, nextMonthStart],
  );
  const accounts = new Map<string, AccountAccumulator>();

  for (const row of rows) {
    const contributions = parseRootContributions(row.usage_json);
    if (!contributions) continue;
    for (const usage of contributions) {
      if (usage.scope.kind !== 'api-run') continue;
      const laneKey = `${usage.scope.engineId}\0${usage.scope.accountId}\0api`;
      const account = accounts.get(laneKey) ?? {
        engineId: usage.scope.engineId,
        accountId: usage.scope.accountId,
        input: emptyBucket(),
        output: emptyBucket(),
        cacheRead: emptyBucket(),
        cacheWrite: emptyBucket(),
        reasoning: emptyBucket(),
        costs: [],
        runCount: 0,
      };
      addBucket(account.input, usage.input);
      addBucket(account.output, usage.output);
      addBucket(account.cacheRead, usage.cacheRead);
      addBucket(account.cacheWrite, usage.cacheWrite);
      addBucket(account.reasoning, usage.reasoning);
      account.costs.push(usage.cost);
      account.runCount += 1;
      account.updatedAt = laterTimestamp(account.updatedAt, usage.usageSource.capturedAt);
      account.updatedAt = laterTimestamp(account.updatedAt, costTimestamp(usage.cost));
      accounts.set(laneKey, account);
    }
  }

  return [...accounts.values()]
    .sort(
      (left, right) =>
        left.engineId.localeCompare(right.engineId) ||
        left.accountId.localeCompare(right.accountId),
    )
    .map((account) => {
      const inputTokens = bucketValue(account.input);
      const outputTokens = bucketValue(account.output);
      const cacheReadTokens = bucketValue(account.cacheRead);
      const cacheWriteTokens = bucketValue(account.cacheWrite);
      const reasoningTokens = bucketValue(account.reasoning);
      return {
        engineId: account.engineId,
        accountId: account.accountId,
        billingMode: 'api' as const,
        usage: {
          kind: 'api' as const,
          ...(inputTokens === undefined ? {} : { inputTokens }),
          ...(outputTokens === undefined ? {} : { outputTokens }),
          ...(cacheReadTokens === undefined ? {} : { cacheReadTokens }),
          ...(cacheWriteTokens === undefined ? {} : { cacheWriteTokens }),
          ...(reasoningTokens === undefined ? {} : { reasoningTokens }),
          ...(account.updatedAt ? { updatedAt: account.updatedAt } : {}),
          periodLabel: 'This month' as const,
          runCount: account.runCount,
        },
        cost: summarizeCosts(account.costs, account.updatedAt),
      };
    });
}
