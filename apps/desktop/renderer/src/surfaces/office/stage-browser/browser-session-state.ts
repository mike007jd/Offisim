import type { BrowserSessionSnapshot } from '@/lib/tauri-commands.js';

export function newestBrowserSnapshot(
  current: BrowserSessionSnapshot | null,
  next: BrowserSessionSnapshot,
): BrowserSessionSnapshot {
  return !current || next.sequence >= current.sequence ? next : current;
}
