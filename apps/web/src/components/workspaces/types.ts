import type { AssetKind } from '@offisim/asset-schema';
import type React from 'react';

import type { MarketSortOption, ProviderConfig } from '@offisim/ui-office/web';

// ---------------------------------------------------------------------------
// Workspace Keys
// ---------------------------------------------------------------------------

export type WorkspaceKey = 'office' | 'sops' | 'market' | 'activity-log' | 'settings';

// ---------------------------------------------------------------------------
// Per-Workspace Session State
// ---------------------------------------------------------------------------

export type OfficeSessionState = {
  viewMode: '2D' | '3D';
  selectedEmployeeId: string | null;
  studioMode: 'create' | 'edit' | null;
};

export type SopSessionState = {
  selectedSopId: string | null;
  search: string;
};

export type MarketSessionState = {
  mode: 'explore' | 'manage';
  selectedListingId: string | null;
  search: string;
  sort: MarketSortOption;
  kind: AssetKind | 'all';
  manageTab: 'installed' | 'updates' | 'published';
};

export type ActivityLogSessionState = {
  selectedEventId: string | null;
  search: string;
  eventTypes: string[];
  actorFilters: string[];
  datePreset: 'today' | '7d' | '30d' | 'custom';
};

export type SettingsSessionState = {
  activeTab: 'provider' | 'runtime' | 'mcp';
};

export type WorkspaceSessionState = {
  office: OfficeSessionState;
  sops: SopSessionState;
  market: MarketSessionState;
  activityLog: ActivityLogSessionState;
  settings: SettingsSessionState;
};

// ---------------------------------------------------------------------------
// State Machine Union Types
// ---------------------------------------------------------------------------

export type MarketWorkspaceState =
  | { mode: 'explore-feed' }
  | { mode: 'explore-detail'; listingId: string }
  | { mode: 'manage-installed' }
  | { mode: 'manage-updates' }
  | { mode: 'manage-published' }
  | { mode: 'publishing' }
  | { mode: 'installing'; listingId: string };

export type ActivityLogFilters = {
  eventTypes: string[];
  actorFilters: string[];
  datePreset: 'today' | '7d' | '30d' | 'custom';
  search: string;
};

export type ActivityLogState =
  | { mode: 'timeline-default' }
  | { mode: 'timeline-filtered'; filters: ActivityLogFilters }
  | { mode: 'event-focused'; eventId: string };

// ---------------------------------------------------------------------------
// Responsive Layout
// ---------------------------------------------------------------------------

export type LayoutTier = 'desktop' | 'tablet' | 'narrow';

export type LayoutTierConfig = {
  tier: LayoutTier;
  leftRailDefault: 'visible' | 'collapsed';
  rightRailDefault: 'visible' | 'collapsed';
  workspaceLayout: 'three-pane' | 'two-pane-collapsible' | 'stacked-navigation';
};

/**
 * Pure, deterministic computation of the responsive layout tier.
 *
 * - narrow  : viewportWidth ≤ 768
 * - tablet  : 769 ≤ viewportWidth ≤ 1280
 * - desktop : viewportWidth > 1280
 */
export function computeLayoutTier(viewportWidth: number): LayoutTierConfig {
  if (viewportWidth <= 768) {
    return {
      tier: 'narrow',
      leftRailDefault: 'collapsed',
      rightRailDefault: 'collapsed',
      workspaceLayout: 'stacked-navigation',
    };
  }
  if (viewportWidth <= 1280) {
    return {
      tier: 'tablet',
      leftRailDefault: 'visible',
      rightRailDefault: 'collapsed',
      workspaceLayout: 'two-pane-collapsible',
    };
  }
  return {
    tier: 'desktop',
    leftRailDefault: 'visible',
    rightRailDefault: 'visible',
    workspaceLayout: 'three-pane',
  };
}

// ---------------------------------------------------------------------------
// Session State Key Mapping
// ---------------------------------------------------------------------------

export type SessionStateKeyMap = {
  office: 'office';
  sops: 'sops';
  market: 'market';
  'activity-log': 'activityLog';
  settings: 'settings';
};

export const SESSION_KEY: SessionStateKeyMap = {
  office: 'office',
  sops: 'sops',
  market: 'market',
  'activity-log': 'activityLog',
  settings: 'settings',
};

/**
 * Functional updater for a single workspace's session state slice.
 * Stable reference (empty deps) — safe to use in useCallback deps.
 */
export type UpdateWorkspaceStateFn = <K extends WorkspaceKey>(
  key: K,
  updater: (
    prev: WorkspaceSessionState[SessionStateKeyMap[K]],
  ) => WorkspaceSessionState[SessionStateKeyMap[K]],
) => void;

// ---------------------------------------------------------------------------
// Component Props
// ---------------------------------------------------------------------------

export interface WorkspaceRouterProps {
  activeWorkspace: WorkspaceKey;
  sessionState: WorkspaceSessionState;
  updateWorkspaceState: UpdateWorkspaceStateFn;
  settingsPageProps?: {
    onBack: () => void;
    onSave: (config: ProviderConfig) => void;
    onSaveSuccess?: () => void;
    onToast?: (message: string, variant?: 'info' | 'success' | 'error') => void;
  };
  children?: React.ReactNode;
}

// ---------------------------------------------------------------------------
// Default State Factories
// ---------------------------------------------------------------------------

export function createDefaultOfficeState(): OfficeSessionState {
  return {
    viewMode: '3D',
    selectedEmployeeId: null,
    studioMode: null,
  };
}

export function createDefaultSopState(): SopSessionState {
  return {
    selectedSopId: null,
    search: '',
  };
}

export function createDefaultMarketState(): MarketSessionState {
  return {
    mode: 'explore',
    selectedListingId: null,
    search: '',
    sort: 'relevance',
    kind: 'all',
    manageTab: 'installed',
  };
}

export function createDefaultActivityLogState(): ActivityLogSessionState {
  return {
    selectedEventId: null,
    search: '',
    eventTypes: [],
    actorFilters: [],
    datePreset: 'today',
  };
}

export function createDefaultSessionState(): WorkspaceSessionState {
  return {
    office: createDefaultOfficeState(),
    sops: createDefaultSopState(),
    market: createDefaultMarketState(),
    activityLog: createDefaultActivityLogState(),
    settings: { activeTab: 'provider' },
  };
}
