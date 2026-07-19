import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import Database from 'better-sqlite3';
import { loadRunCostFromDatabase } from '../apps/desktop/renderer/src/data/run-cost.js';
import { taskAccountingPresentation } from '../apps/desktop/renderer/src/data/task-accounting-presentation.js';
import {
  RUN_COST_UPDATED_EVENT,
  persistRunCostAndNotify,
} from '../apps/desktop/renderer/src/runtime/run-cost-refresh.js';

let releasePersistence: (() => void) | null = null;
const persistenceGate = new Promise<void>((resolve) => {
  releasePersistence = resolve;
});
let refreshes = 0;
const persisted = persistRunCostAndNotify({
  persist: () => persistenceGate,
  eventSink: {
    emit: (event) => {
      assert.equal(event.type, RUN_COST_UPDATED_EVENT);
      refreshes += 1;
    },
  },
  companyId: 'co',
  threadId: 'selected',
  runId: 'current-root',
});
await Promise.resolve();
assert.equal(refreshes, 0, 'cost refresh must not publish before persistence resolves');
releasePersistence?.();
await persisted;
assert.equal(refreshes, 1, 'cost refresh must publish exactly once after persistence resolves');

const db = new Database(':memory:');
db.exec(`
  CREATE TABLE employees (employee_id TEXT PRIMARY KEY, name TEXT NOT NULL);
  CREATE TABLE agent_runs (
    run_id TEXT PRIMARY KEY,
    root_run_id TEXT NOT NULL,
    thread_id TEXT NOT NULL,
    company_id TEXT NOT NULL,
    employee_id TEXT,
    usage_json TEXT,
    runtime_context_json TEXT,
    started_at TEXT NOT NULL,
    finished_at TEXT,
    status TEXT NOT NULL DEFAULT 'completed'
  );
  CREATE INDEX idx_agent_runs_company_started ON agent_runs(company_id, started_at);
  CREATE INDEX idx_agent_runs_company_thread ON agent_runs(company_id, thread_id);
`);

