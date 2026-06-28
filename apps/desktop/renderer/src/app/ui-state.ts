import { generateId } from '@offisim/core/browser';
import type { DramaturgyMode } from '@offisim/shared-types';
import { create } from 'zustand';

type WorkspaceKey = 'office' | 'workspace' | 'market' | 'personnel';
type OverlaySurface = 'mission' | 'activity' | 'tasks' | 'settings' | 'studio' | 'lifecycle';
export type SurfaceKey = WorkspaceKey | OverlaySurface;

type SceneRenderMode = '3d' | '2d';
type RailMode = 'list' | 'thread';
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

/**
 * A workspace surface. Most are rail tabs (`messenger`, `calendar`, `contacts`,
 * `workplace`); `kanban` is a launcher app opened from the Workplace tile grid,
 * not a rail tab — only the rail tabs appear in `APP_GROUPS`.
 */
export type WorkspaceApp = 'messenger' | 'kanban' | 'calendar' | 'contacts' | 'workplace';

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
  /** Dramaturgy presentation density for the office scene. */
  officeMode: DramaturgyMode;
  sceneDropDiagnostics: SceneDropDiagnostic[];

  /** Personnel surface */
  selectedEmployeeId: string | null;
  personnelRailCollapsed: boolean;

  /** Market surface */
  selectedListingId: string | null;

  /** Loops surface (PR-08 owns the page; PR-10 sets this to open a Loop's detail
   *  from a composer chip's "open detail" affordance). */
  selectedLoopId: string | null;

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
   * One-shot intent: the Office team dock's "Hire" card sets this while
   * navigating to Personnel so the surface opens its Hire dialog on mount.
   * Unlike the sticky `lifecycleIntent`, this is consumed and cleared once by
   * PersonnelSurface so a later manual visit doesn't re-open the dialog.
   */
  pendingHire: boolean;

  /**
   * One-shot intent (PR-05): Contacts' "Message" sets the employee to start a
   * direct Connect chat with. The Connect Messenger consumes it on mount —
   * opening the existing active direct thread if there is one, else a fresh
   * unpersisted direct draft. Cleared once consumed so a later manual visit
   * doesn't re-open a draft.
   */
  pendingDirectChatEmployeeId: string | null;

  /**
   * One-shot intent set by "Use in Office" (PR-10) when there is NO active project:
   * routes the user to an explicit project selection before a Loop draft can be
   * opened — never a hidden default project. Carries the loop+revision so the
   * selector can resume the open flow once a project is chosen. Consumed + cleared
   * by whoever fulfils it (the selector / ScopeBar).
   */
  pendingLoopProjectSelect: { loopId: string; revisionId: string } | null;

  setSurface: (surface: SurfaceKey) => void;
  /** Navigate to the lifecycle front door with an explicit initial intent. */
  openLifecycle: (intent: 'select' | 'create') => void;
  /** Navigate to Personnel and flag the Hire dialog to open on arrival. */
  requestHire: () => void;
  /** Clear the one-shot Hire intent after the Personnel surface consumes it. */
  consumePendingHire: () => void;
  /** Open Connect Messenger and flag a direct chat to start with `employeeId`. */
  requestDirectChat: (employeeId: string) => void;
  /** Read + clear the one-shot direct-chat intent (Connect consumes it on mount). */
  consumePendingDirectChat: () => string | null;
  /** Request an explicit project selection to resume a "Use in Office" Loop flow. */
  requestLoopProjectSelect: (intent: { loopId: string; revisionId: string }) => void;
  /** Clear the one-shot Loop project-select intent once it has been handled. */
  consumePendingLoopProjectSelect: () => { loopId: string; revisionId: string } | null;
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
  setOfficeMode: (mode: DramaturgyMode) => void;
  recordSceneDropDiagnostic: (event: SceneDropDiagnostic) => void;

  selectEmployee: (employeeId: string | null) => void;
  setPersonnelRailCollapsed: (collapsed: boolean) => void;

  selectListing: (listingId: string | null) => void;
  /** Open a Loop's detail on the Loops (mission) surface — used by a composer chip. */
  openLoopDetail: (loopId: string) => void;

  setWorkspaceApp: (app: WorkspaceApp, selectedId?: string | null) => void;
  selectWorkspaceItem: (id: string | null) => void;
}

export const useUiState = create<UiState>((set, get) => ({
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
  officeMode: 'office',
  sceneDropDiagnostics: [],

  selectedEmployeeId: null,
  personnelRailCollapsed: false,

  selectedListingId: null,
  selectedLoopId: null,

  workspaceApp: 'messenger',
  workspaceSelectedId: null,

  lifecycleIntent: null,

  pendingHire: false,

  pendingDirectChatEmployeeId: null,

  pendingLoopProjectSelect: null,

  setSurface: (surface) => set({ surface }),
  openLifecycle: (intent) => set({ surface: 'lifecycle', lifecycleIntent: intent }),
  requestHire: () => set({ surface: 'personnel', pendingHire: true }),
  consumePendingHire: () => set({ pendingHire: false }),
  requestDirectChat: (employeeId) =>
    set({
      surface: 'workspace',
      workspaceApp: 'messenger',
      workspaceSelectedId: null,
      pendingDirectChatEmployeeId: employeeId,
    }),
  consumePendingDirectChat: (): string | null => {
    const id = get().pendingDirectChatEmployeeId;
    if (id) set({ pendingDirectChatEmployeeId: null });
    return id;
  },
  requestLoopProjectSelect: (intent) =>
    set({ surface: 'office', railMode: 'list', pendingLoopProjectSelect: intent }),
  consumePendingLoopProjectSelect: (): { loopId: string; revisionId: string } | null => {
    const intent = get().pendingLoopProjectSelect;
    if (intent) set({ pendingLoopProjectSelect: null });
    return intent;
  },
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
  setOfficeMode: (officeMode) => set({ officeMode }),
  recordSceneDropDiagnostic: (event) =>
    set((s) => ({ sceneDropDiagnostics: [event, ...s.sceneDropDiagnostics].slice(0, 10) })),

  selectEmployee: (selectedEmployeeId) => set({ selectedEmployeeId }),
  setPersonnelRailCollapsed: (personnelRailCollapsed) => set({ personnelRailCollapsed }),

  selectListing: (selectedListingId) => set({ selectedListingId }),
  openLoopDetail: (selectedLoopId) => set({ surface: 'mission', selectedLoopId }),

  setWorkspaceApp: (workspaceApp, workspaceSelectedId = null) =>
    set({ workspaceApp, workspaceSelectedId }),
  selectWorkspaceItem: (workspaceSelectedId) => set({ workspaceSelectedId }),
}));
