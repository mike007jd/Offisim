import type { ParsedAttachment } from '@offisim/shared-types';

export async function parseXlsx(bytes: Uint8Array): Promise<ParsedAttachment> {
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
