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
  setSceneRenderMode: (mode: SceneRenderMode) => void;
  recordSceneDropDiagnostic: (event: SceneDropDiagnostic) => void;
  setSessionMode: (mode: SessionMode) => void;
  dismissResume: () => void;

  selectEmployee: (employeeId: string | null) => void;
  setPersonnelRailCollapsed: (collapsed: boolean) => void;

  selectListing: (listingId: string | null) => void;

  setWorkspaceApp: (app: WorkspaceApp, selectedId?: string | null) => void;
  selectWorkspaceItem: (id: string | null) => void;
}

export const useUiState = create<UiState>((set) => ({
  surface: 'office',
  companyId: 'co-northwind',
  projectId: 'pj-relay',

  railMode: 'thread',
  selectedThreadId: 'th-team',
  sceneRenderMode: '3d',
  sceneDropDiagnostics: [],
  sessionMode: 'direct',
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
  setSceneRenderMode: (sceneRenderMode) => set({ sceneRenderMode }),
  recordSceneDropDiagnostic: (event) =>
    set((s) => ({ sceneDropDiagnostics: [event, ...s.sceneDropDiagnostics].slice(0, 10) })),
  setSessionMode: (sessionMode) => set({ sessionMode }),
  dismissResume: () => set({ resumeDismissed: true }),

  selectEmployee: (selectedEmployeeId) => set({ selectedEmployeeId }),
  setPersonnelRailCollapsed: (personnelRailCollapsed) => set({ personnelRailCollapsed }),

  selectListing: (selectedListingId) => set({ selectedListingId }),

  setWorkspaceApp: (workspaceApp, workspaceSelectedId = null) =>
    set({ workspaceApp, workspaceSelectedId }),
  selectWorkspaceItem: (workspaceSelectedId) => set({ workspaceSelectedId }),
}));
