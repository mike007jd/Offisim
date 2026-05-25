import { create } from 'zustand';
import type { ManageView, MarketMode } from './market-data.js';

export type SortKey = 'relevance' | 'newest' | 'rating' | 'installs';

interface MarketUiState {
  mode: MarketMode;
  manageView: ManageView;
  /** Listing ids installed during this session, layered over fixture state. */
  sessionInstalledIds: Set<string>;

  setMode: (mode: MarketMode) => void;
  setManageView: (view: ManageView) => void;
  markInstalled: (listingId: string) => void;
}

/** Market-local ephemeral UI state. The global `ui-state.selectedListingId`
 *  stays the SSOT for which card is open; this store only owns Market chrome
 *  (mode / manage view) and the optimistic post-install set. */
export const useMarketUi = create<MarketUiState>((set) => ({
  mode: 'explore',
  manageView: 'installed',
  sessionInstalledIds: new Set<string>(),

  setMode: (mode) => set({ mode }),
  setManageView: (manageView) => set({ manageView }),
  markInstalled: (listingId) =>
    set((s) => {
      const next = new Set(s.sessionInstalledIds);
      next.add(listingId);
      return { sessionInstalledIds: next };
    }),
}));
