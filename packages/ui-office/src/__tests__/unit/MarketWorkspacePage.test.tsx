import { render, screen } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { MarketPage } from '../../components/marketplace/MarketPage.js';

const useListingDetailMock = vi.fn();
const useMarketplaceMock = vi.fn();

vi.mock('../../hooks/useListingDetail.js', () => ({
  useListingDetail: (...args: unknown[]) => useListingDetailMock(...args),
}));

vi.mock('../../hooks/useMarketplace.js', () => ({
  useMarketplace: () => useMarketplaceMock(),
}));

vi.mock('../../components/marketplace/PublishDialog.js', () => ({
  PublishDialog: () => null,
}));

describe('MarketPage', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    useListingDetailMock.mockReturnValue({
      detail: null,
      loading: false,
      error: null,
      unavailable: false,
    });
    useMarketplaceMock.mockReturnValue({
      results: [],
      query: '',
      setQuery: vi.fn(),
      filters: { kind: 'all', sort: 'relevance' },
      setKind: vi.fn(),
      setSort: vi.fn(),
      isLoading: false,
      isLoadingMore: false,
      error: null,
      hasMore: false,
      loadMore: vi.fn(),
      refresh: vi.fn(),
    });
  });

  it('shows a toast when the selected listing becomes unavailable', () => {
    useListingDetailMock.mockReturnValue({
      detail: null,
      loading: false,
      error: null,
      unavailable: true,
    });

    render(
      <MarketPage
        sessionState={{
          mode: 'explore',
          selectedListingId: 'missing-listing',
          search: '',
          sort: 'relevance',
          kind: 'all',
          manageTab: 'installed',
        }}
        onSessionStateChange={vi.fn()}
      />,
    );

    expect(screen.getAllByText('Listing unavailable').length).toBeGreaterThanOrEqual(1);
  });
});
