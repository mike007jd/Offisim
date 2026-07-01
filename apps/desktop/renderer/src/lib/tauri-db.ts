import type Database from '@tauri-apps/plugin-sql';
import { invoke } from '@tauri-apps/api/core';
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
      const dbUrl = await invoke<string>('local_db_url');
      const db = await Database.load(dbUrl);
      // Enable WAL for concurrent read/write safety
      await db.execute('PRAGMA journal_mode=WAL', []);
      await db.execute('PRAGMA busy_timeout=5000', []);
      // SQLite defaults foreign_keys=OFF per connection, which silently disables
      // the schema's declared `ON DELETE CASCADE` / `SET NULL` rules. Enable it so
      // a `companies.delete(...)` (and other parent deletes) atomically cascades to
      // child rows instead of leaving orphans — relied on for compensating rollback.
      await db.execute('PRAGMA foreign_keys=ON', []);
      return db;
    })().catch((err) => {
      dbPromise = null; // Reset so next call retries
      throw err;
    });
  }
  return dbPromise;
}
