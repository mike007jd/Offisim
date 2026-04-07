import type { AssetKind } from '@offisim/asset-schema';
import type React from 'react';

import type { MarketSortOption } from '@offisim/ui-office';

// ---------------------------------------------------------------------------
// Workspace Keys
// ---------------------------------------------------------------------------

export type WorkspaceKey = 'office' | 'sops' | 'market' | 'activity-log';

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
  leftPaneMode: 'library' | 'active-runs';
  centerMode: 'empty' | 'definition' | 'run-focus';
  rightPaneTab: 'context' | 'runs' | 'history';
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

export type WorkspaceSessionState = {
  office: OfficeSessionState;
  sops: SopSessionState;
  market: MarketSessionState;
  activityLog: ActivityLogSessionState;
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
// Component Props
// ---------------------------------------------------------------------------

export interface WorkspaceRouterProps {
  activeWorkspace: WorkspaceKey;
  sessionState: WorkspaceSessionState;
  onSessionStateChange: (state: WorkspaceSessionState) => void;
  children?: React.ReactNode;
}

export interface WorkspacePageShellProps {
  eyebrow: string;
  title: string;
  actions?: React.ReactNode;
  loading?: boolean;
  error?: string;
  empty?: React.ReactNode;
  children: React.ReactNode;
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
    leftPaneMode: 'library',
    centerMode: 'empty',
    rightPaneTab: 'context',
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
  };
}
