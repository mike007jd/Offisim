import { create } from 'zustand';

export type WorkspaceKey = 'office' | 'sops' | 'market' | 'personnel';
export type OverlaySurface = 'activity' | 'settings' | 'studio';
export type SurfaceKey = WorkspaceKey | OverlaySurface;

export const WORKSPACE_NAV: ReadonlyArray<{ key: WorkspaceKey; label: string }> = [
  { key: 'office', label: 'Office' },
  { key: 'sops', label: 'SOPs' },
  { key: 'market', label: 'Market' },
  { key: 'personnel', label: 'Personnel' },
];

export type OfficeStageMode = 'scene' | 'board';
export type OfficeRunPanel = 'none' | 'board' | 'live';
export type RailMode = 'list' | 'thread';

interface UiState {
  surface: SurfaceKey;
  companyId: string;
  projectId: string;

  /** Office surface */
  railMode: RailMode;
  selectedThreadId: string | null;
  stageMode: OfficeStageMode;
  runPanel: OfficeRunPanel;

  /** Personnel surface */
  selectedEmployeeId: string | null;
  personnelRailCollapsed: boolean;

  /** Market surface */
  selectedListingId: string | null;

  /** SOPs surface */
  selectedSopId: string | null;

  setSurface: (surface: SurfaceKey) => void;
  setCompany: (companyId: string) => void;
  setProject: (projectId: string) => void;

  openThread: (threadId: string) => void;
  closeThread: () => void;
  setStageMode: (mode: OfficeStageMode) => void;
  toggleRunPanel: (panel: Exclude<OfficeRunPanel, 'none'>) => void;

  selectEmployee: (employeeId: string | null) => void;
  setPersonnelRailCollapsed: (collapsed: boolean) => void;

  selectListing: (listingId: string | null) => void;
  selectSop: (sopId: string | null) => void;
}

export const useUiState = create<UiState>((set) => ({
  surface: 'office',
  companyId: 'co-northwind',
  projectId: 'pj-relay',

  railMode: 'thread',
  selectedThreadId: 'th-team',
  stageMode: 'scene',
  runPanel: 'none',

  selectedEmployeeId: 'emp-mara',
  personnelRailCollapsed: false,

  selectedListingId: null,

  selectedSopId: 'sop-ship',

  setSurface: (surface) => set({ surface }),
  setCompany: (companyId) => set({ companyId }),
  setProject: (projectId) => set({ projectId, selectedThreadId: null, railMode: 'list' }),

  openThread: (threadId) => set({ selectedThreadId: threadId, railMode: 'thread' }),
  closeThread: () => set({ railMode: 'list' }),
  setStageMode: (stageMode) => set({ stageMode }),
  toggleRunPanel: (panel) =>
    set((state) => ({ runPanel: state.runPanel === panel ? 'none' : panel })),

  selectEmployee: (selectedEmployeeId) => set({ selectedEmployeeId }),
  setPersonnelRailCollapsed: (personnelRailCollapsed) => set({ personnelRailCollapsed }),

  selectListing: (selectedListingId) => set({ selectedListingId }),
  selectSop: (selectedSopId) => set({ selectedSopId }),
}));
