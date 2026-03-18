'use client';

import type { PublishDraft } from '@aics/registry-client';
import { KindIcon } from './KindIcon.js';
import { formatDate } from '../lib/format.js';

const STATUS_BADGE: Record<
  PublishDraft['status'],
  { label: string; className: string }
> = {
  draft: { label: 'Draft', className: 'bg-[var(--bg-tertiary)] text-[var(--text-secondary)]' },
  validated: { label: 'Validated', className: 'bg-blue-100 text-blue-700' },
  submitted: { label: 'Submitted', className: 'bg-yellow-100 text-yellow-700' },
  approved: { label: 'Approved', className: 'bg-green-100 text-[var(--success)]' },
  rejected: { label: 'Rejected', className: 'bg-red-100 text-red-700' },
};

export interface DraftCardProps {
  draft: PublishDraft;
  onDelete?: (draftId: string) => void;
}

export function DraftCard({ draft, onDelete }: DraftCardProps) {
  const badge = STATUS_BADGE[draft.status];
  const title = draft.title?.trim() || 'Untitled Draft';
  const createdAt = formatDate(draft.created_at);

  function handleDelete() {
    if (window.confirm(`Delete draft "${title}"? This cannot be undone.`)) {
      onDelete?.(draft.draft_id);
    }
  }

  return (
    <div className="flex items-center justify-between gap-4 rounded-lg border border-[var(--border)] px-4 py-3">
      <div className="flex min-w-0 items-center gap-3">
        {draft.kind && <KindIcon kind={draft.kind} size={16} />}
        <div className="min-w-0">
          <p className="truncate text-sm font-medium text-[var(--text-primary)]">{title}</p>
          <p className="mt-0.5 text-xs text-[var(--text-muted)]">{createdAt}</p>
        </div>
      </div>

      <div className="flex shrink-0 items-center gap-3">
        <span className={`rounded-full px-2 py-0.5 text-xs font-medium ${badge.className}`}>
          {badge.label}
        </span>

        <a
          href={`/dashboard/publish?draft=${draft.draft_id}`}
          className="rounded border border-[var(--border-bright)] px-3 py-1 text-xs font-medium text-[var(--text-secondary)] hover:bg-[var(--bg-tertiary)]"
        >
          Edit
        </a>

        {onDelete && (
          <button
            type="button"
            onClick={handleDelete}
            className="rounded border border-red-200 px-3 py-1 text-xs font-medium text-[var(--accent-rose)] hover:bg-[var(--accent-rose)]/10"
          >
            Delete
          </button>
        )}
      </div>
    </div>
  );
}
