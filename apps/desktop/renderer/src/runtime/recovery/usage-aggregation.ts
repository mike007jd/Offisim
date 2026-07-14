/**
 * Shared agent-run subtree usage aggregation.
 *
 * Each host result is an exact, account-scoped AgentRunUsage. The root row keeps
 * a task aggregate with the original per-run contributions intact; this avoids
 * attributing a multi-model delegated task to the root model or flattening an
 * unavailable/estimated child cost into a fake numeric total.
 */

import type { AgentRunRow } from '@offisim/core/browser';
import type { AgentRunUsage } from '@offisim/shared-types';

interface UsageContribution {
  runId: string;
  usage: AgentRunUsage;
}

interface FieldCoverage {
  knownContributions: number;
  totalContributions: number;
}

interface AggregatedUsage {
  scope: {
    kind: 'task-aggregate';
    accounts: Array<{
      engineId: string;
      accountId: string;
      billingMode: 'api' | 'subscription';
      modelIds: string[];
    }>;
  };
  input?: number;
  output?: number;
  cacheRead?: number;
  cacheWrite?: number;
  reasoning?: number;
  turns?: number;
  inputAccounting: 'excludes-cache';
  outputAccounting: 'includes-reasoning';
  fieldCoverage: Record<
    'input' | 'output' | 'cacheRead' | 'cacheWrite' | 'reasoning' | 'turns',
    FieldCoverage
  >;
  usageSource: {
    kind: 'provider' | 'adapter';
    capturedAt: string;
    references?: string[];
  };
  cost:
    | {
        kind: 'actual';
        amountUsd: number;
        sources: string[];
        capturedAt: string;
      }
    | {
        kind: 'estimate';
        amountUsd: number;
        sourceUrls: string[];
        checkedAt: string;
      }
    | {
        kind: 'unavailable';
        reason: string;
        knownAmountUsd?: number;
        knownContributions: number;
        totalContributions: number;
      };
  contributions: UsageContribution[];
}

export interface SubtreeUsageResult {
  usage: AggregatedUsage | null;
  /** JSON to persist on the root row, or null when no run reported usage. */
  usageJson: string | null;
  /** Non-root child run ids still `running`. */
  dangling: string[];
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value);
}

function isAgentRunUsage(value: unknown): value is AgentRunUsage {
  if (!isRecord(value) || !isRecord(value.scope) || !isRecord(value.cost)) return false;
  if (value.inputAccounting !== 'excludes-cache') return false;
  if (value.outputAccounting !== 'includes-reasoning') return false;
  if (!isRecord(value.usageSource)) return false;
  const scopeKind = value.scope.kind;
  if (scopeKind !== 'api-run' && scopeKind !== 'subscription-run-diagnostic') return false;
  return (
    typeof value.scope.engineId === 'string' &&
    typeof value.scope.accountId === 'string' &&
    typeof value.scope.modelId === 'string' &&
    (value.cost.kind === 'actual' ||
      value.cost.kind === 'estimate' ||
      value.cost.kind === 'unavailable')
  );
}

function parseUsage(value: string | null): AgentRunUsage | undefined {
  if (!value) return undefined;
  try {
    const parsed: unknown = JSON.parse(value);
    return isAgentRunUsage(parsed) ? parsed : undefined;
  } catch {
    return undefined;
  }
}

function aggregateField(
  contributions: UsageContribution[],
  key: 'input' | 'output' | 'cacheRead' | 'cacheWrite' | 'reasoning' | 'turns',
): { value?: number; coverage: FieldCoverage } {
  const values = contributions
    .map(({ usage }) => usage[key])
    .filter((value): value is number => typeof value === 'number' && Number.isFinite(value));
  return {
    ...(values.length > 0 ? { value: values.reduce((sum, value) => sum + value, 0) } : {}),
    coverage: {
      knownContributions: values.length,
      totalContributions: contributions.length,
    },
  };
}

function aggregateScope(contributions: UsageContribution[]): AggregatedUsage['scope'] {
  const accounts = new Map<
    string,
    {
      engineId: string;
      accountId: string;
      billingMode: 'api' | 'subscription';
      modelIds: Set<string>;
    }
  >();
  for (const { usage } of contributions) {
    const billingMode = usage.scope.kind === 'api-run' ? 'api' : 'subscription';
    const key = `${usage.scope.engineId}\0${usage.scope.accountId}\0${billingMode}`;
    const account = accounts.get(key) ?? {
      engineId: usage.scope.engineId,
      accountId: usage.scope.accountId,
      billingMode,
      modelIds: new Set<string>(),
    };
    account.modelIds.add(usage.scope.modelId);
    accounts.set(key, account);
  }
  return {
    kind: 'task-aggregate',
    accounts: [...accounts.values()]
      .map(({ modelIds, ...account }) => ({ ...account, modelIds: [...modelIds].sort() }))
      .sort(
        (left, right) =>
          left.engineId.localeCompare(right.engineId) ||
          left.accountId.localeCompare(right.accountId) ||
          left.billingMode.localeCompare(right.billingMode),
      ),
  };
}

