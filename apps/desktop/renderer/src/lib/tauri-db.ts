import type Database from '@tauri-apps/plugin-sql';
type TauriSqlModule = typeof import('@tauri-apps/plugin-sql');

/**
 * Shared singleton for tauri-plugin-sql Database connection.
 * Resets on init failure so next call retries instead of permanent poisoning.
 */
let dbPromise: Promise<Database> | null = null;

export function getTauriDb(): Promise<Database> {
  if (!dbPromise) {
    dbPromise = (async () => {
      const tauriSqlModule: TauriSqlModule = await import('@tauri-apps/plugin-sql');
      const { default: Database } = tauriSqlModule;
      const db = await Database.load('sqlite:offisim.db');
      // Enable WAL for concurrent read/write safety
      await db.execute('PRAGMA journal_mode=WAL', []);
      await db.execute('PRAGMA busy_timeout=5000', []);
      return db;
    })().catch((err) => {
      dbPromise = null; // Reset so next call retries
      throw err;
    });
  }
  return dbPromise;
}
