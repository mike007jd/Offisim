import type { FileHistoryChangeKind } from '@offisim/core/browser';
import { Card, CardContent, CardHeader, CardTitle, ScrollArea } from '@offisim/ui-core';
import { FileText } from 'lucide-react';
import { useFileHistory } from '../../hooks/useFileHistory';

const CHANGE_STYLE: Record<FileHistoryChangeKind, { label: string; color: string }> = {
  create: { label: 'A', color: 'text-emerald-400 bg-emerald-400/15' },
  update: { label: 'M', color: 'text-blue-400 bg-blue-400/15' },
  delete: { label: 'D', color: 'text-red-400 bg-red-400/15' },
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
          <FileText className="h-4 w-4 text-amber-400" />
          File Changes
        </CardTitle>
      </CardHeader>
      <CardContent>
        {!activeThreadId ? (
          <p className="text-xs text-slate-500 italic">Select a project to see file changes</p>
        ) : isLoading ? (
          <p className="text-xs text-slate-500">Loading...</p>
        ) : changes.length === 0 ? (
          <p className="text-xs text-slate-500 italic">No file changes recorded</p>
        ) : (
          <ScrollArea className="max-h-64">
            {[...grouped.entries()].map(([stepIndex, items]) => (
              <div key={stepIndex ?? 'none'} className="mb-2 last:mb-0">
                {stepIndex !== null && (
                  <p className="text-[10px] uppercase tracking-wider text-slate-600 px-2 py-0.5">
                    Step {stepIndex + 1}
                  </p>
                )}
                {items.map((c) => {
                  const style = CHANGE_STYLE[c.change_kind];
                  return (
                    <div
                      key={c.history_id}
                      className="flex items-center gap-2 px-2 py-1 text-xs hover:bg-white/5 transition-colors"
                    >
                      <span
                        className={`w-4 h-4 flex items-center justify-center rounded text-[9px] font-bold ${style.color}`}
                      >
                        {style.label}
                      </span>
                      <span className="flex-1 min-w-0 truncate text-slate-300 font-mono text-[11px]">
                        {c.file_path}
                      </span>
                      {c.tool_name && (
                        <span className="text-[10px] text-slate-600 shrink-0">{c.tool_name}</span>
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
