/**
 * Deterministic doc-engine XLSX importer cap harness (audit item D2).
 *
 * Two guarantees:
 *  1. A normal workbook still reports correct per-sheet `rowCount` and CSV — the
 *     count is now derived from the sheet `!ref` used-range, not a materialized
 *     2D `rows` grid.
 *  2. A workbook whose declared used-range trips a cap (per-sheet rows or the
 *     whole-workbook total-cell budget) is REJECTED rather than processed
 *     unboundedly. A tiny xlsx can forge a multi-million-cell `!ref` with one
 *     real cell, so this is the realistic blow-up vector. (The per-sheet COLUMN
 *     cap is defense-in-depth only: SheetJS itself clamps columns to Excel's
 *     16,384/XFD ceiling on round-trip, so a parseable workbook can't exceed it.)
 *
 * Runs through `parseAttachment` (the production entry) so the rejection path
 * is exercised exactly as a real attachment would hit it: a thrown cap funnels
 * into `{ kind: 'unsupported', reason }` instead of throwing into the runtime.
 *
 * Per CLAUDE.md deterministic-harness rule: every assertion checks a property
 * that can only hold if the parser actually decoded the bytes (sheet names,
 * derived row counts, CSV cell values, cap rejection with a non-empty reason).
 */
import { createRequire } from 'node:module';
import { parseAttachment } from '../packages/doc-engine/src/import/index.js';

// `xlsx` is a dependency of @offisim/doc-engine, not of the package whose `tsx`
// runs this harness. Resolve it from doc-engine's own package.json so the bare
// specifier loads the same SheetJS build the importer uses at runtime — exactly
// how `xlsx.ts` reaches it via `await import('xlsx')` from its own directory.
const docEngineRequire = createRequire(
  new URL('../packages/doc-engine/package.json', import.meta.url),
);
// biome-ignore lint/suspicious/noExplicitAny: SheetJS ships its own ambient types via the dep tree, but the require() handle is untyped here.
const XLSX = docEngineRequire('xlsx') as any;

const XLSX_MIME = 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet';

// biome-ignore lint/suspicious/noExplicitAny: SheetJS workbook/worksheet shapes are dynamic; the harness only touches `!ref` + cell records.
type AnyWorkbook = any;

function workbookBytes(build: (x: typeof XLSX) => AnyWorkbook): Uint8Array {
  const wb = build(XLSX);
  const out = XLSX.write(wb, { type: 'array', bookType: 'xlsx' }) as ArrayLike<number>;
  return new Uint8Array(out);
}

/** A small, legitimate workbook with known dimensions and cell values. */
function normalWorkbook(): Uint8Array {
  return workbookBytes((x) => {
    const wb = x.utils.book_new();
    const scores = x.utils.aoa_to_sheet([
      ['name', 'score'],
      ['Alice', 88],
      ['Bob', 92],
      ['Carol', 77],
    ]);
    const notes = x.utils.aoa_to_sheet([['note'], ['hello world']]);
    x.utils.book_append_sheet(wb, scores, 'Scores');
    x.utils.book_append_sheet(wb, notes, 'Notes');
    return wb;
  });
}

/**
 * A workbook with a single real cell but a forged used-range spanning `rows`
 * rows and `cols` columns — exactly how a tiny file can claim a giant grid.
 *
 * Note: SheetJS clamps columns to Excel's hard ceiling (16,384 / XFD) on
 * write→read, but does NOT clamp rows, so an unbounded ROW range is the real
 * forgeable vector here.
 */
function forgedRangeWorkbook(rows: number, cols: number, sheetName: string): Uint8Array {
  return workbookBytes((x) => {
    const wb = x.utils.book_new();
    const ws: Record<string, unknown> = {};
    ws.A1 = { t: 's', v: 'corner' };
    const far = x.utils.encode_cell({ r: rows - 1, c: cols - 1 });
    ws[far] = { t: 's', v: 'far' };
    ws['!ref'] = `A1:${far}`;
    x.utils.book_append_sheet(wb, ws, sheetName);
    return wb;
  });
}

function fail(message: string): never {
  console.error(`Doc-engine XLSX limits harness FAILED: ${message}`);
  process.exit(1);
}

async function expectRejected(label: string, bytes: Uint8Array): Promise<void> {
  const parsed = await parseAttachment(bytes, XLSX_MIME, 'limits.xlsx');
  if (parsed.kind !== 'unsupported') {
    fail(`${label}: expected kind=unsupported, got kind=${parsed.kind}`);
  }
  if (typeof parsed.reason !== 'string' || parsed.reason.length === 0) {
    fail(`${label}: rejected parse must carry a non-empty reason`);
  }
  console.log(`  ok  ${label}: rejected (${parsed.reason})`);
}

async function main(): Promise<void> {
  // 1. Normal workbook — dimensions + CSV still correct.
  const normal = await parseAttachment(normalWorkbook(), XLSX_MIME, 'normal.xlsx');
  if (normal.kind !== 'xlsx') fail(`normal: expected kind=xlsx, got kind=${normal.kind}`);
  const byName = new Map(normal.sheets.map((s) => [s.name, s]));
  const scores = byName.get('Scores');
  const notes = byName.get('Notes');
  if (!scores) fail('normal: missing "Scores" sheet');
  if (!notes) fail('normal: missing "Notes" sheet');
  if (scores.rowCount !== 4) fail(`normal: Scores rowCount expected 4, got ${scores.rowCount}`);
  if (notes.rowCount !== 2) fail(`normal: Notes rowCount expected 2, got ${notes.rowCount}`);
  if (!scores.csv.includes('Alice,88') || !scores.csv.includes('Bob,92')) {
    fail(`normal: Scores csv missing expected rows: ${JSON.stringify(scores.csv)}`);
  }
  const totalRows = normal.sheets.reduce((acc, s) => acc + s.rowCount, 0);
  if (totalRows !== 6) fail(`normal: total rowCount expected 6, got ${totalRows}`);
  console.log(
    `  ok  normal workbook: Scores=${scores.rowCount} rows, Notes=${notes.rowCount} rows`,
  );

  // 2. Per-sheet ROW cap (1,000,000): a single-cell file forging a 1,200,000-row
  //    used-range must be rejected before any CSV is materialized. (SheetJS does
  //    NOT clamp the row count on round-trip, so this is a genuine vector.)
  await expectRejected('per-sheet row cap', forgedRangeWorkbook(1_200_000, 1, 'TooTall'));

  // 3. Total-cell cap (5,000,000): a single sheet whose per-sheet ROW count stays
  //    UNDER its cap (999,999 rows < 1,000,000) but whose cell product
  //    (999,999 × 6 ≈ 6.0M) blows the whole-workbook budget. This is the guard
  //    that catches a sheet that is individually in-bounds on each axis yet would
  //    materialize an unbounded cell grid.
  await expectRejected('total-cell cap', forgedRangeWorkbook(999_999, 6, 'Vast'));

  console.log('Doc engine XLSX limits harness passed.');
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
