'use client';

import { useEffect, useState } from 'react';
import { DashboardStats, DraftCard, ListingCard, useAuthContext, PLATFORM_API_URL } from '@aics/ui-market';
import type { PublishDraft, ListingSummary } from '@aics/registry-client';
import { RegistryClient } from '@aics/registry-client';

function getClient() {
  return new RegistryClient({ baseUrl: PLATFORM_API_URL, credentials: 'include' });
}

export default function DashboardPage() {
  const { user, isLoading: authLoading } = useAuthContext();

  const [listings, setListings] = useState<ListingSummary[]>([]);
  const [drafts, setDrafts] = useState<PublishDraft[]>([]);
  const [totalInstalls, setTotalInstalls] = useState(0);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (authLoading || !user) return;

    const client = getClient();
    setLoading(true);
    setError(null);

    Promise.all([
      // Fetch my creator profile to get handle, then fetch listings
      fetch(`${PLATFORM_API_URL}/v1/publish/me`, {
        credentials: 'include',
      })
        .then((r) => r.json())
        .then(async (data: { creator: { handle: string } | null }) => {
          if (!data.creator) return [];
          const profile = await client.getCreatorProfile(data.creator.handle);
          return profile.listings;
        }),
      client.listMyDrafts(),
    ])
      .then(([creatorListings, draftsRes]) => {
        setListings(creatorListings);
        setDrafts(draftsRes.drafts);
        const installs = creatorListings.reduce((sum, l) => sum + (l.install_count ?? 0), 0);
        setTotalInstalls(installs);
      })
      .catch((err) => {
        setError(err instanceof Error ? err.message : 'Failed to load dashboard data');
      })
      .finally(() => setLoading(false));
  }, [user, authLoading]);

  async function handleDeleteDraft(draftId: string) {
    const previousDrafts = drafts;
    setDrafts((prev) => prev.filter((d) => d.draft_id !== draftId));

    try {
      const client = getClient();
      await client.deleteMyDraft(draftId);
    } catch (err) {
      setDrafts(previousDrafts);
      setError(err instanceof Error ? err.message : 'Failed to delete draft');
    }
  }

  if (loading) {
    return (
      <div className="flex items-center justify-center py-24">
        <span className="text-sm text-[var(--text-muted)]">Loading dashboard…</span>
      </div>
    );
  }

  if (error) {
    return (
      <div className="rounded-md bg-[var(--accent-rose)]/10 px-4 py-3 text-sm text-[var(--accent-rose)]">
        {error}
      </div>
    );
  }

  const activeDrafts = drafts.filter((d) => d.status !== 'approved' && d.status !== 'rejected');

  return (
    <div className="space-y-10">
      <div className="flex items-center justify-between">
        <h1 className="font-display text-2xl font-bold text-[var(--text-primary)]">Dashboard</h1>
        <a
          href="/dashboard/publish"
          className="rounded-md bg-[var(--accent-indigo)] px-4 py-2 text-sm font-medium text-white hover:opacity-90 transition-opacity"
        >
          New Listing
        </a>
      </div>

      <DashboardStats
        publishedCount={listings.filter((l) => l.status === 'listed').length}
        draftCount={activeDrafts.length}
        totalInstalls={totalInstalls}
      />

      <section>
        <h2 className="mb-4 font-display text-lg font-semibold text-[var(--text-primary)]">Your Listings</h2>
        {listings.length > 0 ? (
          <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
            {listings.map((listing) => (
              <ListingCard key={listing.listing_id} listing={listing} />
            ))}
          </div>
        ) : (
          <div className="rounded-lg border border-dashed border-[var(--border-bright)] py-10 text-center">
            <p className="text-sm text-[var(--text-muted)]">No published listings yet.</p>
            <a
              href="/dashboard/publish"
              className="mt-3 inline-block text-sm font-medium text-[var(--accent-indigo)] hover:underline"
            >
              Create your first listing
            </a>
          </div>
        )}
      </section>

      <section>
        <h2 className="mb-4 font-display text-lg font-semibold text-[var(--text-primary)]">Drafts</h2>
        {drafts.length > 0 ? (
          <div className="flex flex-col gap-2">
            {drafts.map((draft) => (
              <DraftCard key={draft.draft_id} draft={draft} onDelete={handleDeleteDraft} />
            ))}
          </div>
        ) : (
          <div className="rounded-lg border border-dashed border-[var(--border-bright)] py-10 text-center">
            <p className="text-sm text-[var(--text-muted)]">No drafts yet.</p>
          </div>
        )}
      </section>
    </div>
  );
}
