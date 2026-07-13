import { type ParsedAttachment, parseAttachment } from '@offisim/doc-engine';
import { useEffect, useMemo, useState } from 'react';
import { parseCsvRows } from '../csv-parse.js';
import type { PreviewData } from '../preview-data.js';
import type { ResolvedPreviewTarget } from '../preview-target.js';
import { TextViewer } from './TextViewer.js';
import { UnsupportedViewer } from './UnsupportedViewer.js';
import { DataTable } from './data-table.js';

type ParseState =
  | { status: 'loading' }
  | { status: 'ready'; parsed: ParsedAttachment }
  | { status: 'error'; message: string };

export function SheetViewer({
  resolved,
  data,
}: {
  resolved: ResolvedPreviewTarget;
  data: Extract<PreviewData, { mode: 'bytes' }>;
}) {
  const [state, setState] = useState<ParseState>({ status: 'loading' });
  const [activeSheet, setActiveSheet] = useState(0);
  const [raw, setRaw] = useState(false);

  useEffect(() => {
    let cancelled = false;
    setState({ status: 'loading' });
    void parseAttachment(
      new Uint8Array(data.bytes),
      resolved.meta.mimeType ?? 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
      resolved.meta.title,
    )
      .then((parsed) => {
        if (!cancelled) setState({ status: 'ready', parsed });
      })
      .catch((error) => {
        if (!cancelled) {
          setState({
            status: 'error',
            message: error instanceof Error ? error.message : String(error),
          });
        }
      });
    return () => {
      cancelled = true;
    };
  }, [data.bytes, resolved.meta.mimeType, resolved.meta.title]);

  const sheet =
    state.status === 'ready' && state.parsed.kind === 'xlsx'
      ? state.parsed.sheets[Math.min(activeSheet, Math.max(0, state.parsed.sheets.length - 1))]
      : null;
  const rows = useMemo(() => (sheet ? parseCsvRows(sheet.csv) : []), [sheet]);

  if (state.status === 'loading') {
    return (
      <div className="off-stage-empty">
        <strong>Loading workbook</strong>
        <span>Parsing workbook sheets for preview.</span>
      </div>
    );
  }
  if (state.status === 'error') {
    return <UnsupportedViewer resolved={resolved} data={{ mode: 'none', reason: state.message }} />;
  }
  if (state.parsed.kind !== 'xlsx') {
    return (
      <UnsupportedViewer
        resolved={resolved}
        data={{ mode: 'none', reason: 'Workbook parser did not return XLSX sheets.' }}
      />
    );
  }
  return (
    <div className="off-sheet-viewer">
      <div className="off-preview-text-tools">
        {state.parsed.sheets.map((item, index) => (
          <button
            key={item.name}
            type="button"
            className={index === activeSheet && !raw ? 'is-active' : undefined}
            onClick={() => {
              setActiveSheet(index);
              setRaw(false);
            }}
          >
            {item.name}
          </button>
        ))}
        {sheet ? <span>{sheet.rowCount.toLocaleString()} rows</span> : null}
        <button type="button" disabled={!sheet} onClick={() => setRaw(!raw)}>
          {raw ? 'Table' : 'Raw'}
        </button>
      </div>
      {raw && sheet ? (
        <TextViewer text={sheet.csv} />
      ) : (
        <DataTable rows={rows} emptyLabel="No cells in this sheet" />
      )}
    </div>
  );
}
