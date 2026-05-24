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
      <div className="market-published-drafts">
        {Array.from({ length: 3 }).map((_, i) => (
          // biome-ignore lint/suspicious/noArrayIndexKey: skeleton placeholder
          <Skeleton key={i} className="market-published-draft-skeleton" />
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
    <div className="market-published-drafts">
      {drafts.map((draft) => (
        <div key={draft.draft_id} className="market-published-draft">
          <div className="market-published-draft-top">
            <div className="market-published-draft-main">
              <div className="market-published-draft-title">
                {draft.title ?? draft.kind ?? 'Untitled draft'}
              </div>
              {draft.summary && (
                <div className="market-published-draft-summary">{draft.summary}</div>
              )}
              <div className="market-published-draft-meta">
                {draft.kind && (
                  <Badge variant="secondary" size="xs">
                    {draft.kind}
                  </Badge>
                )}
                <span>Updated {new Date(draft.updated_at).toLocaleDateString()}</span>
              </div>
            </div>
            <Badge
              variant={draftStatusVariant(draft.status)}
              size="xs"
              className="market-published-draft-status"
            >
              {draftStatusLabel(draft.status)}
            </Badge>
          </div>
        </div>
      ))}
    </div>
  );
}
