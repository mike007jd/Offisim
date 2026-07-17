import {
  type ReviewAnnotation,
  type ReviewSummary,
  type ReviewWorkbenchState,
  buildReturnedReviewPatch,
  reconcileReviewState,
  summarizeReview,
} from '@/data/review-workbench.js';
import type {
  UnifiedDiffDocument,
  UnifiedDiffFile,
  UnifiedDiffHunk,
  UnifiedDiffLine,
} from '@/data/unified-diff.js';
import { cn } from '@/lib/utils.js';
import { useVirtualizer } from '@tanstack/react-virtual';
import { Check, ChevronDown, ChevronRight, MessageSquare, RotateCcw } from 'lucide-react';
import { useEffect, useMemo, useRef, useState } from 'react';

export interface ReviewChangeRequest {
  feedback: string;
  review: ReviewWorkbenchState;
  annotations: ReviewAnnotation[];
  returnedPatch: string;
}

export interface DiffPanelProps {
  document: UnifiedDiffDocument;
  mode: 'review' | 'readonly';
  initialPath?: string | null;
  busy?: boolean;
  review?: ReviewWorkbenchState | null;
  onReviewChange?: (review: ReviewWorkbenchState) => void | Promise<void>;
  onMerge?: (summary: ReviewSummary) => void;
  onDiscard?: () => void;
  onRequestChanges?: (request: ReviewChangeRequest) => void | Promise<void>;
  mergeLabel?: string;
  discardLabel?: string;
}

interface AnnotationTarget {
  file: UnifiedDiffFile;
  hunk: UnifiedDiffHunk | null;
  line: UnifiedDiffLine | null;
  label: string;
}

function pathGroup(path: string): string {
  const index = path.indexOf('/');
  return index < 0 ? 'Root' : path.slice(0, index);
}

function pairedLines(hunk: UnifiedDiffHunk): Array<{
  old: UnifiedDiffLine | null;
  next: UnifiedDiffLine | null;
}> {
  const rows: Array<{ old: UnifiedDiffLine | null; next: UnifiedDiffLine | null }> = [];
  let index = 0;
  while (index < hunk.lines.length) {
    const line = hunk.lines[index];
    if (!line) break;
    if (line.kind !== 'remove') {
      rows.push({ old: line.kind === 'add' ? null : line, next: line });
      index += 1;
      continue;
    }
    const removed: UnifiedDiffLine[] = [];
    const added: UnifiedDiffLine[] = [];
    while (hunk.lines[index]?.kind === 'remove')
      removed.push(hunk.lines[index++] as UnifiedDiffLine);
    while (hunk.lines[index]?.kind === 'add') added.push(hunk.lines[index++] as UnifiedDiffLine);
    const count = Math.max(removed.length, added.length);
    for (let pair = 0; pair < count; pair += 1) {
      rows.push({ old: removed[pair] ?? null, next: added[pair] ?? null });
    }
  }
  return rows;
}

function LineButton({
  line,
  side,
  readonly,
  onAnnotate,
}: {
  line: UnifiedDiffLine | null;
  side: 'old' | 'new';
  readonly: boolean;
  onAnnotate: (line: UnifiedDiffLine) => void;
}) {
  if (!line) return <span className="off-review-line is-empty" aria-hidden="true" />;
  const number = side === 'old' ? line.oldLine : line.newLine;
  return (
    <span className={cn('off-review-line', `is-${line.kind}`)}>
      <span className="off-review-line-number">{number ?? ''}</span>
      <span className="off-review-line-mark">
        {line.kind === 'add' ? '+' : line.kind === 'remove' ? '−' : ' '}
      </span>
      <code>{line.text || ' '}</code>
      {readonly ? null : (
        <button
          type="button"
          className="off-review-line-comment off-focusable"
          aria-label={`Comment on ${side} line ${number ?? ''}`}
          onClick={() => onAnnotate(line)}
        >
          <MessageSquare size={12} />
        </button>
      )}
    </span>
  );
}

