import { useVirtualizer } from '@tanstack/react-virtual';
import { useRef } from 'react';

export function DataTable({ rows, emptyLabel = 'No rows' }: { rows: string[][]; emptyLabel?: string }) {
  const header = rows[0] ?? [];
  const body = rows.slice(1);
  const columns = Math.max(header.length, ...body.map((row) => row.length), 1);
  const scrollRef = useRef<HTMLDivElement | null>(null);
  const virtualizer = useVirtualizer({
    count: body.length,
    getScrollElement: () => scrollRef.current,
    estimateSize: () => 31,
    overscan: 20,
  });

  if (rows.length === 0) {
    return <div className="off-preview-empty-note">{emptyLabel}</div>;
  }

  return (
    <div ref={scrollRef} className="off-csv-scroll">
      <table>
        <thead>
          <tr>
            {Array.from({ length: columns }, (_, index) => (
              <th key={index}>{header[index] || `Column ${index + 1}`}</th>
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
                  {Array.from({ length: columns }, (_, index) => (
                    <td key={index}>{row[index] ?? ''}</td>
                  ))}
                </tr>
              </tbody>
            </table>
          );
        })}
      </div>
    </div>
  );
}
