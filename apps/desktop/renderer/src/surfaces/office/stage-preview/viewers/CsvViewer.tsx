import { useMemo, useState } from 'react';
import { parseCsvRows } from '../csv-parse.js';
import { DataTable } from './data-table.js';
import { TextViewer } from './TextViewer.js';

export function CsvViewer({ text, truncated }: { text: string; truncated?: boolean }) {
  const [raw, setRaw] = useState(false);
  const rows = useMemo(() => parseCsvRows(text), [text]);
  return (
    <div className="off-csv-viewer">
      <div className="off-preview-text-tools">
        <span>{rows.length.toLocaleString()} rows</span>
        <button type="button" onClick={() => setRaw(!raw)}>
          {raw ? 'Table' : 'Raw'}
        </button>
      </div>
      {truncated && !raw ? (
        <div className="off-preview-banner">Preview truncated at the desktop text budget.</div>
      ) : null}
      {raw ? (
        <TextViewer text={text} truncated={truncated} languageLabel="CSV" />
      ) : (
        <DataTable rows={rows} />
      )}
    </div>
  );
}
