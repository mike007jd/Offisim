import { render, screen } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { MarketWorkspacePage } from '../../components/marketplace/workspace/MarketWorkspacePage.js';

const useListingDetailMock = vi.fn();

vi.mock('../../hooks/useListingDetail.js', () => ({
  useListingDetail: (...args: unknown[]) => useListingDetailMock(...args),
}));

vi.mock('../../components/marketplace/workspace/MarketWorkspaceExplore.js', () => ({
  MarketWorkspaceExplore: () => <div>explore</div>,
}));

vi.mock('../../components/marketplace/workspace/MarketWorkspaceManage.js', () => ({
  MarketWorkspaceManage: () => <div>manage</div>,
}));

vi.mock('../../components/marketplace/workspace/MarketWorkspaceDetail.js', () => ({
  MarketWorkspaceDetail: ({ detailUnavailable }: { detailUnavailable: boolean }) => (
    <div>{detailUnavailable ? 'unavailable-detail' : 'detail'}</div>
  ),
}));

vi.mock('../../components/marketplace/PublishDialog.js', () => ({
  PublishDialog: () => null,
}));

describe('MarketWorkspacePage', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    useListingDetailMock.mockReturnValue({
      detail: null,
      loading: false,
      unavailable: false,
    });
  });

  it('shows a non-blocking toast when the selected listing becomes unavailable', () => {
    useListingDetailMock.mockReturnValue({
      detail: null,
      loading: false,
      unavailable: true,
    });

    render(
      <MarketWorkspacePage
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

    expect(screen.getByTestId('workspace-market')).toBeInTheDocument();
    expect(screen.getByText('The selected listing is no longer available.')).toBeInTheDocument();
  });
});
