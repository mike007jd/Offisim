import { cn } from '@/lib/utils.js';
import type { ToolRichDetail } from '@offisim/shared-types';

type WorkBenchStatus = 'running' | 'done' | 'error';

export function WorkBench({
  detail,
  status,
  compact = false,
}: {
  detail?: ToolRichDetail;
  status: WorkBenchStatus;
  compact?: boolean;
}) {
  if (!detail) {
    return (
      <div className={cn('off-work-bench', compact && 'is-compact', `is-${status}`)}>
        <div className="off-work-bench-empty">{status === 'running' ? 'Running' : 'No details'}</div>
      </div>
    );
  }

  return (
    <div
      className={cn(
        'off-work-bench',
        compact && 'is-compact',
        `is-${status}`,
        `is-${detail.family}`,
      )}
    >
      <div className="off-work-bench-head">
        <span className="off-work-bench-family">{detail.family}</span>
        {statusBadge(status)}
      </div>
      {detail.family === 'terminal' ? <TerminalBench detail={detail} /> : null}
      {detail.family === 'file' ? <FileBench detail={detail} /> : null}
      {detail.family === 'search' ? <SearchBench detail={detail} /> : null}
      {detail.family === 'generic' ? <GenericBench detail={detail} /> : null}
    </div>
  );
}

function statusBadge(status: WorkBenchStatus) {
  return <span className="off-work-bench-status">{status}</span>;
}

function TerminalBench({ detail }: { detail: Extract<ToolRichDetail, { family: 'terminal' }> }) {
  return (
    <div className="off-work-bench-body">
      {detail.command ? (
        <code className="off-work-bench-command">{detail.command}</code>
      ) : (
        <span className="off-work-bench-muted">Waiting for command</span>
      )}
      {detail.exitCode != null ? (
        <span className={cn('off-work-bench-exit', detail.exitCode === 0 ? 'is-zero' : 'is-nonzero')}>
          exit {detail.exitCode}
        </span>
      ) : null}
      {detail.outputSummary ? (
        <pre className="off-work-bench-output">{detail.outputSummary}</pre>
      ) : null}
    </div>
  );
}

function FileBench({ detail }: { detail: Extract<ToolRichDetail, { family: 'file' }> }) {
  const lines = diffLines(detail.summary);
  return (
    <div className="off-work-bench-body">
      {detail.path ? <code className="off-work-bench-path">{detail.path}</code> : null}
      {lines.length > 0 ? (
        <div className="off-work-bench-diff">
          {lines.map((line, index) => (
            <code
              key={`${line.text}-${index}`}
              className={cn('off-work-bench-diff-line', `is-${line.kind}`)}
            >
              {line.text}
            </code>
          ))}
        </div>
      ) : (
        <span className="off-work-bench-muted">Waiting for file result</span>
      )}
    </div>
  );
}

function SearchBench({ detail }: { detail: Extract<ToolRichDetail, { family: 'search' }> }) {
  return (
    <div className="off-work-bench-body">
      {detail.query ? <code className="off-work-bench-query">{detail.query}</code> : null}
      {detail.hitCount != null ? (
        <span className="off-work-bench-hits">{detail.hitCount} hits</span>
      ) : (
        <span className="off-work-bench-muted">Waiting for search results</span>
      )}
    </div>
  );
}

function GenericBench({ detail }: { detail: Extract<ToolRichDetail, { family: 'generic' }> }) {
  return (
    <div className="off-work-bench-body">
      <span className="off-work-bench-copy">{detail.text ?? 'No structured detail'}</span>
    </div>
  );
}

function diffLines(value?: string): Array<{ kind: 'add' | 'remove' | 'context'; text: string }> {
  if (!value) return [];
  return value
    .split('\n')
    .filter((line) => line.length > 0)
    .slice(0, 8)
    .map((line) => ({
      kind: line.startsWith('+') ? 'add' : line.startsWith('-') ? 'remove' : 'context',
      text: line,
    }));
}
