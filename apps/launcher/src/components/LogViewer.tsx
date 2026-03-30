import { memo, useEffect, useRef, useState } from 'react';
import type { LogLine } from '../lib/ipc';

interface LogViewerProps {
  logs: Record<string, LogLine[]>;
}

const TABS = [
  { key: 'platform', label: 'platform' },
  { key: 'frontend', label: 'frontend' },
] as const;

export function LogViewer({ logs }: LogViewerProps) {
  const [activeTab, setActiveTab] = useState<string>('platform');
  const [autoScroll, setAutoScroll] = useState(true);
  const scrollRef = useRef<HTMLDivElement>(null);
  const lines = logs[activeTab] ?? [];

  useEffect(() => {
    if (autoScroll && scrollRef.current) {
      scrollRef.current.scrollTop = scrollRef.current.scrollHeight;
    }
  }, [lines.length, autoScroll]);

  const handleScroll = () => {
    if (!scrollRef.current) return;
    const { scrollTop, scrollHeight, clientHeight } = scrollRef.current;
    setAutoScroll(scrollHeight - scrollTop - clientHeight < 50);
  };

  return (
    <div className="flex flex-col h-full rounded-lg border border-[var(--border-val)] overflow-hidden">
      {/* Tab bar */}
      <div className="flex border-b border-[var(--border-val)] bg-[var(--surface-light)]">
        {TABS.map(({ key, label }) => {
          const count = (logs[key] ?? []).length;
          return (
            <button
              key={key}
              onClick={() => setActiveTab(key)}
              className={`
                px-4 py-2 text-xs font-mono transition-colors cursor-pointer
                ${
                  activeTab === key
                    ? 'text-[var(--text-primary-val)] border-b-2 border-[var(--accent-val)] bg-[var(--surface)]'
                    : 'text-[var(--text-muted-val)] hover:text-[var(--text-secondary-val)]'
                }
              `}
            >
              {label}
              {count > 0 && (
                <span className="ml-1.5 text-[10px] text-[var(--text-muted-val)]">
                  ({count})
                </span>
              )}
            </button>
          );
        })}

        <div className="flex-1" />
        {!autoScroll && (
          <button
            onClick={() => setAutoScroll(true)}
            className="px-3 py-2 text-[10px] text-[var(--accent-val)] hover:underline cursor-pointer"
          >
            Resume auto-scroll
          </button>
        )}
      </div>

      {/* Log content */}
      <div
        ref={scrollRef}
        onScroll={handleScroll}
        className="flex-1 overflow-y-auto bg-[var(--surface)] p-2 font-mono text-[11px] leading-[1.6]"
      >
        {lines.length === 0 ? (
          <div className="text-[var(--text-muted-val)] text-center py-8">
            No logs yet. Start a mode to see output.
          </div>
        ) : (
          lines.map((line) => <LogRow key={line.id} line={line} />)
        )}
      </div>
    </div>
  );
}

const LogRow = memo(function LogRow({ line }: { line: LogLine }) {
  return (
    <div
      className={`whitespace-pre-wrap break-all ${
        line.stream === 'stderr' ? 'text-[var(--error-val)]' : 'text-[var(--text-secondary-val)]'
      }`}
    >
      <span className="text-[var(--text-muted-val)] select-none">
        {formatTime(line.timestamp_ms)}{' '}
      </span>
      {line.text}
    </div>
  );
});

function formatTime(ms: number): string {
  const d = new Date(ms);
  return d.toLocaleTimeString('en-GB', {
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
  });
}
