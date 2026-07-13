import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import Database from 'better-sqlite3';
import { loadRunCostFromDatabase } from '../apps/desktop/renderer/src/data/run-cost.js';
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
    started_at TEXT NOT NULL
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
const oldUsage = JSON.stringify({ input: 1, output: 1 });
const seed = db.transaction(() => {
  for (let index = 0; index < 5_000; index += 1) {
    const id = `old-${index}`;
    insert.run(
      id,
      id,
      `old-thread-${index}`,
      'co',
      null,
      oldUsage,
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
    JSON.stringify({ input: 7 }),
    null,
    '2025-01-01T00:00:00.000Z',
  );
  insert.run(
    'current-root',
    'current-root',
    'selected',
    'co',
    null,
    JSON.stringify({ input: 100, cost: 1 }),
    JSON.stringify({ model: 'pi-model' }),
    '2026-07-10T00:00:00.000Z',
  );
  insert.run(
    'current-child',
    'current-root',
    'selected',
    'co',
    null,
    JSON.stringify({ input: 30, cost: 0.3 }),
    JSON.stringify({ model: 'child-model' }),
    '2026-07-10T00:00:01.000Z',
  );
});
seed();

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
assert.ok(runCostHookSource.includes("queryKey: ['run-cost', companyId]"));
assert.ok(
  !runCostHookSource.includes('refetchInterval'),
  'run cost must not use unconditional polling',
);

assert.equal(resultSizes[0], 2, 'monthly detail query must not return historical rows');
assert.equal(resultSizes[1], 1, 'session history must be aggregated to one SQL row');
assert.equal(result.monthlyTokens, 100, 'monthly total reads rolled-up roots only');
assert.equal(result.sessionTokens, 107, 'session aggregate includes old and current root usage');
assert.deepEqual(
  result.breakdown.map((row) => [row.model, row.tokens]),
  [
    ['pi-model', 70],
    ['child-model', 30],
  ],
);

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
  '[harness-run-cost-scope] ok — 5,001 historical rows stay outside monthly transfer; session history returns one aggregate row',
);
