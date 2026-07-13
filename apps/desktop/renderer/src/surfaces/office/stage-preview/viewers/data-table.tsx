import { useVirtualizer } from '@tanstack/react-virtual';
import { useRef } from 'react';

function describeColumns(header: readonly string[], columnCount: number) {
  const occurrences = new Map<string, number>();
  return Array.from({ length: columnCount }, (_, position) => {
    const label = header[position] || `Column ${position + 1}`;
    const occurrence = occurrences.get(label) ?? 0;
    occurrences.set(label, occurrence + 1);
    return {
      key: JSON.stringify([label, occurrence]),
      label,
      position,
    };
  });
}

export function DataTable({
  rows,
  emptyLabel = 'No rows',
}: { rows: string[][]; emptyLabel?: string }) {
  const header = rows[0] ?? [];
  const body = rows.slice(1);
  const columns = Math.max(header.length, ...body.map((row) => row.length), 1);
  const columnDescriptors = describeColumns(header, columns);
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

  // Wide sheets get a per-column floor so columns stay readable and the
  // container scrolls horizontally instead of crushing every cell.
  const minWidth = columns > 6 ? `${columns * 120}px` : undefined;

  return (
    <div ref={scrollRef} className="off-csv-scroll">
      <table style={{ minWidth }}>
        <thead>
          <tr>
            {columnDescriptors.map((column) => (
              <th key={column.key}>{column.label}</th>
            ))}
          </tr>
        </thead>
      </table>
      <div style={{ height: `${virtualizer.getTotalSize()}px`, minWidth }} className="off-csv-body">
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
                  {columnDescriptors.map((column) => (
                    <td key={column.key}>{row[column.position] ?? ''}</td>
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
