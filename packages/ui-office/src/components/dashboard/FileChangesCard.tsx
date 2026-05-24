import type { FileHistoryChangeKind } from '@offisim/core/browser';
import { Card, CardContent, CardHeader, CardTitle, ScrollArea } from '@offisim/ui-core';
import { FileText } from 'lucide-react';
import { useFileHistory } from '../../hooks/useFileHistory';

const CHANGE_STYLE: Record<FileHistoryChangeKind, { label: string; className: string }> = {
  create: { label: 'A', className: 'text-ok bg-ok-surface' },
  update: { label: 'M', className: 'text-accent bg-accent-surface' },
  delete: { label: 'D', className: 'text-danger bg-danger-surface' },
};

interface FileChangesCardProps {
  activeThreadId: string | null;
}

export function FileChangesCard({ activeThreadId }: FileChangesCardProps) {
  const { changes, isLoading } = useFileHistory(activeThreadId);

  // Group by step_index for visual structure
  const grouped = new Map<number | null, typeof changes>();
  for (const c of changes) {
    const key = c.step_index;
    const arr = grouped.get(key);
    if (arr) arr.push(c);
    else grouped.set(key, [c]);
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2 text-sm">
          <FileText className="size-4 text-warn" />
          File Changes
        </CardTitle>
      </CardHeader>
      <CardContent>
        {!activeThreadId ? (
          <p className="text-xs italic text-ink-3">Select a project to see file changes</p>
        ) : isLoading ? (
          <p className="text-xs text-ink-3">Loading...</p>
        ) : changes.length === 0 ? (
          <p className="text-xs italic text-ink-3">No file changes recorded</p>
        ) : (
          <ScrollArea className="max-h-64">
            {[...grouped.entries()].map(([stepIndex, items]) => (
              <div key={stepIndex ?? 'none'} className="mb-2 last:mb-0">
                {stepIndex !== null && (
                  <p className="px-2 py-0.5 text-fs-micro uppercase tracking-wider text-ink-3">
                    Step {stepIndex + 1}
                  </p>
                )}
                {items.map((c) => {
                  const style = CHANGE_STYLE[c.change_kind];
                  return (
                    <div
                      key={c.history_id}
                      className="flex items-center gap-2 px-2 py-1 text-xs transition-colors hover:bg-surface-sunken"
                    >
                      <span
                        className={`flex size-4 items-center justify-center rounded text-fs-micro font-bold ${style.className}`}
                      >
                        {style.label}
                      </span>
                      <span className="min-w-0 flex-1 truncate font-mono text-fs-micro text-ink-2">
                        {c.file_path}
                      </span>
                      {c.tool_name && (
                        <span className="shrink-0 text-fs-micro text-ink-3">{c.tool_name}</span>
                      )}
                    </div>
                  );
                })}
              </div>
            ))}
          </ScrollArea>
        )}
      </CardContent>
    </Card>
  );
}
