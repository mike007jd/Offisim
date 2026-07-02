import { useVirtualizer } from '@tanstack/react-virtual';
import { useMemo, useRef, useState } from 'react';
import { parseCsvRows } from '../csv-parse.js';
import { TextViewer } from './TextViewer.js';

export function CsvViewer({ text, truncated }: { text: string; truncated?: boolean }) {
  const [raw, setRaw] = useState(false);
  const rows = useMemo(() => parseCsvRows(text), [text]);
  const header = rows[0] ?? [];
  const body = rows.slice(1);
  const scrollRef = useRef<HTMLDivElement | null>(null);
  const virtualizer = useVirtualizer({
    count: body.length,
    getScrollElement: () => scrollRef.current,
    estimateSize: () => 31,
    overscan: 20,
  });
  if (raw) return <TextViewer text={text} truncated={truncated} languageLabel="CSV" />;
  return (
    <div className="off-csv-viewer">
      <div className="off-preview-text-tools">
        <span>{rows.length.toLocaleString()} rows</span>
        <button type="button" onClick={() => setRaw(true)}>
          Raw
        </button>
      </div>
      {truncated ? (
        <div className="off-preview-banner">Preview truncated at the desktop text budget.</div>
      ) : null}
      <div ref={scrollRef} className="off-csv-scroll">
        <table>
          <thead>
            <tr>
              {header.map((cell, index) => (
                <th key={`${cell}-${index}`}>{cell || `Column ${index + 1}`}</th>
              ))}
            </tr>
          </thead>
        </table>
        <div style={{ height: `${virtualizer.getTotalSize()}px` }} className="off-csv-body">
          {virtualizer.getVirtualItems().map((item) => {
            const row = body[item.index] ?? [];
            return (
              <table
                key={item.key}
                className="off-csv-row-table"
                style={{ transform: `translateY(${item.start}px)` }}
              >
                <tbody>
                  <tr>
                    {header.map((_, index) => (
                      <td key={index}>{row[index] ?? ''}</td>
                    ))}
                  </tr>
                </tbody>
              </table>
            );
          })}
        </div>
      </div>
    </div>
  );
}
