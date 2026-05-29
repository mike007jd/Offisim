import type { ParsedAttachment } from '@offisim/shared-types';
import { assertArchiveInflationBudget } from './safe-archive.js';

export async function parseXlsx(bytes: Uint8Array): Promise<ParsedAttachment> {
  // SheetJS inflates the whole xlsx (a ZIP) internally with no size hook, so
  // prove the inflated size is bounded BEFORE handing it the bytes — a bomb
  // throws here and never reaches XLSX.read.
  assertArchiveInflationBudget(bytes);
  const XLSX = await import('xlsx');
  const workbook = XLSX.read(bytes, { type: 'array' });
  const sheets = workbook.SheetNames.map((name) => {
    const ws = workbook.Sheets[name];
    if (!ws) return { name, csv: '', rows: [] as ReadonlyArray<ReadonlyArray<unknown>> };
    const csv = XLSX.utils.sheet_to_csv(ws);
    const rows = XLSX.utils.sheet_to_json(ws, { header: 1 }) as unknown[][];
    return { name, csv, rows };
  });
  return { kind: 'xlsx', sheets };
}
