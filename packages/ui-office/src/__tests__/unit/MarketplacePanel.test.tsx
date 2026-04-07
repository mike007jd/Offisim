import { render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';

vi.mock('../../hooks/useMarketplace.js', () => ({
  useMarketplace: () => ({
    query: '',
    setQuery: vi.fn(),
    filters: { kind: 'all', sort: 'relevance' },
    setKind: vi.fn(),
    setSort: vi.fn(),
    results: [],
    isLoading: false,
    isLoadingMore: false,
    error: null,
    hasMore: false,
    loadMore: vi.fn(),
  }),
}));

vi.mock('./../../components/marketplace/InstalledList.js', () => ({
  InstalledList: () => <div>Installed list</div>,
}));

vi.mock('./../../components/marketplace/ListingCard.js', () => ({
  ListingCard: () => <div>Listing card</div>,
}));

vi.mock('./../../components/marketplace/PublishDialog.js', () => ({
  PublishDialog: () => null,
}));

import { MarketplacePanel } from '../../components/marketplace/MarketplacePanel.js';

describe('MarketplacePanel', () => {
  it('frames Market as ecosystem access rather than a store checkout surface', () => {
    render(<MarketplacePanel onOpenListing={vi.fn()} onStartInstall={vi.fn()} />);

    expect(screen.getByText('Ecosystem')).toBeInTheDocument();
    expect(
      screen.getByText('Browse shared capabilities and reusable building blocks'),
    ).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Share' })).toBeInTheDocument();
    expect(screen.getByText('No catalog entries match this view')).toBeInTheDocument();
  });
});
