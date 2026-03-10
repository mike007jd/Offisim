import type Database from '@tauri-apps/plugin-sql';

/**
 * Shared singleton for tauri-plugin-sql Database connection.
 *
 * All Tauri modules (tauri-drizzle, tauri-checkpoint, tauri-seed) MUST use
 * this singleton to avoid creating multiple SQLite connections, which can
 * cause WAL lock contention.
 *
 * Dynamic import ensures @tauri-apps/plugin-sql is never loaded in browser mode.
 */
let dbPromise: Promise<Database> | null = null;

export function getTauriDb(): Promise<Database> {
  if (!dbPromise) {
    dbPromise = (async () => {
      const { default: Database } = await import('@tauri-apps/plugin-sql');
      return Database.load('sqlite:aics.db');
    })();
  }
  return dbPromise;
}
