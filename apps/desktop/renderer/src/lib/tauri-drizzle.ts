import { invokeCommand } from '@/lib/tauri-commands.js';
import * as schema from '@offisim/db-local';
import { drizzle } from 'drizzle-orm/sqlite-proxy';
import { getTauriDb } from './tauri-db';

interface QueuedTransactionStatement {
  readonly sql: string;
  readonly params: readonly unknown[];
}

export interface TauriTransactionBackend {
  readonly statements: QueuedTransactionStatement[];
}

// Promise-chain mutex serializing transactions and the standalone writes that
// arrive *between* transactions. Tx-scoped repositories write into their own
// queue; standalone writes wait behind the transaction instead of being captured
// into it.
//
// A caller that ignores the tx-scoped db and writes through outer repositories
// would deadlock on this mutex, so repository factories reject zero-argument
// asyncTransact callbacks before they enter this function.
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
 * Convert Drizzle's `?` placeholders to sqlx's `$1, $2, ...` format.
 *
 * Drizzle sqlite dialect uses `?` (standard SQLite), but the Rust sqlx boundary
 * uses `$N` positional parameters for SQLite.
 *
 * ASSUMPTION: Only used for Drizzle-generated SQL. Drizzle never places `?`
 * inside string literals — all values are parameterized. If used with raw SQL
 * containing `?` in string literals, this function will produce incorrect output.
 */
function convertPlaceholders(sql: string): string {
  let idx = 0;
  return sql.replace(/\?/g, () => `$${++idx}`);
}

/**
 * Normalize rows returned by the Rust boundary. Column order follows the
 * SELECT projection, matching the previous plugin-backed contract.
 */
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
 * Create a Drizzle ORM database instance backed by allowlisted Rust commands.
 *
 * The sqlite-proxy driver generates SQL in JavaScript, then this callback
 * sends it to the Rust backend via Tauri IPC for execution.
 *
 * @returns Drizzle DB instance (async — all .all()/.run() return Promises)
 */
export function createTauriDrizzleDb() {
  return createTauriDrizzleDbForQueue(null);
}

function createTauriDrizzleDbForQueue(transactionQueue: TauriTransactionBackend | null) {
  return drizzle(
    async (sql, params, method) => {
      const db = await getTauriDb();
      const convertedSql = convertPlaceholders(sql);

      if (method === 'run') {
        if (transactionQueue) {
          transactionQueue.statements.push({ sql: convertedSql, params: [...params] });
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
export async function withTauriSqlTransaction<T>(
  fn: (txDb: TauriDrizzleDb) => Promise<T>,
): Promise<T> {
  return serializeWrite(async () => {
    const queue: TauriTransactionBackend = { statements: [] };
    const txDb = createTauriDrizzleDbForQueue(queue);
    const result = await fn(txDb);
    if (queue.statements.length > 0) {
      await invokeCommand('local_db_execute_transaction', { statements: queue.statements });
    }
    return result;
  });
}
