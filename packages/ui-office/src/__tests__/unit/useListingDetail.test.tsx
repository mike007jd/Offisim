import { renderHook, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { useListingDetail } from '../../hooks/useListingDetail.js';

function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (reason?: unknown) => void;
  const promise = new Promise<T>((res, rej) => {
    resolve = res;
    reject = rej;
  });
  return { promise, resolve, reject };
}

const registryMocks = vi.hoisted(() => {
  class TestRegistryApiError extends Error {
    status: number;

    constructor(status: number, message: string) {
      super(message);
      this.status = status;
    }
  }

  return {
    getListingDetail: vi.fn(),
    RegistryApiError: TestRegistryApiError,
  };
});

vi.mock('@offisim/registry-client', () => ({
  RegistryApiError: registryMocks.RegistryApiError,
}));

vi.mock('../../hooks/useRegistryClient.js', () => ({
  useRegistryClient: () => ({
    getListingDetail: registryMocks.getListingDetail,
  }),
}));

describe('useListingDetail', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('clears stale detail immediately when switching to a new listing id', async () => {
    const firstRequest = deferred<{
      listing_id: string;
      title: string;
      latest_version: string;
    }>();
    const secondRequest = deferred<{
      listing_id: string;
      title: string;
      latest_version: string;
    }>();

    registryMocks.getListingDetail.mockImplementation((listingId: string) => {
      if (listingId === 'listing-1') return firstRequest.promise;
      if (listingId === 'listing-2') return secondRequest.promise;
      return Promise.reject(new Error(`Unexpected listing id: ${listingId}`));
    });

    const { result, rerender } = renderHook(({ listingId }) => useListingDetail(listingId), {
      initialProps: { listingId: 'listing-1' },
    });

    firstRequest.resolve({
      listing_id: 'listing-1',
      title: 'Listing One',
      latest_version: '1.0.0',
    });

    await waitFor(() => {
      expect(result.current.detail?.listing_id).toBe('listing-1');
    });

    rerender({ listingId: 'listing-2' });

    expect(result.current.loading).toBe(true);
    expect(result.current.detail).toBeNull();
    expect(result.current.error).toBeNull();
    expect(result.current.unavailable).toBe(false);

    secondRequest.resolve({
      listing_id: 'listing-2',
      title: 'Listing Two',
      latest_version: '2.0.0',
    });

    await waitFor(() => {
      expect(result.current.detail?.listing_id).toBe('listing-2');
    });
  });

  it('marks a 404 listing as unavailable without throwing', async () => {
    registryMocks.getListingDetail.mockImplementation(() =>
      Promise.reject(new registryMocks.RegistryApiError(404, 'Not found')),
    );

    const { result } = renderHook(() => useListingDetail('missing-listing'));

    await waitFor(() => {
      expect(result.current.unavailable).toBe(true);
    });

    expect(result.current.detail).toBeNull();
    expect(result.current.error).toBeNull();
    expect(result.current.loading).toBe(false);
  });
});
