import type { NodeSummaryRow } from '@offisim/core/browser';
import { Button, Card, CardContent, CardHeader, CardTitle, ScrollArea } from '@offisim/ui-core';
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
    <div className="border-b border-border-subtle last:border-0">
      <Button
        type="button"
        onClick={() => setExpanded((v) => !v)}
        variant="ghost"
        className="h-auto w-full items-start justify-start gap-2 rounded-none px-3 py-2 text-left transition-colors hover:bg-surface-hover"
      >
        {expanded ? (
          <ChevronDown className="mt-0.5 size-3 shrink-0 text-text-muted" />
        ) : (
          <ChevronRight className="mt-0.5 size-3 shrink-0 text-text-muted" />
        )}
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2">
            <span className="text-xs font-medium text-text-primary">
              {humanizeNodeName(row.node_name)}
            </span>
            {row.step_index !== null && (
              <span className="text-caption text-text-muted">Step {row.step_index + 1}</span>
            )}
          </div>
          <p className="truncate text-caption text-text-secondary">{row.summary_text}</p>
        </div>
        <div className="flex shrink-0 items-center gap-2 text-caption text-text-muted">
          <span className="flex items-center gap-0.5">
            <Clock className="size-2.5" />
            {formatDuration(row.duration_ms)}
          </span>
          <span>{row.input_token_count + row.output_token_count} tok</span>
        </div>
      </Button>

      {expanded && (
        <div className="flex flex-col gap-1.5 px-8 pb-2 text-caption">
          {files.length > 0 && (
            <div className="flex items-start gap-1.5 text-text-secondary">
              <FileText className="mt-0.5 size-3 shrink-0 text-info" />
              <span className="break-all">{files.join(', ')}</span>
            </div>
          )}
          {tools.length > 0 && (
            <div className="flex items-start gap-1.5 text-text-secondary">
              <Wrench className="mt-0.5 size-3 shrink-0 text-success" />
              <span>{tools.join(', ')}</span>
            </div>
          )}
          <div className="text-text-muted">
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
          <Brain className="size-4 text-info" />
          Execution Summary
        </CardTitle>
      </CardHeader>
      <CardContent>
        {!activeThreadId ? (
          <p className="text-xs italic text-text-muted">
            Select a project to see execution details
          </p>
        ) : isLoading ? (
          <p className="text-xs text-text-muted">Loading...</p>
        ) : summaries.length === 0 ? (
          <p className="text-xs italic text-text-muted">No execution data yet</p>
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
