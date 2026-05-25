import type { SessionMode } from '@/data/types.js';
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

/** The scene is always the stage base layer. The run-axis entries (Board / Live)
 *  open as overlays on top of it; "none" shows the bare scene. */
export type StageRunAxis = 'none' | 'board' | 'live';
export type SceneRenderMode = '3d' | '2d';
export type RailMode = 'list' | 'thread';
export type WorkspaceApp =
  | 'messenger'
  | 'approvals'
  | 'docs'
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
  stageRunAxis: StageRunAxis;
  sceneRenderMode: SceneRenderMode;
  sessionMode: SessionMode;
  resumeDismissed: boolean;

  /** Personnel surface */
  selectedEmployeeId: string | null;
  personnelRailCollapsed: boolean;

  /** Market surface */
  selectedListingId: string | null;

  /** Workspace suite */
  workspaceApp: WorkspaceApp;
  workspaceSelectedId: string | null;

  setSurface: (surface: SurfaceKey) => void;
  setCompany: (companyId: string) => void;
  setProject: (projectId: string) => void;

  openThread: (threadId: string) => void;
  closeThread: () => void;
  setStageRunAxis: (axis: StageRunAxis) => void;
  toggleStageRunAxis: (axis: Exclude<StageRunAxis, 'none'>) => void;
  setSceneRenderMode: (mode: SceneRenderMode) => void;
  setSessionMode: (mode: SessionMode) => void;
  dismissResume: () => void;

  selectEmployee: (employeeId: string | null) => void;
  setPersonnelRailCollapsed: (collapsed: boolean) => void;

  selectListing: (listingId: string | null) => void;

  setWorkspaceApp: (app: WorkspaceApp) => void;
  selectWorkspaceItem: (id: string | null) => void;
}

export const useUiState = create<UiState>((set) => ({
  surface: 'office',
  companyId: 'co-northwind',
  projectId: 'pj-relay',

  railMode: 'thread',
  selectedThreadId: 'th-team',
  stageRunAxis: 'none',
  sceneRenderMode: '3d',
  sessionMode: 'sop',
  resumeDismissed: false,

  selectedEmployeeId: 'emp-mara',
  personnelRailCollapsed: false,

  selectedListingId: null,

  workspaceApp: 'messenger',
  workspaceSelectedId: 'th-team',

  setSurface: (surface) => set({ surface }),
  setCompany: (companyId) => set({ companyId }),
  setProject: (projectId) => set({ projectId, selectedThreadId: null, railMode: 'list' }),

  openThread: (threadId) => set({ selectedThreadId: threadId, railMode: 'thread' }),
  closeThread: () => set({ railMode: 'list' }),
  setStageRunAxis: (stageRunAxis) => set({ stageRunAxis }),
  toggleStageRunAxis: (axis) =>
    set((s) => ({ stageRunAxis: s.stageRunAxis === axis ? 'none' : axis })),
  setSceneRenderMode: (sceneRenderMode) => set({ sceneRenderMode }),
  setSessionMode: (sessionMode) => set({ sessionMode }),
  dismissResume: () => set({ resumeDismissed: true }),

  selectEmployee: (selectedEmployeeId) => set({ selectedEmployeeId }),
  setPersonnelRailCollapsed: (personnelRailCollapsed) => set({ personnelRailCollapsed }),

  selectListing: (selectedListingId) => set({ selectedListingId }),

  setWorkspaceApp: (workspaceApp) => set({ workspaceApp, workspaceSelectedId: null }),
  selectWorkspaceItem: (workspaceSelectedId) => set({ workspaceSelectedId }),
}));
