import { drizzle } from 'drizzle-orm/sqlite-proxy';
import * as schema from '@aics/db-local';
import { getTauriDb } from './tauri-db';

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

/**
 * Create a Drizzle ORM database instance backed by tauri-plugin-sql.
 *
 * The sqlite-proxy driver generates SQL in JavaScript, then this callback
 * sends it to the Rust backend via Tauri IPC for execution.
 *
 * @returns Drizzle DB instance (async — all .all()/.run() return Promises)
 */
export function createTauriDrizzleDb() {
  return drizzle(async (sql, params, method) => {
    const db = await getTauriDb();
    const convertedSql = convertPlaceholders(sql);

    if (method === 'run') {
      await db.execute(convertedSql, params);
      return { rows: [] };
    }

    // SELECT — return rows as array of objects
    const rows = await db.select(convertedSql, params);
    return { rows };
  }, { schema });
}

export type TauriDrizzleDb = ReturnType<typeof createTauriDrizzleDb>;
