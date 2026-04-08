import { type ListingDetail, RegistryApiError } from '@offisim/registry-client';
import { useEffect, useState } from 'react';
import { useRegistryClient } from './useRegistryClient.js';

export interface UseListingDetailResult {
  detail: ListingDetail | null;
  loading: boolean;
  error: string | null;
  unavailable: boolean;
}

export function useListingDetail(listingId: string | null): UseListingDetailResult {
  const client = useRegistryClient();
  const [detail, setDetail] = useState<ListingDetail | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [unavailable, setUnavailable] = useState(false);

  useEffect(() => {
    if (!listingId) {
      setDetail(null);
      setLoading(false);
      setError(null);
      setUnavailable(false);
      return;
    }

    let cancelled = false;
    setDetail(null);
    setLoading(true);
    setError(null);
    setUnavailable(false);

    client
      .getListingDetail(listingId)
      .then((d) => {
        if (!cancelled) setDetail(d);
      })
      .catch((err) => {
        if (cancelled) return;
        if (err instanceof RegistryApiError && err.status === 404) {
          setUnavailable(true);
        } else {
          setError(err instanceof Error ? err.message : 'Failed to load listing');
        }
        setDetail(null);
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });

    return () => {
      cancelled = true;
    };
  }, [client, listingId]);

  return { detail, loading, error, unavailable };
}
