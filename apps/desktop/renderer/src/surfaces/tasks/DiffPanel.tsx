import { cn } from '@/lib/utils.js';
import { useEffect, useMemo, useState } from 'react';

export interface DiffPanelProps {
  files: Array<{ path: string; diff: string }>;
  status?: string;
  initialPath?: string | null;
  busy?: boolean;
  onMerge?: () => void;
  onDiscard?: () => void;
  onRequestChanges?: (feedback: string) => void;
}

export function DiffPanel({
  files,
  status,
  initialPath,
  busy,
  onMerge,
  onDiscard,
  onRequestChanges,
}: DiffPanelProps) {
  const [selectedPath, setSelectedPath] = useState(initialPath ?? files[0]?.path ?? '');
  const [feedback, setFeedback] = useState('');
  useEffect(() => {
    if (initialPath && files.some((file) => file.path === initialPath)) {
      setSelectedPath(initialPath);
      return;
    }
    if (!files.some((file) => file.path === selectedPath)) setSelectedPath(files[0]?.path ?? '');
  }, [files, initialPath, selectedPath]);
  const selected = useMemo(
    () => files.find((file) => file.path === selectedPath) ?? files[0],
    [files, selectedPath],
  );
  const reviewable = status === 'pending_review';

  return (
    <section className="off-diff-panel" aria-label="Task diff review">
      <div className="off-diff-files" aria-label="Changed files">
        {files.length === 0 ? <p className="off-task-detail-note">No patch was reported.</p> : null}
        {files.map((file) => (
          <button
            type="button"
            aria-pressed={file.path === selected?.path}
            className={cn(
              'off-diff-file off-focusable',
              file.path === selected?.path && 'is-active',
            )}
            key={file.path}
            onClick={() => setSelectedPath(file.path)}
          >
            {file.path}
          </button>
        ))}
      </div>
      <pre className="off-diff-code">
        {(selected?.diff || 'No textual diff for this file.').split('\n').map((line, index) => (
          <span
            className={cn(
              line.startsWith('+') && !line.startsWith('+++') && 'is-add',
              line.startsWith('-') && !line.startsWith('---') && 'is-remove',
              line.startsWith('@@') && 'is-hunk',
            )}
            key={`${index}-${line}`}
          >
            {line}
            {'\n'}
          </span>
        ))}
      </pre>
      {reviewable ? (
        <div className="off-diff-review-actions">
          <textarea
            value={feedback}
            onChange={(event) => setFeedback(event.target.value)}
            placeholder="Describe the requested changes…"
            aria-label="Change request feedback"
          />
          <div>
            <button type="button" disabled={busy} onClick={onMerge}>
              Merge
            </button>
            <button type="button" disabled={busy} onClick={onDiscard}>
              Discard
            </button>
            <button
              type="button"
              disabled={busy || !feedback.trim()}
              onClick={() => onRequestChanges?.(feedback.trim())}
            >
              Request changes
            </button>
          </div>
        </div>
      ) : null}
    </section>
  );
}
