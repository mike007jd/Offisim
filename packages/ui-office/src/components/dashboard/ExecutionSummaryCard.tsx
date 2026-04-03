import type { NodeSummaryRow } from '@offisim/core/browser';
import { Card, CardContent, CardHeader, CardTitle, ScrollArea } from '@offisim/ui-core';
import { Brain, ChevronDown, ChevronRight, Clock, FileText, Wrench } from 'lucide-react';
import { useState } from 'react';
import { useNodeSummaries } from '../../hooks/useNodeSummaries';
import { humanizeNodeName } from '../../lib/agent-display';

function formatDuration(ms: number): string {
  if (ms < 1000) return `${ms}ms`;
  return `${(ms / 1000).toFixed(1)}s`;
}

function SummaryRow({ row }: { row: NodeSummaryRow }) {
  const [expanded, setExpanded] = useState(false);

  let files: string[] = [];
  let tools: string[] = [];
  try {
    files = JSON.parse(row.files_touched_json || '[]');
  } catch {}
  try {
    tools = JSON.parse(row.tools_used_json || '[]');
  } catch {}

  return (
    <div className="border-b border-white/5 last:border-0">
      <button
        type="button"
        onClick={() => setExpanded((v) => !v)}
        className="w-full flex items-start gap-2 px-3 py-2 hover:bg-white/5 transition-colors text-left"
      >
        {expanded ? (
          <ChevronDown className="h-3 w-3 mt-0.5 text-slate-500 shrink-0" />
        ) : (
          <ChevronRight className="h-3 w-3 mt-0.5 text-slate-500 shrink-0" />
        )}
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2">
            <span className="text-xs font-medium text-slate-200">
              {humanizeNodeName(row.node_name)}
            </span>
            {row.step_index !== null && (
              <span className="text-[10px] text-slate-500">Step {row.step_index + 1}</span>
            )}
          </div>
          <p className="text-[11px] text-slate-400 truncate">{row.summary_text}</p>
        </div>
        <div className="flex items-center gap-2 text-[10px] text-slate-500 shrink-0">
          <span className="flex items-center gap-0.5">
            <Clock className="h-2.5 w-2.5" />
            {formatDuration(row.duration_ms)}
          </span>
          <span>{row.input_token_count + row.output_token_count} tok</span>
        </div>
      </button>

      {expanded && (
        <div className="px-8 pb-2 space-y-1.5 text-[10px]">
          {files.length > 0 && (
            <div className="flex items-start gap-1.5 text-slate-400">
              <FileText className="h-3 w-3 mt-0.5 shrink-0 text-blue-400/60" />
              <span className="break-all">{files.join(', ')}</span>
            </div>
          )}
          {tools.length > 0 && (
            <div className="flex items-start gap-1.5 text-slate-400">
              <Wrench className="h-3 w-3 mt-0.5 shrink-0 text-emerald-400/60" />
              <span>{tools.join(', ')}</span>
            </div>
          )}
          <div className="text-slate-500">
            {row.input_token_count} in / {row.output_token_count} out &middot; {row.message_count}{' '}
            msg{row.message_count === 1 ? '' : 's'}
          </div>
        </div>
      )}
    </div>
  );
}

interface ExecutionSummaryCardProps {
  activeThreadId: string | null;
}

export function ExecutionSummaryCard({ activeThreadId }: ExecutionSummaryCardProps) {
  const { summaries, isLoading } = useNodeSummaries(activeThreadId);

  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2 text-sm">
          <Brain className="h-4 w-4 text-blue-400" />
          Execution Summary
        </CardTitle>
      </CardHeader>
      <CardContent>
        {!activeThreadId ? (
          <p className="text-xs text-slate-500 italic">Select a project to see execution details</p>
        ) : isLoading ? (
          <p className="text-xs text-slate-500">Loading...</p>
        ) : summaries.length === 0 ? (
          <p className="text-xs text-slate-500 italic">No execution data yet</p>
        ) : (
          <ScrollArea className="max-h-64">
            {summaries.map((s) => (
              <SummaryRow key={s.summary_id} row={s} />
            ))}
          </ScrollArea>
        )}
      </CardContent>
    </Card>
  );
}