const insert = db.prepare(`
  INSERT INTO agent_runs (
    run_id, root_run_id, thread_id, company_id, employee_id,
    usage_json, runtime_context_json, started_at
  ) VALUES (?, ?, ?, ?, ?, ?, ?, ?)
`);
const capturedAt = '2026-07-14T13:00:00.000Z';
const apiUsage = ({
  modelId,
  input,
  output,
  reasoning,
  cost,
}: {
  modelId: string;
  input?: number;
  output?: number;
  reasoning?: number;
  cost:
    | { kind: 'actual'; amountUsd: number; source: string; capturedAt: string }
    | { kind: 'estimate'; amountUsd: number; sourceUrl: string; checkedAt: string }
    | { kind: 'unavailable'; reason: string; knownAmountUsd?: number };
}) => ({
  scope: {
    kind: 'api-run',
    engineId: 'api',
    accountId: 'api:test:opaque',
    modelId,
  },
  ...(input !== undefined ? { input } : {}),
  output: output ?? 0,
  cacheRead: 0,
  cacheWrite: 0,
  ...(reasoning !== undefined ? { reasoning } : {}),
  turns: 1,
  inputAccounting: 'excludes-cache',
  outputAccounting: 'includes-reasoning',
  usageSource: { kind: 'provider', capturedAt },
  cost,
});
const subscriptionUsage = ({
  engineId,
  accountId,
  modelId,
  input = 0,
  output = 0,
}: {
  engineId: string;
  accountId: string;
  modelId: string;
  input?: number;
  output?: number;
}) => ({
  scope: {
    kind: 'subscription-run-diagnostic' as const,
    engineId,
    accountId,
    modelId,
  },
  input,
  output,
  cacheRead: 0,
  cacheWrite: 0,
  reasoning: 0,
  turns: 1,
  inputAccounting: 'excludes-cache' as const,
  outputAccounting: 'includes-reasoning' as const,
  usageSource: { kind: 'provider' as const, capturedAt },
  cost: { kind: 'unavailable' as const, reason: 'Subscription usage has no API cost.' },
});
type FixtureUsage = ReturnType<typeof apiUsage> | ReturnType<typeof subscriptionUsage>;
const aggregateUsage = (contributions: Array<{ runId: string; usage: FixtureUsage }>) => {
  const usageFields = ['input', 'output', 'cacheRead', 'cacheWrite', 'reasoning', 'turns'] as const;
  const fields = Object.fromEntries(
    usageFields.map((key) => {
      const values = contributions
        .map((entry) => entry.usage[key])
        .filter((value): value is number => typeof value === 'number');
      return [
        key,
        {
          value: values.reduce((sum, value) => sum + value, 0),
          knownContributions: values.length,
          totalContributions: contributions.length,
        },
      ];
    }),
  ) as Record<
    (typeof usageFields)[number],
    { value: number; knownContributions: number; totalContributions: number }
  >;
  const costs = contributions.map((entry) => entry.usage.cost);
  const amountUsd = costs.reduce(
    (sum, cost) => sum + ('amountUsd' in cost ? cost.amountUsd : (cost.knownAmountUsd ?? 0)),
    0,
  );
  const hasKnownAmount = costs.some(
    (cost) =>
      'amountUsd' in cost || ('knownAmountUsd' in cost && cost.knownAmountUsd !== undefined),
  );
  const unavailable = costs.some((cost) => cost.kind === 'unavailable');
  const estimated = costs.some((cost) => cost.kind === 'estimate');
  return {
    scope: { kind: 'task-aggregate', accounts: [] },
    ...Object.fromEntries(
      usageFields.flatMap((key) =>
        fields[key].knownContributions > 0 ? [[key, fields[key].value]] : [],
      ),
    ),
    inputAccounting: 'excludes-cache',
    outputAccounting: 'includes-reasoning',
    fieldCoverage: Object.fromEntries(
      usageFields.map((key) => [
        key,
        {
          knownContributions: fields[key].knownContributions,
          totalContributions: fields[key].totalContributions,
        },
      ]),
    ),
    usageSource: { kind: 'provider', capturedAt },
    cost: unavailable
      ? {
          kind: 'unavailable',
          reason: 'Some task runs have no verified cost.',
          ...(hasKnownAmount ? { knownAmountUsd: amountUsd } : {}),
          knownContributions: costs.filter((cost) => cost.kind !== 'unavailable').length,
          totalContributions: costs.length,
        }
      : estimated
        ? {
            kind: 'estimate',
            amountUsd,
            sourceUrls: ['https://openrouter.ai/api/v1/models'],
            checkedAt: capturedAt,
          }
        : {
            kind: 'actual',
            amountUsd,
            sources: ['provider'],
            capturedAt,
          },
    contributions,
  };
};
const oldOwn = apiUsage({
  modelId: 'old-model',
  input: 1,
  output: 1,
  cost: { kind: 'actual', amountUsd: 0, source: 'provider', capturedAt },
});
const oldUsage = JSON.stringify(aggregateUsage([{ runId: 'placeholder', usage: oldOwn }]));
const seed = db.transaction(() => {
  for (let index = 0; index < 5_000; index += 1) {
    const id = `old-${index}`;
    insert.run(
      id,
      id,
      `old-thread-${index}`,
      'co',
      null,
      oldUsage.replace('placeholder', id),
      null,
      '2025-01-01T00:00:00.000Z',
    );
  }
  insert.run(
    'selected-old',
    'selected-old',
    'selected',
    'co',
    null,
    JSON.stringify(
      aggregateUsage([
        {
          runId: 'selected-old',
          usage: apiUsage({
            modelId: 'old-model',
            input: 7,
            cost: { kind: 'actual', amountUsd: 0.07, source: 'provider', capturedAt },
          }),
        },
      ]),
    ),
    null,
    '2025-01-01T00:00:00.000Z',
  );
  insert.run(
    'current-root',
    'current-root',
    'selected',
    'co',
    null,
    JSON.stringify(
      aggregateUsage([
        {
          runId: 'current-root',
          usage: apiUsage({
            modelId: 'pi-model',
            input: 70,
            cost: { kind: 'actual', amountUsd: 0.7, source: 'provider', capturedAt },
          }),
        },
        {
          runId: 'current-child',
          usage: apiUsage({
            modelId: 'child-model',
            input: 30,
            cost: {
              kind: 'estimate',
              amountUsd: 0.3,
              sourceUrl: 'https://openrouter.ai/api/v1/models/child-model/endpoints',
              checkedAt: capturedAt,
            },
          }),
        },
      ]),
    ),
    JSON.stringify({ model: 'pi-model' }),
    '2026-07-10T00:00:00.000Z',
  );
  insert.run(
    'current-child',
    'current-root',
    'selected',
    'co',
    null,
    JSON.stringify(
      apiUsage({
        modelId: 'child-model',
        input: 30,
        cost: {
          kind: 'estimate',
          amountUsd: 0.3,
          sourceUrl: 'https://openrouter.ai/api/v1/models/child-model/endpoints',
          checkedAt: capturedAt,
        },
      }),
    ),
    JSON.stringify({ model: 'child-model' }),
    '2026-07-10T00:00:01.000Z',
  );
  insert.run(
    'future-root',
    'future-root',
    'future-thread',
    'co',
    null,
    JSON.stringify(
      aggregateUsage([
        {
          runId: 'future-root',
          usage: apiUsage({
            modelId: 'future-model',
            input: 9_999,
            cost: { kind: 'actual', amountUsd: 99, source: 'provider', capturedAt },
          }),
        },
      ]),
    ),
    null,
    '2026-08-01T00:00:00.000Z',
  );
  insert.run(
    'other-company-same-thread',
    'other-company-same-thread',
    'selected',
    'other-co',
    null,
    JSON.stringify(
      aggregateUsage([
        {
          runId: 'other-company-same-thread',
          usage: apiUsage({
            modelId: 'other-company-model',
            input: 8_888,
            cost: { kind: 'actual', amountUsd: 88, source: 'provider', capturedAt },
          }),
        },
      ]),
    ),
    null,
    '2026-07-10T00:00:00.000Z',
  );
  insert.run(
    'free-root',
    'free-root',
    'free-thread',
    'co-free',
    null,
    JSON.stringify(
      aggregateUsage([
        {
          runId: 'free-root',
          usage: apiUsage({
            modelId: 'free-model',
            input: 2,
            output: 1,
            reasoning: 1,
            cost: { kind: 'actual', amountUsd: 0, source: 'provider', capturedAt },
          }),
        },
      ]),
    ),
    JSON.stringify({ model: 'free-model' }),
    '2026-07-10T00:00:00.000Z',
  );
  insert.run(
    'unknown-root',
    'unknown-root',
    'unknown-thread',
    'co-unknown',
    null,
    JSON.stringify(
      aggregateUsage([
        {
          runId: 'unknown-root',
          usage: apiUsage({
            modelId: 'unknown-model',
            input: 2,
            cost: { kind: 'unavailable', reason: 'No verified rate.' },
          }),
        },
      ]),
    ),
    JSON.stringify({ model: 'unknown-model' }),
    '2026-07-10T00:00:00.000Z',
  );
  const partialUsage = {
    ...apiUsage({
      modelId: 'partial-model',
      input: 100,
      cost: { kind: 'actual', amountUsd: 0.2, source: 'provider', capturedAt },
    }),
    output: undefined,
    cacheRead: undefined,
    cacheWrite: undefined,
  };
  insert.run(
    'partial-root',
    'partial-root',
    'partial-thread',
    'co-partial',
    null,
    JSON.stringify(aggregateUsage([{ runId: 'partial-root', usage: partialUsage }])),
    JSON.stringify({ model: 'partial-model' }),
    '2026-07-10T00:00:00.000Z',
  );
  insert.run(
    'subscription-root',
    'subscription-root',
    'subscription-thread',
    'co-subscription',
    null,
    JSON.stringify(
      aggregateUsage([
        {
          runId: 'subscription-root',
          usage: subscriptionUsage({
            engineId: 'codex',
            accountId: 'codex:chatgpt:test',
            modelId: 'gpt-exact',
            input: 20,
            output: 2,
          }),
        },
      ]),
    ),
    JSON.stringify({ model: 'gpt-exact' }),
    '2026-07-10T00:00:00.000Z',
  );
  insert.run(
    'orchestration-no-usage-root',
    'orchestration-no-usage-root',
    'orchestration-no-usage-thread',
    'co-orchestration-no-usage',
    null,
    null,
    JSON.stringify({
      model: 'codex:gpt-5.4-mini',
      executionTarget: {
        engineId: 'codex',
        accountId: 'codex:cli:local',
        billingMode: 'subscription',
        modelId: 'gpt-5.4-mini',
      },
    }),
    '2026-07-10T00:00:00.000Z',
  );
});
seed();
db.prepare(`UPDATE agent_runs SET finished_at = ? WHERE run_id = ?`).run(
  '2026-07-10T00:01:30.000Z',
  'subscription-root',
);

