import assert from 'node:assert/strict';
import Database from 'better-sqlite3';
import { loadAiAccountUsageFromDatabase } from '../apps/desktop/renderer/src/data/ai-account-usage.js';

// The fixture's month-boundary rows and `now` are intentionally AEST. Pin the
// isolated harness process so a developer in another local timezone cannot
// move the June 30 boundary into July and manufacture an extra usage row.
process.env.TZ = 'Australia/Sydney';

const db = new Database(':memory:');
db.exec(`
  CREATE TABLE agent_runs (
    run_id TEXT PRIMARY KEY,
    root_run_id TEXT NOT NULL,
    usage_json TEXT,
    started_at TEXT NOT NULL,
    finished_at TEXT
  );
`);

const insert = db.prepare(`
  INSERT INTO agent_runs (run_id, root_run_id, usage_json, started_at, finished_at)
  VALUES (?, ?, ?, ?, ?)
`);
const capturedAt = '2026-07-14T13:00:00.000Z';
const actualCost = (amountUsd: number) => ({
  kind: 'actual' as const,
  amountUsd,
  source: 'provider',
  capturedAt,
});
const estimateCost = (amountUsd: number) => ({
  kind: 'estimate' as const,
  amountUsd,
  sourceUrl: 'https://provider.example/models/exact-model',
  checkedAt: capturedAt,
});
const apiUsage = ({
  accountId,
  input,
  output,
  cacheRead,
  cacheWrite,
  reasoning,
  cost,
}: {
  accountId: string;
  input?: number;
  output?: number;
  cacheRead?: number;
  cacheWrite?: number;
  reasoning?: number;
  cost:
    | ReturnType<typeof actualCost>
    | ReturnType<typeof estimateCost>
    | { kind: 'unavailable'; reason: string; knownAmountUsd?: number };
}) => ({
  scope: {
    kind: 'api-run' as const,
    engineId: 'api',
    accountId,
    modelId: 'provider/exact-model',
  },
  ...(input === undefined ? {} : { input }),
  ...(output === undefined ? {} : { output }),
  ...(cacheRead === undefined ? {} : { cacheRead }),
  ...(cacheWrite === undefined ? {} : { cacheWrite }),
  ...(reasoning === undefined ? {} : { reasoning }),
  inputAccounting: 'excludes-cache' as const,
  outputAccounting: 'includes-reasoning' as const,
  usageSource: { kind: 'provider' as const, capturedAt },
  cost,
});
const subscriptionUsage = {
  ...apiUsage({ accountId: 'subscription:ignored', input: 900, cost: actualCost(9) }),
  scope: {
    kind: 'subscription-run-diagnostic' as const,
    engineId: 'codex',
    accountId: 'subscription:ignored',
    modelId: 'gpt-exact',
  },
};
const aggregateUsage = (
  contributions: Array<{
    runId: string;
    usage: ReturnType<typeof apiUsage> | typeof subscriptionUsage;
  }>,
) => ({
  scope: { kind: 'task-aggregate' as const },
  contributions,
});

insert.run(
  'direct-a',
  'direct-a',
  JSON.stringify(
    apiUsage({
      accountId: 'api:a',
      input: 10,
      output: 2,
      cacheRead: 4,
      reasoning: 1,
      cost: actualCost(0.1),
    }),
  ),
  '2026-07-10T00:00:00.000Z',
  '2026-07-10T00:01:00.000Z',
);
insert.run(
  'aggregate-root',
  'aggregate-root',
  JSON.stringify(
    aggregateUsage([
      {
        runId: 'aggregate-root',
        usage: apiUsage({
          accountId: 'api:a',
          input: 5,
          output: 3,
          cacheRead: 1,
          cacheWrite: 2,
          cost: estimateCost(0.05),
        }),
      },
      {
        runId: 'aggregate-child-b',
        usage: apiUsage({
          accountId: 'api:b',
          output: 8,
          cacheRead: 0,
          cacheWrite: 0,
          reasoning: 2,
          cost: {
            kind: 'unavailable',
            reason: 'Provider did not publish a rate.',
            knownAmountUsd: 0.02,
          },
        }),
      },
      { runId: 'subscription-child', usage: subscriptionUsage },
    ]),
  ),
  '2026-07-11T00:00:00.000Z',
  '2026-07-11T00:02:00.000Z',
);

// This persisted child mirrors an aggregate contribution and must not be counted twice.
insert.run(
  'aggregate-child-b',
  'aggregate-root',
  JSON.stringify(apiUsage({ accountId: 'api:b', input: 999, output: 999, cost: actualCost(99) })),
  '2026-07-11T00:00:01.000Z',
  '2026-07-11T00:02:00.000Z',
);
insert.run(
  'old-root',
  'old-root',
  JSON.stringify(apiUsage({ accountId: 'api:a', input: 777, cost: actualCost(7) })),
  '2026-06-15T00:00:00.000Z',
  '2026-06-15T00:00:00.000Z',
);
insert.run(
  'next-root',
  'next-root',
  JSON.stringify(apiUsage({ accountId: 'api:a', input: 888, cost: actualCost(8) })),
  '2026-08-15T00:00:00.000Z',
  '2026-08-15T00:00:00.000Z',
);
insert.run(
  'subscription-root',
  'subscription-root',
  JSON.stringify(subscriptionUsage),
  '2026-07-12T00:00:00.000Z',
  '2026-07-12T00:01:00.000Z',
);
insert.run('invalid-root', 'invalid-root', '{broken', '2026-07-12T00:00:00.000Z', null);

const database = {
  select: async <T,>(query: string, bindValues: readonly unknown[] = []): Promise<T> =>
    db.prepare(query.replace(/\$\d+/g, '?')).all(...bindValues) as T,
};
const now = new Date('2026-07-14T23:00:00+10:00');
const snapshots = await loadAiAccountUsageFromDatabase(database, now);

assert.deepEqual(snapshots, [
  {
    accountId: 'api:a',
    usage: {
      kind: 'api',
      inputTokens: 15,
      outputTokens: 5,
      cacheReadTokens: 5,
      updatedAt: capturedAt,
      periodLabel: 'This month',
      runCount: 2,
    },
    cost: {
      kind: 'estimate',
      amountUsd: 0.15,
      updatedAt: capturedAt,
    },
  },
  {
    accountId: 'api:b',
    usage: {
      kind: 'api',
      outputTokens: 8,
      cacheReadTokens: 0,
      cacheWriteTokens: 0,
      reasoningTokens: 2,
      updatedAt: capturedAt,
      periodLabel: 'This month',
      runCount: 1,
    },
    cost: {
      kind: 'unavailable',
      reason: 'Provider did not publish a rate.',
      knownAmountUsd: 0.02,
      updatedAt: capturedAt,
    },
  },
]);

assert.deepEqual(
  await loadAiAccountUsageFromDatabase(database, new Date('2026-09-14T12:00:00+10:00')),
  [],
  'an account with no current-month root usage must not receive a fabricated zero snapshot',
);

console.log('✓ ai-account-usage: root-only monthly usage and cost semantics stay truthful');