function HunkView({
  file,
  hunk,
  display,
  collapsed,
  readonly,
  decision,
  supportsPartialPatch,
  onToggle,
  onAccept,
  onAnnotate,
}: {
  file: UnifiedDiffFile;
  hunk: UnifiedDiffHunk;
  display: 'unified' | 'split';
  collapsed: boolean;
  readonly: boolean;
  decision: string | undefined;
  supportsPartialPatch: boolean;
  onToggle: () => void;
  onAccept: () => void;
  onAnnotate: (target: AnnotationTarget) => void;
}) {
  return (
    <article className={cn('off-review-hunk', decision && `is-${decision}`)}>
      <header className="off-review-hunk-header">
        <button type="button" className="off-review-hunk-toggle off-focusable" onClick={onToggle}>
          {collapsed ? <ChevronRight size={14} /> : <ChevronDown size={14} />}
          <code>{hunk.header}</code>
        </button>
        <span className="off-review-hunk-stat">
          +{hunk.additions} −{hunk.deletions}
        </span>
        {!readonly ? (
          <span className="off-review-hunk-actions">
            {supportsPartialPatch ? (
              <button type="button" className="off-focusable" onClick={onAccept}>
                <Check size={13} /> Accept hunk
              </button>
            ) : null}
            <button
              type="button"
              className="off-focusable"
              onClick={() => onAnnotate({ file, hunk, line: null, label: hunk.header })}
            >
              <RotateCcw size={13} /> {supportsPartialPatch ? 'Return' : 'Return file'}
            </button>
          </span>
        ) : null}
      </header>
      {!collapsed ? (
        display === 'split' ? (
          <div className="off-review-split" aria-label={`Split diff for ${file.path}`}>
            {pairedLines(hunk).map((row, index) => (
              <div className="off-review-split-row" key={`${hunk.id}-pair-${index}`}>
                <LineButton
                  line={row.old}
                  side="old"
                  readonly={readonly}
                  onAnnotate={(line) =>
                    onAnnotate({
                      file,
                      hunk,
                      line,
                      label: `${hunk.header} · old line ${line.oldLine ?? '?'}`,
                    })
                  }
                />
                <LineButton
                  line={row.next}
                  side="new"
                  readonly={readonly}
                  onAnnotate={(line) =>
                    onAnnotate({
                      file,
                      hunk,
                      line,
                      label: `${hunk.header} · new line ${line.newLine ?? '?'}`,
                    })
                  }
                />
              </div>
            ))}
          </div>
        ) : (
          <div className="off-review-unified" aria-label={`Unified diff for ${file.path}`}>
            {hunk.lines.map((line) => (
              <LineButton
                key={line.id}
                line={line}
                side={line.kind === 'remove' ? 'old' : 'new'}
                readonly={readonly}
                onAnnotate={(selectedLine) =>
                  onAnnotate({
                    file,
                    hunk,
                    line: selectedLine,
                    label: `${hunk.header} · line ${selectedLine.newLine ?? selectedLine.oldLine ?? '?'}`,
                  })
                }
              />
            ))}
          </div>
        )
      ) : null}
    </article>
  );
}

