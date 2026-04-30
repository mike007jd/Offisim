import type { AssetKind } from '@offisim/asset-schema';
import type React from 'react';

import type {
  LayoutTier,
  LayoutTierConfig,
  MarketSortOption,
  PersonnelSessionState,
  PersonnelTabId,
  ProviderConfig,
} from '@offisim/ui-office/web';

export type { PersonnelSessionState, PersonnelTabId };
export type { LayoutTier, LayoutTierConfig };

// ---------------------------------------------------------------------------
// Workspace Keys
// ---------------------------------------------------------------------------

export type WorkspaceKey = 'office' | 'sops' | 'market' | 'personnel' | 'activity-log' | 'settings';

// ---------------------------------------------------------------------------
// Per-Workspace Session State
// ---------------------------------------------------------------------------

export type OfficeSessionState = {
  viewMode: '2D' | '3D';
  selectedEmployeeId: string | null;
  studioMode: 'create' | 'edit' | null;
  dashboardOpen: boolean;
  kanbanOpen: boolean;
  marketplaceListingId: string | null;
  leftPanelWidth: number;
  rightPanelWidth: number;
};

export type SopSessionState = {
  selectedSopId: string | null;
  focusedStepId: string | null;
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
  activeTab: 'provider' | 'runtime' | 'mcp' | 'external';
};

export type WorkspaceSessionState = {
  office: OfficeSessionState;
  sops: SopSessionState;
  market: MarketSessionState;
  personnel: PersonnelSessionState;
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
// Session State Key Mapping
// ---------------------------------------------------------------------------

export type SessionStateKeyMap = {
  office: 'office';
  sops: 'sops';
  market: 'market';
  personnel: 'personnel';
  'activity-log': 'activityLog';
  settings: 'settings';
};

export const SESSION_KEY: SessionStateKeyMap = {
  office: 'office',
  sops: 'sops',
  market: 'market',
  personnel: 'personnel',
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
  marketPageProps?: {
    onStartInstall?: (listingId: string, version: string) => void;
  };
  activityLogPageProps?: {
    onBackToOffice?: () => void;
  };
  settingsPageProps?: {
    onBack: () => void;
    onSave: (config: ProviderConfig) => void;
    onSaveSuccess?: () => void;
    onToast?: (message: string, variant?: 'info' | 'success' | 'error') => void;
    onEditExternalEmployee?: (employeeId: string) => void;
  };
  personnelPageProps?: {
    onOpenCreator?: () => void;
    onOpenMarket?: () => void;
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
    dashboardOpen: false,
    kanbanOpen: false,
    marketplaceListingId: null,
    leftPanelWidth: 44,
    rightPanelWidth: 44,
  };
}

export function createDefaultSopState(): SopSessionState {
  return {
    selectedSopId: null,
    focusedStepId: null,
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

export function createDefaultPersonnelState(): PersonnelSessionState {
  return {
    selectedEmployeeId: null,
    activeEmployeeTab: 'profile',
  };
}

export function createDefaultSessionState(): WorkspaceSessionState {
  return {
    office: createDefaultOfficeState(),
    sops: createDefaultSopState(),
    market: createDefaultMarketState(),
    personnel: createDefaultPersonnelState(),
    activityLog: createDefaultActivityLogState(),
    settings: { activeTab: 'provider' },
  };
}
