import * as schema from '@offisim/db-local';
import { drizzle } from 'drizzle-orm/sqlite-proxy';
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
        await db.execute(convertedSql, params);
        return { rows: [] };
      }

      // tauri-plugin-sql returns object rows, while drizzle sqlite-proxy maps
      // selected fields from positional arrays. Normalize here so typed SELECTs
      // round-trip correctly in Tauri.
      const rows = await db.select(convertedSql, params);
      return {
        rows: normalizePluginSqlRows(rows, method),
      };
    },
    { schema },
  );
}

export type TauriDrizzleDb = ReturnType<typeof createTauriDrizzleDb>;