const resultSizes: number[] = [];
const adapter = {
  async select<T>(query: string, bindValues: unknown[] = []): Promise<T> {
    const positional = query.replace(/\$\d+/g, '?');
    const rows = db.prepare(positional).all(...bindValues);
    resultSizes.push(rows.length);
    return rows as T;
  },
};

const result = await loadRunCostFromDatabase(
  adapter,
  'co',
  'selected',
  new Date('2026-07-13T12:00:00.000Z'),
);

const querySource = readFileSync(
  new URL('../apps/desktop/renderer/src/data/queries.ts', import.meta.url),
  'utf8',
);
const runCostHookSource = querySource.match(
  /export function useRunCost\(\)[\s\S]*?(?=\nexport function )/,
)?.[0];
assert.ok(runCostHookSource, 'useRunCost source must be present');
assert.ok(runCostHookSource.includes('runtimeEventBus.on(RUN_COST_UPDATED_EVENT'));
assert.ok(runCostHookSource.includes('queryKey: queryKeys.runCostCompany(companyId)'));
assert.ok(
  !runCostHookSource.includes('refetchInterval'),
  'run cost must not use unconditional polling',
);
assert.doesNotMatch(
  runCostHookSource,
  /agent_runtime_status|includeUsage|sessionSubscriptionUsage/u,
  'task accounting must not depend on removed provider-native subscription usage',
);