function aggregateCost(contributions: UsageContribution[]): AggregatedUsage['cost'] {
  const costs = contributions.map(({ usage }) => usage.cost);
  const known = costs.filter((cost) => cost.kind !== 'unavailable');
  const unavailable = costs.filter((cost) => cost.kind === 'unavailable');
  const partialKnown = unavailable
    .map((cost) => cost.knownAmountUsd)
    .filter((value): value is number => typeof value === 'number' && Number.isFinite(value));
  const knownAmountUsd =
    known.reduce((sum, cost) => sum + cost.amountUsd, 0) +
    partialKnown.reduce((sum, amount) => sum + amount, 0);
  if (unavailable.length > 0) {
    return {
      kind: 'unavailable',
      reason:
        unavailable.length === costs.length
          ? (unavailable[0]?.reason ?? 'No task run has a verified cost.')
          : 'Some task runs have no verified cost.',
      ...(known.length > 0 || partialKnown.length > 0 ? { knownAmountUsd } : {}),
      knownContributions: known.length,
      totalContributions: costs.length,
    };
  }
  const estimates = known.filter((cost) => cost.kind === 'estimate');
  if (estimates.length > 0) {
    return {
      kind: 'estimate',
      amountUsd: knownAmountUsd,
      sourceUrls: [...new Set(estimates.map((cost) => cost.sourceUrl))].sort(),
      checkedAt:
        estimates
          .map((cost) => cost.checkedAt)
          .sort()
          .at(-1) ?? '',
    };
  }
  const actual = known.filter((cost) => cost.kind === 'actual');
  return {
    kind: 'actual',
    amountUsd: knownAmountUsd,
    sources: [...new Set(actual.map((cost) => cost.source))].sort(),
    capturedAt:
      actual
        .map((cost) => cost.capturedAt)
        .sort()
        .at(-1) ?? '',
  };
}

function buildAggregate(contributions: UsageContribution[]): AggregatedUsage {
  const fields = {
    input: aggregateField(contributions, 'input'),
    output: aggregateField(contributions, 'output'),
    cacheRead: aggregateField(contributions, 'cacheRead'),
    cacheWrite: aggregateField(contributions, 'cacheWrite'),
    reasoning: aggregateField(contributions, 'reasoning'),
    turns: aggregateField(contributions, 'turns'),
  };
  const references = contributions
    .map(({ usage }) => usage.usageSource.reference)
    .filter((reference): reference is string => Boolean(reference));
  const capturedAt = contributions
    .map(({ usage }) => usage.usageSource.capturedAt)
    .sort()
    .at(-1);
  return {
    scope: aggregateScope(contributions),
    ...(fields.input.value !== undefined ? { input: fields.input.value } : {}),
    ...(fields.output.value !== undefined ? { output: fields.output.value } : {}),
    ...(fields.cacheRead.value !== undefined ? { cacheRead: fields.cacheRead.value } : {}),
    ...(fields.cacheWrite.value !== undefined ? { cacheWrite: fields.cacheWrite.value } : {}),
    ...(fields.reasoning.value !== undefined ? { reasoning: fields.reasoning.value } : {}),
    ...(fields.turns.value !== undefined ? { turns: fields.turns.value } : {}),
    inputAccounting: 'excludes-cache',
    outputAccounting: 'includes-reasoning',
    fieldCoverage: {
      input: fields.input.coverage,
      output: fields.output.coverage,
      cacheRead: fields.cacheRead.coverage,
      cacheWrite: fields.cacheWrite.coverage,
      reasoning: fields.reasoning.coverage,
      turns: fields.turns.coverage,
    },
    usageSource: {
      kind: contributions.every(({ usage }) => usage.usageSource.kind === 'provider')
        ? 'provider'
        : 'adapter',
      capturedAt: capturedAt ?? new Date(0).toISOString(),
      ...(references.length > 0 ? { references: [...new Set(references)].sort() } : {}),
    },
    cost: aggregateCost(contributions),
    contributions,
  };
}

export function aggregateSubtreeUsage(
  rows: AgentRunRow[],
  rootRunId: string,
  rootUsage?: AgentRunUsage,
): SubtreeUsageResult {
  const dangling: string[] = [];
  const contributions: UsageContribution[] = [];
  if (rootUsage && isAgentRunUsage(rootUsage)) {
    contributions.push({ runId: rootRunId, usage: rootUsage });
  }
  for (const row of rows) {
    if (row.run_id === rootRunId) continue;
    const usage = parseUsage(row.usage_json);
    if (usage) contributions.push({ runId: row.run_id, usage });
    if (row.status === 'running') dangling.push(row.run_id);
  }
  contributions.sort((left, right) => {
    if (left.runId === rootRunId) return -1;
    if (right.runId === rootRunId) return 1;
    return left.runId.localeCompare(right.runId);
  });
  const usage = contributions.length > 0 ? buildAggregate(contributions) : null;
  return {
    usage,
    usageJson: usage ? JSON.stringify(usage) : null,
    dangling,
  };
}
