import type { FileHistoryChangeKind } from '@offisim/core/browser';
import { Card, CardContent, CardHeader, CardTitle, ScrollArea } from '@offisim/ui-core';
import { FileText } from 'lucide-react';
import { useFileHistory } from '../../hooks/useFileHistory';

const CHANGE_STYLE: Record<FileHistoryChangeKind, { label: string; color: string }> = {
  create: { label: 'A', color: 'text-success bg-success-muted' },
  update: { label: 'M', color: 'text-info bg-info-muted' },
  delete: { label: 'D', color: 'text-error bg-error-muted' },
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
          <FileText className="size-4 text-warning" />
          File Changes
        </CardTitle>
      </CardHeader>
      <CardContent>
        {!activeThreadId ? (
          <p className="text-xs italic text-text-muted">Select a project to see file changes</p>
        ) : isLoading ? (
          <p className="text-xs text-text-muted">Loading...</p>
        ) : changes.length === 0 ? (
          <p className="text-xs italic text-text-muted">No file changes recorded</p>
        ) : (
          <ScrollArea className="max-h-64">
            {[...grouped.entries()].map(([stepIndex, items]) => (
              <div key={stepIndex ?? 'none'} className="mb-2 last:mb-0">
                {stepIndex !== null && (
                  <p className="px-2 py-0.5 text-caption uppercase tracking-wider text-text-muted">
                    Step {stepIndex + 1}
                  </p>
                )}
                {items.map((c) => {
                  const style = CHANGE_STYLE[c.change_kind];
                  return (
                    <div
                      key={c.history_id}
                      className="flex items-center gap-2 px-2 py-1 text-xs transition-colors hover:bg-surface-hover"
                    >
                      <span
                        className={`flex size-4 items-center justify-center rounded text-caption font-bold ${style.color}`}
                      >
                        {style.label}
                      </span>
                      <span className="min-w-0 flex-1 truncate font-mono text-caption text-text-secondary">
                        {c.file_path}
                      </span>
                      {c.tool_name && (
                        <span className="shrink-0 text-caption text-text-muted">{c.tool_name}</span>
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