const appFrameSource = readFileSync(
  new URL('../apps/desktop/renderer/src/design-system/shell/AppFrame.tsx', import.meta.url),
  'utf8',
);
assert.doesNotMatch(appFrameSource, /useRunCost|off-topbar-cost|costLabel/u);
assert.equal(resultSizes[0], 2, 'monthly detail query must not return historical rows');
assert.equal(resultSizes[1], 2, 'session query returns only the selected thread root rows');
assert.equal(result.monthlyTokens, 100, 'monthly total reads rolled-up roots only');
assert.equal(result.monthlyTokenCoverage, 'complete');
assert.equal(result.sessionTokens, 107, 'session aggregate includes old and current root usage');
assert.equal(result.sessionTokenCoverage, 'complete');
assert.deepEqual(result.sessionAccounts, [
  { engineId: 'api', accountId: 'api:test:opaque', billingMode: 'api' },
]);
assert.equal(result.sessionCostKind, 'estimate');
assert.equal(result.sessionCostLabel, 'Estimated $1.07');
assert.equal(result.costKind, 'estimate');
assert.equal(result.costLabel, 'Estimated $1.00');
assert.deepEqual(
  result.breakdown.map((row) => [row.model, row.tokens, row.costKind, row.costLabel]),
  [
    ['pi-model', 70, 'actual', 'Actual $0.70'],
    ['child-model', 30, 'estimate', 'Estimated $0.30'],
  ],
);

const freeResult = await loadRunCostFromDatabase(
  adapter,
  'co-free',
  null,
  new Date('2026-07-13T12:00:00.000Z'),
);
assert.equal(freeResult.tokens, 3, 'reasoning is detail inside output, never counted twice');
assert.equal(freeResult.costKind, 'actual');
assert.equal(freeResult.costLabel, 'Actual $0.00', 'provider-confirmed free is not unavailable');

const unavailableResult = await loadRunCostFromDatabase(
  adapter,
  'co-unknown',
  'unknown-thread',
  new Date('2026-07-13T12:00:00.000Z'),
);
assert.equal(unavailableResult.tokens, 2);
assert.equal(unavailableResult.costKind, 'unavailable');
assert.equal(unavailableResult.costLabel, 'Cost unavailable');
assert.equal(taskAccountingPresentation(unavailableResult).secondary, 'Cost unavailable');

const partialResult = await loadRunCostFromDatabase(
  adapter,
  'co-partial',
  'partial-thread',
  new Date('2026-07-13T12:00:00.000Z'),
);
assert.equal(partialResult.monthlyTokens, null, 'partial provider fields cannot become an exact 0');
assert.equal(partialResult.monthlyKnownTokens, 100, 'known token subtotal stays visible');
assert.equal(partialResult.monthlyTokenCoverage, 'partial');
assert.equal(partialResult.sessionTokens, null);
assert.equal(partialResult.sessionKnownTokens, 100);
assert.equal(partialResult.sessionTokenCoverage, 'partial');

