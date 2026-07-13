import type { BrowserSessionSnapshot } from '@/lib/tauri-commands.js';

export function newestBrowserSnapshot(
  current: BrowserSessionSnapshot | null,
  next: BrowserSessionSnapshot,
): BrowserSessionSnapshot {
  return !current || current.sessionId !== next.sessionId || next.sequence >= current.sequence
    ? next
    : current;
}
