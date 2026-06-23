import type { ParsedAttachment } from '@offisim/shared-types';
import { assertArchiveInflationBudget } from './safe-archive.js';

// Per-sheet and whole-workbook caps. SheetJS will happily decode a workbook
// whose used range spans millions of rows/cols, and `sheet_to_csv` then
// materializes every cell — an unbounded memory blowup on a large or
// maliciously crafted workbook (the zip-bomb guard bounds the *inflated*
// archive bytes, not the *decoded* cell grid). A workbook tripping any cap is
// rejected (the whole parse fails into `{ kind: 'unsupported' }` upstream)
// rather than processed unboundedly. Limits mirror the generous-but-finite
// style of the doc archive limits in `safe-archive.ts`.
const MAX_ROWS_PER_SHEET = 1_000_000; // Excel's own hard row ceiling (1,048,576) rounded down
const MAX_COLS_PER_SHEET = 16_384; // Excel's hard column ceiling (XFD)
const MAX_TOTAL_CELLS = 5_000_000; // whole-workbook decoded-cell budget

class XlsxLimitError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'XlsxLimitError';
  }
}

export async function parseXlsx(bytes: Uint8Array): Promise<ParsedAttachment> {
  // SheetJS inflates the whole xlsx (a ZIP) internally with no size hook, so
  // prove the inflated size is bounded BEFORE handing it the bytes — a bomb
  // throws here and never reaches XLSX.read.
  assertArchiveInflationBudget(bytes);
  const XLSX = await import('xlsx');
  const workbook = XLSX.read(bytes, { type: 'array' });

  // First pass: derive dimensions from each sheet's declared used range
  // (`!ref`) and enforce the caps BEFORE materializing any CSV. The range is
  // decoded from a tiny string, so this is O(sheets) and never allocates the
  // cell grid — that is the whole point of dropping the old `rows` 2D array,
  // which was built only to read `.rows.length` downstream.
  let totalCells = 0;
  const dimensions = workbook.SheetNames.map((name) => {
    const ws = workbook.Sheets[name];
    const ref = ws?.['!ref'];
    if (!ws || typeof ref !== 'string' || ref.length === 0) {
      return { name, rowCount: 0 };
    }
    const range = XLSX.utils.decode_range(ref);
    const rowCount = range.e.r - range.s.r + 1;
    const colCount = range.e.c - range.s.c + 1;
    if (rowCount > MAX_ROWS_PER_SHEET) {
      throw new XlsxLimitError(
        `Sheet "${name}" has ${rowCount} rows, exceeding the per-sheet cap of ${MAX_ROWS_PER_SHEET}`,
      );
    }
    if (colCount > MAX_COLS_PER_SHEET) {
      throw new XlsxLimitError(
        `Sheet "${name}" has ${colCount} columns, exceeding the per-sheet cap of ${MAX_COLS_PER_SHEET}`,
      );
    }
    totalCells += rowCount * colCount;
    if (totalCells > MAX_TOTAL_CELLS) {
      throw new XlsxLimitError(
        `Workbook decodes to more than ${MAX_TOTAL_CELLS} cells, exceeding the total-cell cap`,
      );
    }
    return { name, rowCount };
  });

  // Second pass: only now that every sheet is proven within bounds do we
  // materialize CSV (the single field downstream actually reads).
  const sheets = dimensions.map(({ name, rowCount }) => {
    const ws = workbook.Sheets[name];
    const csv = ws ? XLSX.utils.sheet_to_csv(ws) : '';
    return { name, csv, rowCount };
  });
  return { kind: 'xlsx', sheets };
}
