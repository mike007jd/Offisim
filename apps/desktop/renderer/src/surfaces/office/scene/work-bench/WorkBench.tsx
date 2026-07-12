import { sceneWorkDetailSummary } from '@/assistant/runtime/scene-cue-projection.js';
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

  if (compact) {
    return (
      <div className={cn('off-work-bench', 'is-compact', `is-${status}`, `is-${detail.family}`)}>
        <div className="off-work-bench-head">
          <span className="off-work-bench-family">Work update</span>
          {statusBadge(status)}
        </div>
        <div className="off-work-bench-body">
          <span className="off-work-bench-copy">{compactWorkBenchSummary(detail)}</span>
        </div>
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
      {detail.family === 'browser' ? <BrowserBench detail={detail} /> : null}
      {detail.family === 'computer' ? <ComputerBench detail={detail} /> : null}
      {detail.family === 'generic' ? <GenericBench detail={detail} /> : null}
    </div>
  );
}

export function compactWorkBenchSummary(detail: ToolRichDetail): string {
  switch (detail.family) {
    case 'terminal':
      return sceneWorkDetailSummary('shell');
    case 'file':
      return sceneWorkDetailSummary('edit');
    case 'search':
    case 'browser':
      return sceneWorkDetailSummary('research');
    case 'computer':
      return sceneWorkDetailSummary('compute');
    case 'generic':
      return sceneWorkDetailSummary(detail.text);
  }
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

function BrowserBench({ detail }: { detail: Extract<ToolRichDetail, { family: 'browser' }> }) {
  const dataRef = detail.screenshot?.dataRef;
  const isInlineImage = dataRef?.startsWith('data:') === true;
  return (
    <div className="off-work-bench-body off-work-bench-browser">
      {detail.title ? <span className="off-work-bench-title">{detail.title}</span> : null}
      {detail.url ? <code className="off-work-bench-url">{detail.url}</code> : null}
      {detail.screenshot ? (
        isInlineImage ? (
          <img
            className="off-work-bench-shot"
            src={dataRef}
            alt={detail.title ?? detail.url ?? 'Browser screenshot'}
          />
        ) : (
          <span className="off-work-bench-shot-ref">
            {detail.screenshot.mimeType} screenshot
          </span>
        )
      ) : (
        <span className="off-work-bench-muted">Waiting for screenshot</span>
      )}
    </div>
  );
}

function ComputerBench({ detail }: { detail: Extract<ToolRichDetail, { family: 'computer' }> }) {
  const dataRef = detail.screenshot?.dataRef;
  const isInlineImage = dataRef?.startsWith('data:') === true;
  return (
    <div className="off-work-bench-body off-work-bench-computer">
      <span className="off-work-bench-action">{detail.action ?? 'observe'}</span>
      {detail.resultState ? (
        <span className={cn('off-work-bench-result', `is-${detail.resultState}`)}>
          {detail.resultState}
        </span>
      ) : null}
      {detail.targetApp || detail.targetWindow ? (
        <code className="off-work-bench-target">
          {[detail.targetApp, detail.targetWindow].filter(Boolean).join(' / ')}
        </code>
      ) : null}
      {detail.coordinates ? (
        <code className="off-work-bench-coordinates">
          x {detail.coordinates.x} y {detail.coordinates.y}
        </code>
      ) : null}
      {detail.textPreview ? (
        <span className="off-work-bench-copy">{detail.textPreview}</span>
      ) : null}
      {detail.screenshot ? (
        isInlineImage ? (
          <img
            className="off-work-bench-shot"
            src={dataRef}
            alt={detail.targetApp ?? detail.targetWindow ?? 'Computer screenshot'}
          />
        ) : (
          <span className="off-work-bench-shot-ref">
            {detail.screenshot.mimeType} screenshot
          </span>
        )
      ) : null}
    </div>
  );
}

function GenericBench({ detail }: { detail: Extract<ToolRichDetail, { family: 'generic' }> }) {
  return (
    <div className="off-work-bench-body">
      <span className="off-work-bench-copy">{sceneWorkDetailSummary(detail.text)}</span>
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
