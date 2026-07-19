import type { ManageView, MarketMode } from '@/data/market/types.js';
import { create } from 'zustand';

export type SortKey = 'relevance' | 'newest' | 'rating' | 'installs';

interface MarketUiState {
  mode: MarketMode;
  manageView: ManageView;

  setMode: (mode: MarketMode) => void;
  setManageView: (view: ManageView) => void;
}

/** Market-local ephemeral UI state. The global `ui-state.selectedListingId`
 *  stays the SSOT for which card is open; this store only owns Market chrome
 *  (mode / manage view). Install state must come from registry/local package
 *  repositories, not an optimistic session set. */
export const useMarketUi = create<MarketUiState>((set) => ({
  mode: 'explore',
  manageView: 'installed',

  setMode: (mode) => set({ mode }),
  setManageView: (manageView) => set({ manageView }),
}));
