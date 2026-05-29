import * as schema from '@offisim/db-local';
import { invoke } from '@tauri-apps/api/core';
import { drizzle } from 'drizzle-orm/sqlite-proxy';
import { getTauriDb } from './tauri-db';

interface QueuedTransactionStatement {
  readonly sql: string;
  readonly params: readonly unknown[];
}

interface ActiveTransactionQueue {
  readonly statements: QueuedTransactionStatement[];
}

// The transaction currently collecting writes. Only ever set by the single
// write-mutex holder (see `serializeWrite`), so while it is non-null we are
// guaranteed to be executing exactly that transaction's `fn` body.
let activeTransactionQueue: ActiveTransactionQueue | null = null;

// Promise-chain mutex serializing transactions and the standalone writes that
// arrive *between* transactions. This fixes the documented P0: previously two
// concurrent `asyncTransact` calls raced on this module-global queue — the
// second either threw "Nested transactions are not supported" or interleaved
// its statements into the first transaction's queue. Chaining every write here
// means a second transaction (or a standalone write) does not begin until the
// in-flight transaction has fully committed and cleared its queue, so two
// transactions never cross-contaminate.
//
// KNOWN RESIDUAL (requires a separate, larger change): a standalone write whose
// `.run()` is *called* during an open transaction's own awaits still lands in
// the queue branch below and is captured into that transaction. We cannot
// distinguish a transactional write (issued by `fn`) from a concurrent
// standalone one at this proxy without per-transaction db routing or an
// async-context primitive (unavailable in the webview). Fully isolating that
// case needs `asyncTransact((tx) => …)` threaded through InstallService + the
// repo backends — tracked as a follow-up. This change is a strict improvement:
// it removes the spurious "Nested" failure and the transaction-vs-transaction
// swallow without making the standalone case any worse than before.
let writeChain: Promise<unknown> = Promise.resolve();

function serializeWrite<T>(task: () => Promise<T>): Promise<T> {
  // Run `task` after whatever is currently in flight, regardless of its
  // outcome, and keep the chain alive without letting one failure poison it.
  const result = writeChain.then(task, task);
  writeChain = result.then(
    () => undefined,
    () => undefined,
  );
  return result;
}

/**
 * Convert Drizzle's `?` placeholders to tauri-plugin-sql's `$1, $2, ...` format.
 *
 * Drizzle sqlite dialect uses `?` (standard SQLite), but tauri-plugin-sql
 * (backed by sqlx) uses `$N` positional parameters for SQLite.
 *
 * ASSUMPTION: Only used for Drizzle-generated SQL. Drizzle never places `?`
 * inside string literals — all values are parameterized. If used with raw SQL
 * containing `?` in string literals, this function will produce incorrect output.
 */
function convertPlaceholders(sql: string): string {
  let idx = 0;
  return sql.replace(/\?/g, () => `$${++idx}`);
}

function normalizePluginSqlRow(row: unknown): unknown[] {
  if (Array.isArray(row)) {
    return row;
  }
  if (row && typeof row === 'object') {
    return Object.values(row as Record<string, unknown>);
  }
  return [row];
}

function normalizePluginSqlRows(rows: unknown, method: 'all' | 'values' | 'get'): unknown[] {
  if (method === 'get') {
    if (Array.isArray(rows)) {
      return rows.length > 0 ? normalizePluginSqlRow(rows[0]) : [];
    }
    return normalizePluginSqlRow(rows);
  }

  if (!Array.isArray(rows)) {
    return [];
  }

  return rows.map(normalizePluginSqlRow);
}

/**
 * Create a Drizzle ORM database instance backed by tauri-plugin-sql.
 *
 * The sqlite-proxy driver generates SQL in JavaScript, then this callback
 * sends it to the Rust backend via Tauri IPC for execution.
 *
 * @returns Drizzle DB instance (async — all .all()/.run() return Promises)
 */
export function createTauriDrizzleDb() {
  return drizzle(
    async (sql, params, method) => {
      const db = await getTauriDb();
      const convertedSql = convertPlaceholders(sql);

      if (method === 'run') {
        if (activeTransactionQueue) {
          // Inside a transaction's `fn` body (we hold the write mutex, so this
          // write is unambiguously part of THIS transaction) — collect, don't
          // execute. Bypasses `serializeWrite` to avoid self-deadlock.
          activeTransactionQueue.statements.push({ sql: convertedSql, params: [...params] });
          return { rows: [] };
        }
        // Standalone write (no transaction in flight at call time) — serialize
        // behind any queued transaction so writes commit in a deterministic
        // order and never start mid-transaction.
        return serializeWrite(async () => {
          await db.execute(convertedSql, params);
          return { rows: [] };
        });
      }

      // SELECTs inside a `withTauriSqlTransaction` block read committed state.
      // Because the writes in the queue are not yet committed, this means the
      // body of an `asyncTransact` callback does not see read-your-own-write
      // isolation for queued writes. Callers must structure work so that any
      // SELECT they care about either runs before queued writes or accepts
      // the prior committed snapshot.
      const rows = await db.select(convertedSql, params);
      return {
        rows: normalizePluginSqlRows(rows, method),
      };
    },
    { schema },
  );
}

export type TauriDrizzleDb = ReturnType<typeof createTauriDrizzleDb>;

/**
 * Run `fn` as an atomic SQLite transaction. All Drizzle `.run()` writes issued
 * (synchronously or across awaits) inside `fn` are collected and committed as a
 * single batched `local_db_execute_transaction` only after `fn` resolves.
 *
 * Transactions and standalone writes are serialized through a write mutex, so
 * concurrent callers (e.g. the market install flow and a background mutation)
 * run strictly one after another rather than racing on the module-global queue.
 *
 * NOT re-entrant: calling `withTauriSqlTransaction` from inside another
 * transaction's `fn` would chain behind the mutex held by the outer call and
 * deadlock. Flatten nested work into the parent transaction instead.
 */
export async function withTauriSqlTransaction<T>(fn: () => Promise<T>): Promise<T> {
  return serializeWrite(async () => {
    // Inside the mutex the prior holder has already cleared the queue, so this
    // is null for every concurrent caller; a non-null value would only arise
    // from genuine re-entrancy (which deadlocks before reaching here).
    const queue: ActiveTransactionQueue = { statements: [] };
    activeTransactionQueue = queue;
    try {
      const result = await fn();
      if (queue.statements.length > 0) {
        await invoke('local_db_execute_transaction', { statements: queue.statements });
      }
      return result;
    } finally {
      activeTransactionQueue = null;
    }
  });
}