export function DiffPanel({
  document,
  mode,
  initialPath,
  busy,
  review: persistedReview,
  onReviewChange,
  onMerge,
  onDiscard,
  onRequestChanges,
  mergeLabel = 'Merge accepted',
  discardLabel = 'Discard task',
}: DiffPanelProps) {
  const readonly = mode === 'readonly';
  const [selectedPath, setSelectedPath] = useState(initialPath ?? document.files[0]?.path ?? '');
  const [display, setDisplay] = useState<'unified' | 'split'>('unified');
  const [collapsed, setCollapsed] = useState<Set<string>>(() => new Set());
  const [review, setReview] = useState(() => reconcileReviewState(document, persistedReview));
  const [annotationTarget, setAnnotationTarget] = useState<AnnotationTarget | null>(null);
  const [annotationBody, setAnnotationBody] = useState('');
  const scrollRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    setReview((current) => reconcileReviewState(document, current));
  }, [document]);
  useEffect(() => {
    setSelectedPath((current) => {
      if (initialPath && document.files.some((file) => file.path === initialPath)) {
        return initialPath;
      }
      return document.files.some((file) => file.path === current)
        ? current
        : (document.files[0]?.path ?? '');
    });
  }, [document.files, initialPath]);

  const selected =
    document.files.find((file) => file.path === selectedPath) ?? document.files[0] ?? null;
  const groups = useMemo(() => {
    const byGroup = new Map<string, UnifiedDiffFile[]>();
    for (const file of document.files) {
      const group = pathGroup(file.path);
      const files = byGroup.get(group);
      if (files) files.push(file);
      else byGroup.set(group, [file]);
    }
    return [...byGroup.entries()];
  }, [document.files]);
  const virtualizer = useVirtualizer({
    count: selected?.hunks.length ?? 0,
    getScrollElement: () => scrollRef.current,
    estimateSize: (index) => {
      const hunk = selected?.hunks[index];
      return collapsed.has(hunk?.id ?? '')
        ? 42
        : Math.min(680, 92 + (hunk?.lines.length ?? 0) * 24);
    },
    overscan: 3,
  });

  const commitReview = (next: ReviewWorkbenchState) => {
    setReview(next);
    void onReviewChange?.(next);
  };
  const setDecision = (hunkIds: string[], decision: 'accepted' | 'returned') => {
    commitReview({
      ...review,
      revision: document.revision,
      decisions: {
        ...review.decisions,
        ...Object.fromEntries(hunkIds.map((id) => [id, decision])),
      },
    });
  };
  const saveAnnotation = () => {
    if (!annotationTarget || !annotationBody.trim()) return;
    const annotation: ReviewAnnotation = {
      id: crypto.randomUUID(),
      fileId: annotationTarget.file.id,
      hunkId: annotationTarget.hunk?.id ?? annotationTarget.file.id,
      lineId: annotationTarget.line?.id ?? null,
      path: annotationTarget.file.path,
      label: annotationTarget.label,
      body: annotationBody.trim(),
      state: 'draft',
    };
    const hunkIds =
      annotationTarget.hunk && annotationTarget.file.supportsPartialPatch
        ? [annotationTarget.hunk.id]
        : [annotationTarget.file.id];
    commitReview({
      ...review,
      revision: document.revision,
      decisions: {
        ...review.decisions,
        ...Object.fromEntries(hunkIds.map((id) => [id, 'returned'])),
      },
      annotations: [...review.annotations, annotation],
    });
    setAnnotationTarget(null);
    setAnnotationBody('');
  };
  const submitAnnotations = async () => {
    const pending = review.annotations.filter((annotation) => annotation.state === 'draft');
    if (pending.length === 0) return;
    const next = {
      ...review,
      annotations: review.annotations.map((annotation) =>
        annotation.state === 'draft' ? { ...annotation, state: 'submitted' as const } : annotation,
      ),
    };
    setReview(next);
    try {
      await onRequestChanges?.({
        feedback: pending
          .map((annotation) => `${annotation.path} · ${annotation.label}: ${annotation.body}`)
          .join('\n'),
        review: next,
        annotations: pending,
        returnedPatch: buildReturnedReviewPatch(document, next),
      });
    } catch {
      setReview(review);
    }
  };

  const summary = summarizeReview(document, review);
  const allAccepted =
    document.files.length > 0 &&
    document.files.every((file) =>
      file.supportsPartialPatch && file.hunks.length > 0
        ? file.hunks.every((hunk) => review.decisions[hunk.id] === 'accepted')
        : review.decisions[file.id] === 'accepted',
    );
  const draftCount = review.annotations.filter((annotation) => annotation.state === 'draft').length;

  return (
    <section
      className={cn('off-diff-panel', readonly ? 'is-readonly' : 'is-actionable')}
      aria-label="Review workbench"
    >
      <aside className="off-review-tree" aria-label="Changed files">
        <div className="off-review-tree-summary">
          <strong>{document.files.length} files</strong>
          <span className="is-add">+{document.additions}</span>
          <span className="is-remove">−{document.deletions}</span>
        </div>
        {document.files.length === 0 ? (
          <p className="off-task-detail-note">No patch was reported.</p>
        ) : null}
        {groups.map(([group, files]) => (
          <div className="off-review-tree-group" key={group}>
            <span>{group}</span>
            {files.map((file) => (
              <button
                type="button"
                aria-pressed={file.path === selected?.path}
                className={cn(
                  'off-diff-file off-focusable',
                  file.path === selected?.path && 'is-active',
                )}
                key={file.id}
                onClick={() => setSelectedPath(file.path)}
              >
                <span className={cn('off-review-file-status', `is-${file.status}`)}>
                  {file.status.slice(0, 1).toUpperCase()}
                </span>
                <span>{file.path.split('/').at(-1)}</span>
                <small>
                  +{file.additions} −{file.deletions}
                </small>
              </button>
            ))}
          </div>
        ))}
      </aside>

      <div className="off-review-main">
        <header className="off-review-toolbar">
          <div>
            <strong>{selected?.path ?? 'No file selected'}</strong>
            {readonly ? <span className="off-review-readonly">Read-only</span> : null}
          </div>
          <fieldset className="off-review-mode">
            <legend>Diff layout</legend>
            <button
              type="button"
              aria-pressed={display === 'unified'}
              onClick={() => setDisplay('unified')}
            >
              Unified
            </button>
            <button
              type="button"
              aria-pressed={display === 'split'}
              onClick={() => setDisplay('split')}
            >
              Split
            </button>
          </fieldset>
          {!readonly && selected ? (
            <div className="off-review-file-actions">
              <button
                type="button"
                onClick={() =>
                  setDecision(
                    selected.supportsPartialPatch && selected.hunks.length > 0
                      ? selected.hunks.map((hunk) => hunk.id)
                      : [selected.id],
                    'accepted',
                  )
                }
              >
                <Check size={13} /> Accept file
              </button>
              <button
                type="button"
                onClick={() =>
                  setAnnotationTarget({
                    file: selected,
                    hunk: null,
                    line: null,
                    label: 'Entire file',
                  })
                }
              >
                <RotateCcw size={13} /> Return file
              </button>
            </div>
          ) : null}
        </header>

        {selected?.binary ? (
          <div className="off-review-binary">Binary file changed · textual review unavailable.</div>
        ) : (
          <div className="off-review-scroll" ref={scrollRef}>
            <div className="off-review-virtual" style={{ height: virtualizer.getTotalSize() }}>
              {virtualizer.getVirtualItems().map((item) => {
                const hunk = selected?.hunks[item.index];
                if (!selected || !hunk) return null;
                return (
                  <div
                    key={hunk.id}
                    ref={virtualizer.measureElement}
                    data-index={item.index}
                    className="off-review-virtual-item"
                    style={{ transform: `translateY(${item.start}px)` }}
                  >
                    <HunkView
                      file={selected}
                      hunk={hunk}
                      display={display}
                      collapsed={collapsed.has(hunk.id)}
                      readonly={readonly}
                      decision={
                        review.decisions[selected.supportsPartialPatch ? hunk.id : selected.id]
                      }
                      supportsPartialPatch={selected.supportsPartialPatch}
                      onToggle={() =>
                        setCollapsed((current) => {
                          const next = new Set(current);
                          if (next.has(hunk.id)) next.delete(hunk.id);
                          else next.add(hunk.id);
                          return next;
                        })
                      }
                      onAccept={() => setDecision([hunk.id], 'accepted')}
                      onAnnotate={setAnnotationTarget}
                    />
                  </div>
                );
              })}
            </div>
          </div>
        )}
      </div>

      <aside className="off-diff-review-actions" aria-label="Review notes and actions">
        <header className="off-review-inspector-head">
          <span>{readonly ? 'Review context' : 'Review notes'}</span>
          <strong>{readonly ? 'Read-only' : `${summary.openAnnotations} open`}</strong>
        </header>
        {readonly ? (
          <div className="off-review-readonly-summary">
            <div>
              <span>Files</span>
              <strong>{document.files.length}</strong>
            </div>
            <div>
              <span>Hunks</span>
              <strong>
                {document.files.reduce((count, file) => count + file.hunks.length, 0)}
              </strong>
            </div>
            <div>
              <span>Delta</span>
              <strong>
                +{document.additions} −{document.deletions}
              </strong>
            </div>
            <p>Inspection only. Open a pending delegated lease to annotate or accept changes.</p>
          </div>
        ) : (
          <>
            <div className="off-review-annotation-list">
              {review.annotations.length === 0 ? (
                <p className="off-review-annotation-empty">
                  Comment on a line, hunk, or file to send an exact rework instruction.
                </p>
              ) : null}
              {review.annotations.map((annotation) => (
                <div
                  className={cn('off-review-annotation', `is-${annotation.state}`)}
                  key={annotation.id}
                >
                  <MessageSquare size={13} />
                  <span>
                    <strong>{annotation.path}</strong> · {annotation.label}
                    <br />
                    {annotation.body}
                  </span>
                  <em>
                    {annotation.state === 'resolved'
                      ? 'Handled'
                      : annotation.state === 'submitted'
                        ? 'Steered'
                        : 'Draft'}
                  </em>
                </div>
              ))}
            </div>
            {annotationTarget ? (
              <div className="off-review-comment-composer">
                <label htmlFor="review-comment">
                  Return · {annotationTarget.file.path} · {annotationTarget.label}
                </label>
                <textarea
                  id="review-comment"
                  value={annotationBody}
                  onChange={(event) => setAnnotationBody(event.target.value)}
                  placeholder="Describe the exact change for the employee…"
                />
                <div>
                  <button type="button" onClick={() => setAnnotationTarget(null)}>
                    Cancel
                  </button>
                  <button type="button" disabled={!annotationBody.trim()} onClick={saveAnnotation}>
                    Add annotation
                  </button>
                </div>
              </div>
            ) : null}
            <div className="off-review-final-actions">
              <button type="button" disabled={busy} onClick={onDiscard}>
                {discardLabel}
              </button>
              <button
                type="button"
                disabled={busy || draftCount === 0}
                onClick={() => void submitAnnotations()}
              >
                Steer {draftCount || ''} annotation{draftCount === 1 ? '' : 's'}
              </button>
              <button
                type="button"
                disabled={busy || !allAccepted || summary.openAnnotations > 0}
                onClick={() => onMerge?.(summary)}
              >
                {mergeLabel}
              </button>
            </div>
          </>
        )}
      </aside>
    </section>
  );
}
