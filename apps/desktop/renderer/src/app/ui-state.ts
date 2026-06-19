import { generateId } from '@offisim/core/browser';
import { create } from 'zustand';

export type WorkspaceKey = 'office' | 'workspace' | 'market' | 'personnel';
export type OverlaySurface = 'activity' | 'settings' | 'studio' | 'lifecycle';
export type SurfaceKey = WorkspaceKey | OverlaySurface;

export type SceneRenderMode = '3d' | '2d';
export type RailMode = 'list' | 'thread';
export interface SceneDropDiagnostic {
  id: string;
  at: string;
  employeeId: string;
  startX: number;
  startY: number;
  endX: number;
  endY: number;
  targetZoneId: string | null;
  decision: 'assigned' | 'missed' | 'not-moved';
}

export type WorkspaceApp = 'messenger' | 'approvals' | 'calendar' | 'contacts' | 'workplace';

interface UiState {
  surface: SurfaceKey;
  companyId: string;
  projectId: string;

  /** Office surface */
  railMode: RailMode;
  selectedThreadId: string | null;
  /**
   * A composed-but-not-yet-persisted conversation. Clicking "New conversation"
   * (or messaging an employee with no existing thread) opens a draft instead of
   * inserting an empty `chat_threads` row — the row is materialized only when
   * the first message is sent (see ChatRail's `materializeThread`). The draft's
   * id is also the `selectedThreadId` while it is the active conversation, so it
   * never appears in the sidebar list (which reads persisted rows) until then.
   */
  draftThread: { id: string; employeeId: string | null } | null;
  sceneRenderMode: SceneRenderMode;
  sceneDropDiagnostics: SceneDropDiagnostic[];
  resumeDismissed: boolean;
  /**
   * Narrow-tier (≤1200px) overlay visibility for the workspace panel. CSS
   * drops the panel's grid column at that width, so this flag is the only way
   * Files/Git stay reachable there; wide tiers ignore it.
   */
  wsPanelOverlayOpen: boolean;

  /** Personnel surface */
  selectedEmployeeId: string | null;
  personnelRailCollapsed: boolean;

  /** Market surface */
  selectedListingId: string | null;

  /** Workspace suite */
  workspaceApp: WorkspaceApp;
  workspaceSelectedId: string | null;

  /**
   * Which lifecycle front door to open on entry: the company selection page
   * ('select'), the creation wizard ('create'), or count-derived (null). Set by
   * the entry points (wordmark / scope menu / palette) right before navigating.
   */
  lifecycleIntent: 'select' | 'create' | null;

  /**
   * Highest activity-record timestamp the user has marked as seen. Office's
   * scene readout compares this to the live activity feed to render an honest
   * unread signal instead of the prior hardcoded "always lit" indicator.
   */
  activityLastSeenAt: number;

  setSurface: (surface: SurfaceKey) => void;
  /** Navigate to the lifecycle front door with an explicit initial intent. */
  openLifecycle: (intent: 'select' | 'create') => void;
  setScope: (companyId: string, projectId: string) => void;
  setProject: (projectId: string) => void;

  openThread: (threadId: string) => void;
  /**
   * Open a fresh draft conversation (no DB row yet). Returns the generated
   * thread id so callers can address the not-yet-persisted thread. Pass an
   * `employeeId` for a direct (1:1) draft; omit for a team draft.
   */
  openDraftThread: (employeeId?: string | null) => string;
  /** Clear the draft flag once its first message has materialized the row. */
  markDraftPersisted: () => void;
  /**
   * Retarget the active draft conversation's scope before its first message:
   * pass an `employeeId` for a direct (1:1) draft, or `null` for a team draft.
   * No-op once the draft has been persisted (scope is fixed at materialization).
   */
  setDraftEmployee: (employeeId: string | null) => void;
  closeThread: () => void;
  setSceneRenderMode: (mode: SceneRenderMode) => void;
  recordSceneDropDiagnostic: (event: SceneDropDiagnostic) => void;
  dismissResume: () => void;
  toggleWsPanelOverlay: () => void;

  selectEmployee: (employeeId: string | null) => void;
  setPersonnelRailCollapsed: (collapsed: boolean) => void;

  selectListing: (listingId: string | null) => void;

  setWorkspaceApp: (app: WorkspaceApp, selectedId?: string | null) => void;
  selectWorkspaceItem: (id: string | null) => void;

  /** Stamp the most recent seen activity timestamp (clears the scene unread signal). */
  markActivityRead: (timestampMs: number) => void;
}

export const useUiState = create<UiState>((set) => ({
  // Land on the lifecycle front door; LifecycleSurface derives create-vs-select
  // from the real company count. No seed fixtures — ids are assigned on entry.
  surface: 'lifecycle',
  companyId: '',
  projectId: '',

  // First load has no selected thread; start in list mode so the rail shows
  // real conversations instead of a permanent loading skeleton.
  railMode: 'list',
  selectedThreadId: null,
  draftThread: null,
  sceneRenderMode: '3d',
  sceneDropDiagnostics: [],
  resumeDismissed: false,
  wsPanelOverlayOpen: false,

  selectedEmployeeId: null,
  personnelRailCollapsed: false,

  selectedListingId: null,

  workspaceApp: 'messenger',
  workspaceSelectedId: null,

  lifecycleIntent: null,

  activityLastSeenAt: 0,

  setSurface: (surface) => set({ surface }),
  openLifecycle: (intent) => set({ surface: 'lifecycle', lifecycleIntent: intent }),
  setScope: (companyId, projectId) =>
    set({ companyId, projectId, selectedThreadId: null, draftThread: null, railMode: 'list' }),
  setProject: (projectId) =>
    set({ projectId, selectedThreadId: null, draftThread: null, railMode: 'list' }),

  openThread: (threadId) =>
    set({ selectedThreadId: threadId, draftThread: null, railMode: 'thread' }),
  openDraftThread: (employeeId = null) => {
    const id = generateId('thread');
    set({
      selectedThreadId: id,
      draftThread: { id, employeeId: employeeId ?? null },
      railMode: 'thread',
    });
    return id;
  },
  markDraftPersisted: () => set({ draftThread: null }),
  setDraftEmployee: (employeeId) =>
    set((s) => (s.draftThread ? { draftThread: { ...s.draftThread, employeeId } } : {})),
  closeThread: () => set({ selectedThreadId: null, draftThread: null, railMode: 'list' }),
  setSceneRenderMode: (sceneRenderMode) => set({ sceneRenderMode }),
  recordSceneDropDiagnostic: (event) =>
    set((s) => ({ sceneDropDiagnostics: [event, ...s.sceneDropDiagnostics].slice(0, 10) })),
  dismissResume: () => set({ resumeDismissed: true }),
  toggleWsPanelOverlay: () => set((s) => ({ wsPanelOverlayOpen: !s.wsPanelOverlayOpen })),

  selectEmployee: (selectedEmployeeId) => set({ selectedEmployeeId }),
  setPersonnelRailCollapsed: (personnelRailCollapsed) => set({ personnelRailCollapsed }),

  selectListing: (selectedListingId) => set({ selectedListingId }),

  setWorkspaceApp: (workspaceApp, workspaceSelectedId = null) =>
    set({ workspaceApp, workspaceSelectedId }),
  selectWorkspaceItem: (workspaceSelectedId) => set({ workspaceSelectedId }),

  markActivityRead: (timestampMs) =>
    set((s) => ({ activityLastSeenAt: Math.max(s.activityLastSeenAt, timestampMs) })),
}));