const apiPresentation = taskAccountingPresentation(result);
assert.equal(apiPresentation.kind, 'api');
assert.equal(apiPresentation.primary, '107 tok');
assert.equal(apiPresentation.secondary, 'Estimated $1.07');
assert.equal(apiPresentation.tone, 'neutral');

const subscriptionResult = await loadRunCostFromDatabase(
  adapter,
  'co-subscription',
  'subscription-thread',
  new Date('2026-07-13T12:00:00.000Z'),
);
assert.deepEqual(subscriptionResult.sessionAccounts, [
  { engineId: 'codex', accountId: 'codex:chatgpt:test', billingMode: 'subscription' },
]);
assert.equal(subscriptionResult.sessionTokens, 22, 'local tokens remain diagnostic only');
assert.equal(subscriptionResult.sessionDurationMs, 90_000, 'local root duration stays visible');
assert.equal(subscriptionResult.sessionCostKind, 'unavailable');
const subscriptionPresentation = taskAccountingPresentation(subscriptionResult);
assert.equal(subscriptionPresentation.kind, 'subscription');
assert.equal(subscriptionPresentation.primary, '22 tok · 1m 30s');
assert.equal(subscriptionPresentation.secondary, '订阅内 · 无 API 成本');
assert.equal(subscriptionPresentation.tone, 'neutral');
assert.doesNotMatch(JSON.stringify(subscriptionPresentation), /Usage unavailable|remaining|reset|credits|\$/u);

const orchestrationWithoutUsage = await loadRunCostFromDatabase(
  adapter,
  'co-orchestration-no-usage',
  'orchestration-no-usage-thread',
  new Date('2026-07-13T12:00:00.000Z'),
);
assert.deepEqual(orchestrationWithoutUsage.sessionAccounts, [
  {
    engineId: 'codex',
    accountId: 'codex:cli:local',
    billingMode: 'subscription',
  },
]);
assert.equal(orchestrationWithoutUsage.sessionTokens, null);
assert.equal(orchestrationWithoutUsage.sessionDurationMs, 0);
assert.equal(orchestrationWithoutUsage.sessionCostKind, 'none');

const explicitBudgetWarning = taskAccountingPresentation({
  ...subscriptionResult,
  alerts: [
    {
      scope: 'session',
      level: 'warning',
      percent: 80,
      used: 80,
      budget: 100,
      lowerBound: false,
    },
  ],
});
assert.equal(explicitBudgetWarning.tone, 'warning');
assert.equal(
  taskAccountingPresentation({
    ...result,
    alerts: [
      {
        scope: 'monthly',
        level: 'critical',
        percent: 100,
        used: 100,
        budget: 100,
        lowerBound: false,
      },
    ],
  }).tone,
  'neutral',
  'a company-month alert must not tint the selected Conversation readout',
);

const mixedPresentation = taskAccountingPresentation({
  ...result,
  sessionAccounts: [
    ...result.sessionAccounts,
    { engineId: 'codex', accountId: 'codex:chatgpt:test', billingMode: 'subscription' },
  ],
});
assert.equal(mixedPresentation.kind, 'mixed');
assert.equal(mixedPresentation.secondary, null, 'mixed lanes must never expose a fake total cost');
assert.equal(taskAccountingPresentation(undefined).primary, 'Usage loading');

const monthlyPlan = db
  .prepare(
    `EXPLAIN QUERY PLAN SELECT run_id FROM agent_runs
      WHERE company_id = ? AND started_at >= ? AND usage_json IS NOT NULL`,
  )
  .all('co', '2026-07-01T00:00:00.000Z') as Array<{ detail: string }>;
const sessionPlan = db
  .prepare(
    `EXPLAIN QUERY PLAN SELECT SUM(json_extract(usage_json, '$.input')) FROM agent_runs
      WHERE company_id = ? AND thread_id = ? AND run_id = root_run_id`,
  )
  .all('co', 'selected') as Array<{ detail: string }>;
assert.ok(monthlyPlan.some((row) => row.detail.includes('idx_agent_runs_company_started')));
assert.ok(sessionPlan.some((row) => row.detail.includes('idx_agent_runs_company_thread')));

db.close();
console.log(
  '[harness-run-cost-scope] ok — month/task/account lanes stay isolated; subscription tasks show local tokens/duration without API cost',
);
