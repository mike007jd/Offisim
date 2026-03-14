'use client';

import { useEffect, useState } from 'react';
import { DashboardStats, DraftCard, ListingCard, useAuthContext } from '@aics/ui-market';
import type { PublishDraft, ListingSummary } from '@aics/registry-client';
import { RegistryClient } from '@aics/registry-client';

const PLATFORM_API_URL =
  process.env.NEXT_PUBLIC_PLATFORM_API_URL ?? process.env.NEXT_PUBLIC_PLATFORM_URL ?? 'http://localhost:4100';

function getClient(token: string) {
  return new RegistryClient({ baseUrl: PLATFORM_API_URL, authToken: token });
}

export default function DashboardPage() {
  const { token } = useAuthContext();

  const [listings, setListings] = useState<ListingSummary[]>([]);
  const [drafts, setDrafts] = useState<PublishDraft[]>([]);
  const [totalInstalls, setTotalInstalls] = useState(0);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!token) return;

    const client = getClient(token);
    setLoading(true);
    setError(null);

    Promise.all([
      // Fetch my creator profile to get handle, then fetch listings
      fetch(`${PLATFORM_API_URL}/v1/publish/me`, {
        headers: { Authorization: `Bearer ${token}` },
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
  }, [token]);

  async function handleDeleteDraft(draftId: string) {
    // Optimistically remove from list — deletion endpoint not yet implemented,
    // so we just update local state. A real delete endpoint would be wired here.
    setDrafts((prev) => prev.filter((d) => d.draft_id !== draftId));
  }

  if (loading) {
    return (
      <div className="flex items-center justify-center py-24">
        <span className="text-sm text-gray-400">Loading dashboard…</span>
      </div>
    );
  }

  if (error) {
    return (
      <div className="rounded-md bg-red-50 px-4 py-3 text-sm text-red-600">
        {error}
      </div>
    );
  }

  const activeDrafts = drafts.filter((d) => d.status !== 'approved' && d.status !== 'rejected');

  return (
    <div className="space-y-10">
      <div className="flex items-center justify-between">
        <h1 className="text-2xl font-bold text-gray-900">Dashboard</h1>
        <a
          href="/dashboard/publish"
          className="rounded-md bg-blue-600 px-4 py-2 text-sm font-medium text-white hover:bg-blue-700"
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
        <h2 className="mb-4 text-lg font-semibold text-gray-900">Your Listings</h2>
        {listings.length > 0 ? (
          <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
            {listings.map((listing) => (
              <ListingCard key={listing.listing_id} listing={listing} />
            ))}
          </div>
        ) : (
          <div className="rounded-lg border border-dashed border-gray-300 py-10 text-center">
            <p className="text-sm text-gray-500">No published listings yet.</p>
            <a
              href="/dashboard/publish"
              className="mt-3 inline-block text-sm font-medium text-blue-600 hover:underline"
            >
              Create your first listing
            </a>
          </div>
        )}
      </section>

      <section>
        <h2 className="mb-4 text-lg font-semibold text-gray-900">Drafts</h2>
        {drafts.length > 0 ? (
          <div className="flex flex-col gap-2">
            {drafts.map((draft) => (
              <DraftCard key={draft.draft_id} draft={draft} onDelete={handleDeleteDraft} />
            ))}
          </div>
        ) : (
          <div className="rounded-lg border border-dashed border-gray-300 py-10 text-center">
            <p className="text-sm text-gray-500">No drafts yet.</p>
          </div>
        )}
      </section>
    </div>
  );
}
