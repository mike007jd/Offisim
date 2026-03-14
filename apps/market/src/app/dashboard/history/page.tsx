'use client';

import { useEffect, useState } from 'react';
import { HistoryList, useAuthContext, PLATFORM_API_URL } from '@aics/ui-market';
import { RegistryClient } from '@aics/registry-client';
import type { LibraryItem } from '@aics/registry-client';

export default function HistoryPage() {
  const { token } = useAuthContext();
  const [items, setItems] = useState<LibraryItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!token) {
      setLoading(false);
      return;
    }

    const client = new RegistryClient({ baseUrl: PLATFORM_API_URL, authToken: token });
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
  }, [token]);

  if (loading) {
    return (
      <div className="flex items-center justify-center py-24">
        <span className="text-sm text-gray-500">Loading history...</span>
      </div>
    );
  }

  if (error) {
    return (
      <div className="py-12 text-center">
        <p className="text-sm text-red-500">{error}</p>
      </div>
    );
  }

  return (
    <div>
      <h1 className="mb-6 text-xl font-bold text-gray-900">Install History</h1>
      <HistoryList items={items} />
    </div>
  );
}
