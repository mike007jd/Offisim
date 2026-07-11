import { invokeCommand } from '@/lib/tauri-commands.js';

export interface TauriDb {
  execute(sql: string, params: readonly unknown[]): Promise<number>;
  select<T>(sql: string, params?: readonly unknown[]): Promise<T>;
}

const db: TauriDb = {
  execute: (sql, params) => invokeCommand('local_db_execute', { sql, params: [...params] }),
  select: <T>(sql: string, params: readonly unknown[] = []) =>
    invokeCommand('local_db_select', { sql, params: [...params] }) as Promise<T>,
};

/** All renderer SQL crosses the Rust allowlist; no native plugin command is exposed. */
export async function getTauriDb(): Promise<TauriDb> {
  return db;
}
