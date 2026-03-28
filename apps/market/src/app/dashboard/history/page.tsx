'use client';

import { RegistryClient } from '@offisim/registry-client';
import type { LibraryItem } from '@offisim/registry-client';
import { HistoryList, PLATFORM_API_URL, useAuthContext } from '@offisim/ui-market';
import { useEffect, useState } from 'react';

export default function HistoryPage() {
  const { user, isLoading: authLoading } = useAuthContext();
  const [items, setItems] = useState<LibraryItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (authLoading || !user) {
      setLoading(false);
      return;
    }

    const client = new RegistryClient({ baseUrl: PLATFORM_API_URL, credentials: 'include' });
    client
      .getMyLibrary()
      .then((data) => {
        // Sort by saved_at descending (newest first)
        const sorted = [...data.items].sort(
          (a, b) => new Date(b.saved_at).getTime() - new Date(a.saved_at).getTime(),
        );
        setItems(sorted);
      })
      .catch((err) => {
        setError(err instanceof Error ? err.message : 'Failed to load history');
      })
      .finally(() => setLoading(false));
  }, [user, authLoading]);

  if (loading) {
    return (
      <div className="flex items-center justify-center py-24">
        <span className="text-sm text-[var(--text-muted)]">Loading history...</span>
      </div>
    );
  }

  if (error) {
    return (
      <div className="py-12 text-center">
        <p className="text-sm text-[var(--accent-rose)]">{error}</p>
      </div>
    );
  }

  return (
    <div>
      <h1 className="mb-6 font-display text-xl font-bold text-[var(--text-primary)]">
        Install History
      </h1>
      <HistoryList items={items} />
    </div>
  );
}
