import type { PublishDraft } from '@offisim/registry-client';
import { Badge, EmptyState, Skeleton } from '@offisim/ui-core';
import { Store } from 'lucide-react';
import { useEffect, useState } from 'react';
import { useRegistryClient } from '../../hooks/useRegistryClient.js';
import { draftStatusLabel, draftStatusVariant } from '../../lib/status-display.js';

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
      <EmptyState
        icon={Store}
        title="Sign in to view your drafts"
        description="Publishing requires a marketplace account. Once you connect one, your drafts and published packages will appear here."
      />
    );
  }

  if (state === 'loading') {
    return (
      <div className="flex flex-col gap-2 p-4">
        {Array.from({ length: 3 }).map((_, i) => (
          // biome-ignore lint/suspicious/noArrayIndexKey: skeleton placeholder
          <Skeleton key={i} className="h-16 rounded-r-md" />
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
          className="rounded-r-md border border-line-soft bg-surface-1 p-4 shadow-elev-1"
        >
          <div className="flex items-start justify-between gap-3">
            <div className="min-w-0">
              <div className="truncate text-fs-sm font-semibold text-ink-1">
                {draft.title ?? draft.kind ?? 'Untitled draft'}
              </div>
              {draft.summary && (
                <div className="mt-0.5 truncate text-fs-meta text-ink-3">{draft.summary}</div>
              )}
              <div className="mt-1.5 flex flex-wrap items-center gap-2 text-fs-meta text-ink-4">
                {draft.kind && (
                  <Badge variant="secondary" size="xs">
                    {draft.kind}
                  </Badge>
                )}
                <span>Updated {new Date(draft.updated_at).toLocaleDateString()}</span>
              </div>
            </div>
            <Badge variant={draftStatusVariant(draft.status)} size="xs" className="shrink-0">
              {draftStatusLabel(draft.status)}
            </Badge>
          </div>
        </div>
      ))}
    </div>
  );
}
