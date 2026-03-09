import { drizzle } from 'drizzle-orm/sqlite-proxy';
import * as schema from '@aics/db-local';

/**
 * Lazily-loaded tauri-plugin-sql Database connection.
 * Dynamic import ensures this module is never loaded in browser mode.
 */
let dbPromise: Promise<any> | null = null;

async function getPluginDb() {
  if (!dbPromise) {
    dbPromise = (async () => {
      const { default: Database } = await import('@tauri-apps/plugin-sql');
      return Database.load('sqlite:aics.db');
    })();
  }
  return dbPromise;
}

/**
 * Convert Drizzle's `?` placeholders to tauri-plugin-sql's `$1, $2, ...` format.
 *
 * Drizzle sqlite dialect uses `?` (standard SQLite), but tauri-plugin-sql
 * (backed by sqlx) uses `$N` positional parameters for SQLite.
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
    const db = await getPluginDb();
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
