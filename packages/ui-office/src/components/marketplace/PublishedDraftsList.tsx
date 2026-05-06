import type { PublishDraft } from '@offisim/registry-client';
import { EmptyState, Skeleton } from '@offisim/ui-core';
import { Store } from 'lucide-react';
import { useEffect, useState } from 'react';
import { useRegistryClient } from '../../hooks/useRegistryClient.js';

const STATUS_LABEL: Record<PublishDraft['status'], string> = {
  draft: 'Draft',
  validated: 'Validated',
  submitted: 'Submitted',
  approved: 'Approved',
  rejected: 'Rejected',
};

const STATUS_TONE: Record<PublishDraft['status'], string> = {
  draft: 'bg-surface-muted text-text-secondary',
  validated: 'bg-info-muted text-info',
  submitted: 'bg-info-muted text-info',
  approved: 'bg-success-muted text-success',
  rejected: 'bg-error-muted text-error',
};

export function PublishedDraftsList() {
  const client = useRegistryClient();
  const [drafts, setDrafts] = useState<PublishDraft[]>([]);
  const [state, setState] = useState<'idle' | 'loading' | 'ready' | 'unauth' | 'error'>(
    client.hasAuthToken ? 'loading' : 'unauth',
  );
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!client.hasAuthToken) {
      setState('unauth');
      return;
    }
    let cancelled = false;
    setState('loading');
    setError(null);
    client
      .listMyDrafts()
      .then((res) => {
        if (cancelled) return;
        setDrafts(res.drafts);
        setState('ready');
      })
      .catch((err: unknown) => {
        if (cancelled) return;
        setError(err instanceof Error ? err.message : 'Failed to load drafts');
        setState('error');
      });
    return () => {
      cancelled = true;
    };
  }, [client]);

  if (state === 'unauth') {
    return (
      <div className="flex flex-col items-center justify-center gap-3 px-4 py-16 text-center">
        <div className="flex h-12 w-12 items-center justify-center rounded-2xl border border-border-default bg-surface-muted">
          <Store className="h-5 w-5 text-text-muted" />
        </div>
        <p className="text-sm font-semibold text-text-primary">Sign in to view your drafts</p>
        <p className="max-w-sm text-xs text-text-secondary">
          Publishing requires a marketplace account. Once you connect one, your drafts and published
          packages will appear here.
        </p>
      </div>
    );
  }

  if (state === 'loading') {
    return (
      <div className="flex flex-col gap-2 p-4">
        {Array.from({ length: 3 }).map((_, i) => (
          // biome-ignore lint/suspicious/noArrayIndexKey: skeleton placeholder
          <Skeleton key={i} className="h-16 rounded-xl" />
        ))}
      </div>
    );
  }

  if (state === 'error') {
    return (
      <EmptyState
        variant="default"
        title="Couldn't load your drafts"
        description={error ?? 'Try again in a moment.'}
      />
    );
  }

  if (drafts.length === 0) {
    return (
      <EmptyState
        variant="default"
        title="No published packages yet"
        description="Use Publish from the toolbar to package an asset for the marketplace."
      />
    );
  }

  return (
    <div className="flex flex-col gap-2 p-4">
      {drafts.map((draft) => (
        <div
          key={draft.draft_id}
          className="rounded-xl border border-border-default bg-surface-elevated p-4"
        >
          <div className="flex items-start justify-between gap-3">
            <div className="min-w-0">
              <div className="truncate text-sm font-semibold text-text-primary">
                {draft.title ?? draft.kind ?? 'Untitled draft'}
              </div>
              {draft.summary && (
                <div className="mt-0.5 truncate text-xs text-text-secondary">{draft.summary}</div>
              )}
              <div className="mt-1.5 flex flex-wrap items-center gap-2 text-[11px] text-text-muted">
                {draft.kind && (
                  <span className="rounded-full bg-surface-muted px-2 py-0.5">{draft.kind}</span>
                )}
                <span>Updated {new Date(draft.updated_at).toLocaleDateString()}</span>
              </div>
            </div>
            <span
              className={`shrink-0 rounded-full px-2 py-0.5 text-[11px] font-medium ${STATUS_TONE[draft.status]}`}
            >
              {STATUS_LABEL[draft.status]}
            </span>
          </div>
        </div>
      ))}
    </div>
  );
}
