import type {
  ActivityLogSessionState,
  MarketSessionState,
  PersonnelTabId,
  SettingsSessionState,
  WorkspaceAppKey,
  WorkspaceKey,
  WorkspaceSessionState,
} from '../../components/workspaces/types';
import type { OverlayKey } from '../app-view-layout';

export type UrlOverlayKey = Exclude<OverlayKey, 'company-select'>;
export type UrlSyncMode = 'push' | 'replace';

export type WorkspaceSessionPatch = {
  [K in keyof WorkspaceSessionState]?: Partial<WorkspaceSessionState[K]>;
};

export interface ParsedUrl {
  workspace: WorkspaceKey;
  sessionPatch: WorkspaceSessionPatch;
  overlay: UrlOverlayKey | null;
  companyId?: string | null;
}

export type ParsedInitialState = ParsedUrl;

export type WorkspaceRoute =
  | {
      kind: 'office';
      workspace: 'office';
      overlay: Extract<UrlOverlayKey, 'office-editor'> | null;
      viewMode?: '2D' | '3D';
      selectedThreadId?: string | null;
      companyId?: string | null;
    }
  | {
      kind: 'sops';
      workspace: 'sops';
      selectedSopId?: string | null;
      focusedStepId?: string | null;
      search?: string;
    }
  | {
      kind: 'market';
      workspace: 'market';
      mode: MarketSessionState['mode'];
      selectedListingId?: string | null;
      search?: string;
      sort?: MarketSessionState['sort'];
      kindFilter?: MarketSessionState['kind'];
      manageTab?: MarketSessionState['manageTab'];
    }
  | {
      kind: 'personnel';
      workspace: 'personnel';
      selectedEmployeeId?: string | null;
      activeEmployeeTab?: PersonnelTabId;
      overlay?: Extract<UrlOverlayKey, 'employee-creator'> | null;
    }
  | {
      kind: 'activity-log';
      workspace: 'activity-log';
      selectedEventId?: string | null;
      eventTypes?: string[];
      actorFilters?: string[];
      datePreset?: ActivityLogSessionState['datePreset'];
      search?: string;
    }
  | {
      kind: 'workspace';
      workspace: 'workspace';
      activeApp: WorkspaceAppKey;
    }
  | {
      kind: 'settings';
      workspace: 'settings';
      activeTab: SettingsSessionState['activeTab'];
    }
  | {
      kind: 'studio';
      workspace: 'office';
      overlay: Extract<UrlOverlayKey, 'studio'>;
      companyId?: string | null;
    };

export interface SerializableUrlState {
  workspace: WorkspaceKey;
  sessionState: WorkspaceSessionState;
  overlay: UrlOverlayKey | null;
  activeCompanyId?: string | null;
}

export interface UrlFallbackToast {
  message: string;
  level: 'info';
}

export interface UrlFallbackRuntime {
  activeCompanyId: string | null;
  agents?: ReadonlyMap<string, unknown> | readonly unknown[];
  sops?: readonly unknown[];
  listings?: readonly unknown[];
  companies?: readonly unknown[];
}

export interface UrlFallbackResult {
  result: ParsedUrl;
  toast?: UrlFallbackToast;
}
