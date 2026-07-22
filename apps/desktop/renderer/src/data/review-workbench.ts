export type ReviewDecision = 'pending' | 'accepted' | 'returned';

export interface ReviewAnnotation {
  id: string;
  fileId: string;
  hunkId: string;
  lineId: string | null;
  path: string;
  label: string;
  body: string;
  state: 'draft' | 'submitted' | 'resolved';
}

export interface ReviewWorkbenchState {
  revision: string;
  decisions: Record<string, ReviewDecision>;
  annotations: ReviewAnnotation[];
  appliedReturnAnchors?: string[];
}

export interface ReviewSummary {
  revision: string;
  files: number;
  additions: number;
  deletions: number;
  acceptedFiles: number;
  acceptedHunks: number;
  returnedHunks: number;
  resolvedAnnotations: number;
  openAnnotations: number;
  markdown: string;
}

function emptyReviewWorkbenchState(revision: string): ReviewWorkbenchState {
  return { revision, decisions: {}, annotations: [], appliedReturnAnchors: [] };
}

export function reconcileReviewState(
  document: UnifiedDiffDocument,
  previous: ReviewWorkbenchState | null | undefined,
): ReviewWorkbenchState {
  if (!previous) return emptyReviewWorkbenchState(document.revision);
  const liveAnchors = new Set(
    document.files.flatMap((file) => [file.id, ...file.hunks.map((hunk) => hunk.id)]),
  );
  const liveLines = new Set(
    document.files.flatMap((file) =>
      file.hunks.flatMap((hunk) => hunk.lines.map((line) => line.id)),
    ),
  );
  const decisions = Object.fromEntries(
    Object.entries(previous.decisions).filter(([id]) => liveAnchors.has(id)),
  );
  const appliedReturnAnchors = (previous.appliedReturnAnchors ?? []).filter((id) =>
    liveAnchors.has(id),
  );
  const annotations = previous.annotations.map((annotation) => {
    const anchorRemoved =
      (annotation.hunkId === annotation.fileId && !liveAnchors.has(annotation.fileId)) ||
      (annotation.lineId !== null && !liveLines.has(annotation.lineId)) ||
      (annotation.hunkId !== annotation.fileId && !liveAnchors.has(annotation.hunkId));
    return {
      ...annotation,
      state:
        annotation.state === 'submitted' && anchorRemoved
          ? ('resolved' as const)
          : annotation.state,
    };
  });
  return { revision: document.revision, decisions, annotations, appliedReturnAnchors };
}

export function markReturnedReviewPatchApplied(review: ReviewWorkbenchState): ReviewWorkbenchState {
  const applied = new Set(review.appliedReturnAnchors ?? []);
  for (const [anchor, decision] of Object.entries(review.decisions)) {
    if (decision === 'returned') applied.add(anchor);
  }
  return { ...review, appliedReturnAnchors: [...applied] };
}

export function summarizeReview(
  document: UnifiedDiffDocument,
  review: ReviewWorkbenchState,
): ReviewSummary {
  const acceptedHunks = Object.values(review.decisions).filter(
    (value) => value === 'accepted',
  ).length;
  const returnedHunks = Object.values(review.decisions).filter(
    (value) => value === 'returned',
  ).length;
  const acceptedFiles = document.files.filter((file) =>
    file.supportsPartialPatch && file.hunks.length > 0
      ? file.hunks.every((hunk) => review.decisions[hunk.id] === 'accepted')
      : review.decisions[file.id] === 'accepted',
  ).length;
  const resolvedAnnotations = review.annotations.filter((item) => item.state === 'resolved').length;
  const openAnnotations = review.annotations.length - resolvedAnnotations;
  return {
    revision: document.revision,
    files: document.files.length,
    additions: document.additions,
    deletions: document.deletions,
    acceptedFiles,
    acceptedHunks,
    returnedHunks,
    resolvedAnnotations,
    openAnnotations,
    markdown: [
      '## Self-review',
      '',
      `- Scope: ${document.files.length} files, +${document.additions} / -${document.deletions}`,
      `- Accepted: ${acceptedFiles} files, ${acceptedHunks} hunks`,
      `- Review annotations: ${resolvedAnnotations} handled, ${openAnnotations} open`,
      '- Review mode: structured unified/split diff with file and hunk decisions',
    ].join('\n'),
  };
}

export function buildReturnedReviewPatch(
  document: UnifiedDiffDocument,
  review: ReviewWorkbenchState,
): string {
  const applied = new Set(review.appliedReturnAnchors ?? []);
  return document.files
    .flatMap((file) => {
      if (file.binary) return [];
      const returnedHunks = file.hunks
        .filter((hunk) => review.decisions[hunk.id] === 'returned' && !applied.has(hunk.id))
        .map((hunk) => hunk.id);
      if (returnedHunks.length > 0) return [buildUnifiedPatch(file, returnedHunks)];
      return review.decisions[file.id] === 'returned' && !applied.has(file.id)
        ? [buildUnifiedPatch(file)]
        : [];
    })
    .filter(Boolean)
    .join('');
}
import { type UnifiedDiffDocument, buildUnifiedPatch } from '@/data/unified-diff.js';
