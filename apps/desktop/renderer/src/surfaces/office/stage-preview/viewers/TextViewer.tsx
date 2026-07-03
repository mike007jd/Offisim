import { cn } from '@/lib/utils.js';
import { useVirtualizer } from '@tanstack/react-virtual';
import { Search } from 'lucide-react';
import { useMemo, useRef, useState } from 'react';

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

function HighlightedText({ text, query }: { text: string; query: string }) {
  if (!query) return <>{text || ' '}</>;
  const parts = text.split(new RegExp(`(${escapeRegExp(query)})`, 'ig'));
  return (
    <>
      {parts.map((part, index) =>
        part.toLowerCase() === query.toLowerCase() ? (
          <mark key={`${part}-${index}`}>{part}</mark>
        ) : (
          <span key={`${part}-${index}`}>{part}</span>
        ),
      )}
    </>
  );
}

export function TextViewer({
  text,
  truncated,
}: {
  text: string;
  truncated?: boolean;
}) {
  const [query, setQuery] = useState('');
  const rows = useMemo(() => text.split(/\r?\n/u), [text]);
  const matches = useMemo(() => {
    const normalized = query.trim().toLowerCase();
    if (!normalized) return [];
    return rows.reduce<number[]>((acc, row, index) => {
      if (row.toLowerCase().includes(normalized)) acc.push(index);
      return acc;
    }, []);
  }, [query, rows]);
  const [matchIndex, setMatchIndex] = useState(0);
  const scrollRef = useRef<HTMLDivElement | null>(null);
  const virtualizer = useVirtualizer({
    count: rows.length,
    getScrollElement: () => scrollRef.current,
    estimateSize: () => 23,
    overscan: 24,
  });
  const activeLine = matches.length > 0 ? matches[matchIndex % matches.length] : null;

  function jump(delta: number) {
    if (matches.length === 0) return;
    const next = (matchIndex + delta + matches.length) % matches.length;
    const line = matches[next] ?? 0;
    setMatchIndex(next);
    virtualizer.scrollToIndex(line, { align: 'center' });
  }

  return (
    <div className="off-preview-text">
      <div className="off-preview-text-tools">
        <label className="off-preview-search">
          <Search size={14} aria-hidden="true" />
          <input
            value={query}
            onChange={(event) => {
              setQuery(event.target.value);
              setMatchIndex(0);
            }}
            placeholder="Search"
          />
        </label>
        <button type="button" disabled={matches.length === 0} onClick={() => jump(-1)}>
          Prev
        </button>
        <button type="button" disabled={matches.length === 0} onClick={() => jump(1)}>
          Next
        </button>
        <output>{matches.length > 0 ? `${matchIndex + 1}/${matches.length}` : '0/0'}</output>
      </div>
      {truncated ? (
        <div className="off-preview-banner">Preview truncated at the desktop text budget.</div>
      ) : null}
      <div ref={scrollRef} className="off-preview-text-scroll">
        <div
          className="off-preview-text-virtual"
          style={{ height: `${virtualizer.getTotalSize()}px` }}
        >
          {virtualizer.getVirtualItems().map((item) => (
            <div
              key={item.key}
              ref={virtualizer.measureElement}
              data-index={item.index}
              className={cn('off-preview-line', activeLine === item.index && 'is-match')}
              style={{ transform: `translateY(${item.start}px)` }}
            >
              <span className="off-preview-line-no">{item.index + 1}</span>
              <code>
                <HighlightedText text={rows[item.index] ?? ''} query={query.trim()} />
              </code>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}
