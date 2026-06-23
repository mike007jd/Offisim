// W0-C — Repository contract-test harness (GPT-5.5 audit remediation, Wave 0).
//
// Runs the SAME storage-consistency assertions against BOTH SQLite repo backends:
//   - better-sqlite3 (packages/core/.../repos/workspace/drizzle.ts, sync, real txn)
//   - sqlite-proxy   (apps/desktop/renderer/.../tauri-repos/workspace.ts, async)
//
// The sqlite-proxy backend is exercised through a real in-memory better-sqlite3
// instance wired behind the same drizzle sqlite-proxy callback the renderer uses
// (minus the Tauri IPC hop), so the assertions hit the ACTUAL renderer repo SQL.
//
// Oracle: this harness FAILS on the sqlite-proxy backend until O1 fixes
// `officeLayouts.setActive` to scope the activate write by company + reject a
// foreign/non-existent layout before mutating (matching the core backend). It is
// wired into `pnpm validate` in Wave 3 once O1 lands; until then it is run
// standalone to demonstrate the drift. See Docs/contracts/storage-consistency-contracts.md.

import assert from 'node:assert/strict';
import Database from 'better-sqlite3';
import type { BetterSQLite3Database } from 'drizzle-orm/better-sqlite3';
import { drizzle as drizzleBetter } from 'drizzle-orm/better-sqlite3';
import { drizzle as drizzleProxy } from 'drizzle-orm/sqlite-proxy';
import type { TauriDrizzleDb } from '../apps/desktop/renderer/src/lib/tauri-drizzle.js';
import { createWorkspaceTauriRepos } from '../apps/desktop/renderer/src/lib/tauri-repos/workspace.js';
import { createWorkspaceDrizzleRepos } from '../packages/core/src/runtime/repos/workspace/drizzle.js';
import {
  type OfficeLayoutsContractRepo,
  runOfficeLayoutSetActiveContract,
} from './lib/audit-storage-contracts.mjs';

const IDS = { companyA: 'A', companyB: 'B', a1: 'a1', a2: 'a2', b1: 'b1' } as const;

// Fixture derived from IDS so the seeded rows and the contract ids cannot drift:
// company A has a1 (active) + a2 (inactive); company B has b1 (active).
const SEED: ReadonlyArray<readonly [layoutId: string, companyId: string, active: number]> = [
  [IDS.a1, IDS.companyA, 1],
  [IDS.a2, IDS.companyA, 0],
  [IDS.b1, IDS.companyB, 1],
];

const CREATE_OFFICE_LAYOUTS = `
CREATE TABLE office_layouts (
  layout_id   TEXT PRIMARY KEY,
  company_id  TEXT NOT NULL,
  name        TEXT NOT NULL,
  layout_json TEXT NOT NULL,
  is_active   INTEGER NOT NULL DEFAULT 0 CHECK (is_active IN (0, 1)),
  created_at  TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at  TEXT NOT NULL DEFAULT (datetime('now'))
);`;

function seed(db: Database.Database): void {
  db.exec(CREATE_OFFICE_LAYOUTS);
  const ts = '2020-01-01T00:00:00.000Z';
  const stmt = db.prepare(
    'INSERT INTO office_layouts (layout_id, company_id, name, layout_json, is_active, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?)',
  );
  for (const [layoutId, companyId, active] of SEED) {
    stmt.run(layoutId, companyId, `Layout ${layoutId}`, '{}', active, ts, ts);
  }
}

// Mirror apps/desktop/renderer/src/lib/tauri-drizzle.ts but back the proxy with an
// in-memory better-sqlite3 instead of the Tauri SQL plugin. better-sqlite3 uses `?`
// placeholders natively, so (unlike the real host) no `?`->`$N` conversion is needed.
//
// This models only the STANDALONE write path. It does NOT model
// `withTauriSqlTransaction` (which commits a queued batch via the Tauri
// `local_db_execute_transaction` IPC). That is fine here by design: renderer repo
// METHODS issue standalone writes — cross-method atomicity is composed by callers
// via `asyncTransact`, not inside a method — and the O1 fix keeps `setActive` a
// sequence of standalone writes guarded by an existence check, so this shim
// faithfully exercises both the broken and the fixed code without a tx stub.
function makeProxyDb(sqlite: Database.Database): TauriDrizzleDb {
  const proxy = drizzleProxy(async (sql, params, method) => {
    const bind = params as ReadonlyArray<string | number | null>;
    if (method === 'run') {
      sqlite.prepare(sql).run(...bind);
      return { rows: [] };
    }
    const rows = sqlite.prepare(sql).raw().all(...bind) as unknown[][];
    if (method === 'get') {
      return { rows: rows[0] ?? [] };
    }
    return { rows };
  });
  // sqlite-proxy db is structurally the Tauri db minus the IPC hop.
  return proxy as unknown as TauriDrizzleDb;
}

// The repo's officeLayouts returns the full OfficeLayoutRow; the contract only needs
// the OfficeLayoutRowLike slice. The widening cast bridges the two row shapes.
async function runBackend(
  label: string,
  makeRepos: (sqlite: Database.Database) => OfficeLayoutsContractRepo,
): Promise<void> {
  const sqlite = new Database(':memory:');
  seed(sqlite);
  await runOfficeLayoutSetActiveContract(label, makeRepos(sqlite), IDS);
  console.log(`  ✓ ${label} backend honours the setActive tenant boundary`);
}

async function main(): Promise<void> {
  console.log('workspace-repo contract (W0-C): officeLayouts.setActive tenant boundary');

  await runBackend(
    'better-sqlite3',
    (sqlite) =>
      createWorkspaceDrizzleRepos(drizzleBetter(sqlite) as BetterSQLite3Database<Record<string, never>>)
        .officeLayouts as unknown as OfficeLayoutsContractRepo,
  );

  await runBackend(
    'sqlite-proxy',
    (sqlite) =>
      createWorkspaceTauriRepos(makeProxyDb(sqlite))
        .officeLayouts as unknown as OfficeLayoutsContractRepo,
  );

  console.log('workspace-repo contract: PASS');
}

main().catch((err) => {
  console.error('workspace-repo contract: FAIL');
  console.error(err instanceof assert.AssertionError ? err.message : err);
  process.exit(1);
});
