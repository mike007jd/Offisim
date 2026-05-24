import type { AssetKind } from '@offisim/asset-schema';
import type { ProjectRow } from '@offisim/shared-types';
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

export type WorkspaceKey =
  | 'office'
  | 'sops'
  | 'market'
  | 'personnel'
  | 'workspace'
  | 'activity-log'
  | 'settings';

export type WorkspaceAppKey =
  | 'messenger'
  | 'approvals'
  | 'docs'
  | 'calendar'
  | 'meetings'
  | 'contacts'
  | 'workplace';

// ---------------------------------------------------------------------------
// Per-Workspace Session State
// ---------------------------------------------------------------------------

export type OfficeSessionState = {
  viewMode: '2D' | '3D';
  selectedEmployeeId: string | null;
  /** Active `chat_threads.thread_id`; not the LangGraph `graph_threads.thread_id`. */
  selectedThreadId: string | null;
  studioMode: 'create' | 'edit' | null;
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

export type WorkspaceSuiteSessionState = {
  activeApp: WorkspaceAppKey;
  /** Approvals OA To-do/Done filter. */
  approvalsFilter: 'todo' | 'done';
  /** Selected resolved approval (history_id) when filter === 'done'. */
  approvalsSelectedHistoryId: string | null;
};

export type WorkspaceSessionState = {
  office: OfficeSessionState;
  sops: SopSessionState;
  market: MarketSessionState;
  personnel: PersonnelSessionState;
  workspace: WorkspaceSuiteSessionState;
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
  workspace: 'workspace';
  'activity-log': 'activityLog';
  settings: 'settings';
};

export const SESSION_KEY: SessionStateKeyMap = {
  office: 'office',
  sops: 'sops',
  market: 'market',
  personnel: 'personnel',
  workspace: 'workspace',
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
    onFileImport?: (file: File) => void;
  };
  sopsPageProps?: {
    onOpenTemplates?: () => void;
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
  workspaceSuiteProps?: {
    /** Active product chat_threads.thread_id (SSOT: OfficeSessionState.selectedThreadId). */
    activeThreadId?: string | null;
    /** Active project row (SSOT: App-level activeProjectId). */
    activeProject?: ProjectRow | null;
    activeCompanyId?: string | null;
    /** Selected direct-chat employee (SSOT: OfficeSessionState.selectedEmployeeId). */
    selectedEmployeeId?: string | null;
    /** Thread switch writer — MUST clamp to Office `selectedThreadId` SSOT. */
    onSelectThread?: (threadId: string) => void;
    /** Direct-chat target writer — clamps Office `selectedEmployeeId` SSOT. */
    onSelectDirectEmployee?: (employeeId: string | null) => void;
    /** Open API / model settings. */
    onOpenSettings?: () => void;
    /** Focus an employee in Office (used by system-channel cards). */
    onFocusEmployee?: (employeeId: string) => void;
    /** Open Activity Log workspace (used by system-channel cards). */
    onOpenActivityLog?: () => void;
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
    selectedThreadId: null,
    studioMode: null,
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

export function createDefaultWorkspaceSuiteState(): WorkspaceSuiteSessionState {
  return {
    activeApp: 'messenger',
    approvalsFilter: 'todo',
    approvalsSelectedHistoryId: null,
  };
}

export function createDefaultSessionState(): WorkspaceSessionState {
  return {
    office: createDefaultOfficeState(),
    sops: createDefaultSopState(),
    market: createDefaultMarketState(),
    personnel: createDefaultPersonnelState(),
    workspace: createDefaultWorkspaceSuiteState(),
    activityLog: createDefaultActivityLogState(),
    settings: { activeTab: 'provider' },
  };
}
