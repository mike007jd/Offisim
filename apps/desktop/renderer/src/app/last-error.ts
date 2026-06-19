/**
 * Shared writer for the `offisim:lastError` localStorage slot (WKWebView persists
 * it to disk) so runtime failures are diagnosable headlessly in the release app.
 *
 * Multiple producers (window error/rejection handlers, the React ErrorBoundary)
 * write here. Each record carries a timestamp + source so the latest failure can
 * be attributed and ordered rather than silently clobbered by whichever wrote last.
 */

const STORAGE_KEY = 'offisim:lastError';
const MAX_RECORDS = 10;

interface LastErrorRecord {
  ts: number;
  source: string;
  message: string;
}

export function recordLastError(source: string, detail: unknown): void {
  try {
    const record: LastErrorRecord = {
      ts: Date.now(),
      source,
      message: detailToString(detail),
    };
    const existing = readRecords();
    existing.push(record);
    const trimmed = existing.slice(-MAX_RECORDS);
    localStorage.setItem(STORAGE_KEY, JSON.stringify(trimmed));
  } catch {
    /* localStorage unavailable or serialization failed */
  }
}

function readRecords(): LastErrorRecord[] {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? (parsed as LastErrorRecord[]) : [];
  } catch {
    return [];
  }
}

function detailToString(detail: unknown): string {
  if (detail instanceof Error) return detail.stack ?? detail.message;
  return String(detail);
}
