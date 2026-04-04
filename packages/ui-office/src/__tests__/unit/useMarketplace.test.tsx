import { act, renderHook, waitFor } from '@testing-library/react';
import { useMarketplace } from '../../hooks/useMarketplace.js';

const registryMocks = vi.hoisted(() => ({
  searchListings: vi.fn(),
}));

vi.mock('@offisim/registry-client', () => ({
  RegistryClient: vi.fn().mockImplementation(() => ({
    searchListings: registryMocks.searchListings,
  })),
}));

describe('useMarketplace', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    registryMocks.searchListings.mockResolvedValue({
      items: [],
      page: 1,
      per_page: 12,
      total: 0,
    });
  });

  it('loads search results and applies query + kind filters', async () => {
    registryMocks.searchListings.mockResolvedValueOnce({
      items: [
        {
          listing_id: 'listing-1',
          slug: 'writer-pro',
          kind: 'employee',
          title: 'Writer Pro',
          summary: 'Writer package',
          creator: {
            creator_id: 'creator-1',
            handle: 'mike',
            display_name: 'Mike',
            verification_state: 'verified',
          },
          status: 'listed',
          latest_version: '1.0.0',
          rating: 4.8,
          install_count: 120,
        },
      ],
      page: 1,
      per_page: 12,
      total: 1,
    });

    const { result } = renderHook(() => useMarketplace());

    await waitFor(() => {
      expect(result.current.results).toHaveLength(1);
    });

    act(() => {
      result.current.setQuery('writer');
      result.current.setKind('employee');
    });

    await waitFor(() => {
      expect(registryMocks.searchListings).toHaveBeenLastCalledWith(
        expect.objectContaining({
          q: 'writer',
          kind: 'employee',
          page: 1,
          per_page: 12,
        }),
      );
    });
  });

  it('reports marketplace errors without throwing', async () => {
    registryMocks.searchListings.mockRejectedValueOnce(new Error('Failed to fetch'));

    const { result } = renderHook(() => useMarketplace());

    await waitFor(() => {
      expect(result.current.error).toContain('Failed to fetch');
    });
  });
});
