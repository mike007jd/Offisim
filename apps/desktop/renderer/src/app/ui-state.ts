import { create } from 'zustand';

export type WorkspaceKey = 'office' | 'workspace' | 'market' | 'personnel';
export type OverlaySurface = 'activity' | 'settings' | 'studio' | 'lifecycle';
export type SurfaceKey = WorkspaceKey | OverlaySurface;

export const WORKSPACE_NAV: ReadonlyArray<{ key: WorkspaceKey; label: string }> = [
  { key: 'office', label: 'Office' },
  { key: 'workspace', label: 'Workspace' },
  { key: 'market', label: 'Market' },
  { key: 'personnel', label: 'Personnel' },
];

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

export type WorkspaceApp =
  | 'messenger'
  | 'approvals'
  | 'calendar'
  | 'meetings'
  | 'contacts'
  | 'workplace';

interface UiState {
  surface: SurfaceKey;
  companyId: string;
  projectId: string;

  /** Office surface */
  railMode: RailMode;
  selectedThreadId: string | null;
  sceneRenderMode: SceneRenderMode;
  sceneDropDiagnostics: SceneDropDiagnostic[];
  resumeDismissed: boolean;

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
   * Bell badge compares this to the live activity feed to render an honest
   * unread count instead of the prior hardcoded "always lit" indicator.
   */
  activityLastSeenAt: number;

  setSurface: (surface: SurfaceKey) => void;
  /** Navigate to the lifecycle front door with an explicit initial intent. */
  openLifecycle: (intent: 'select' | 'create') => void;
  setCompany: (companyId: string) => void;
  setProject: (projectId: string) => void;

  openThread: (threadId: string) => void;
  closeThread: () => void;
  setSceneRenderMode: (mode: SceneRenderMode) => void;
  recordSceneDropDiagnostic: (event: SceneDropDiagnostic) => void;
  dismissResume: () => void;

  selectEmployee: (employeeId: string | null) => void;
  setPersonnelRailCollapsed: (collapsed: boolean) => void;

  selectListing: (listingId: string | null) => void;

  setWorkspaceApp: (app: WorkspaceApp, selectedId?: string | null) => void;
  selectWorkspaceItem: (id: string | null) => void;

  /** Stamp the most recent seen activity timestamp (clears the Bell badge). */
  markActivityRead: (timestampMs: number) => void;
}

export const useUiState = create<UiState>((set) => ({
  // Land on the lifecycle front door; LifecycleSurface derives create-vs-select
  // from the real company count. No seed fixtures — ids are assigned on entry.
  surface: 'lifecycle',
  companyId: '',
  projectId: '',

  railMode: 'thread',
  selectedThreadId: null,
  sceneRenderMode: '3d',
  sceneDropDiagnostics: [],
  resumeDismissed: false,

  selectedEmployeeId: null,
  personnelRailCollapsed: false,

  selectedListingId: null,

  workspaceApp: 'messenger',
  workspaceSelectedId: null,

  lifecycleIntent: null,

  activityLastSeenAt: 0,

  setSurface: (surface) => set({ surface }),
  openLifecycle: (intent) => set({ surface: 'lifecycle', lifecycleIntent: intent }),
  setCompany: (companyId) => set({ companyId }),
  setProject: (projectId) => set({ projectId, selectedThreadId: null, railMode: 'list' }),

  openThread: (threadId) => set({ selectedThreadId: threadId, railMode: 'thread' }),
  closeThread: () => set({ railMode: 'list' }),
  setSceneRenderMode: (sceneRenderMode) => set({ sceneRenderMode }),
  recordSceneDropDiagnostic: (event) =>
    set((s) => ({ sceneDropDiagnostics: [event, ...s.sceneDropDiagnostics].slice(0, 10) })),
  dismissResume: () => set({ resumeDismissed: true }),

  selectEmployee: (selectedEmployeeId) => set({ selectedEmployeeId }),
  setPersonnelRailCollapsed: (personnelRailCollapsed) => set({ personnelRailCollapsed }),

  selectListing: (selectedListingId) => set({ selectedListingId }),

  setWorkspaceApp: (workspaceApp, workspaceSelectedId = null) =>
    set({ workspaceApp, workspaceSelectedId }),
  selectWorkspaceItem: (workspaceSelectedId) => set({ workspaceSelectedId }),

  markActivityRead: (timestampMs) =>
    set((s) => ({ activityLastSeenAt: Math.max(s.activityLastSeenAt, timestampMs) })),
}));
