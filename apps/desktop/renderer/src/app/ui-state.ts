import type { PreviewSourceRef } from '@/surfaces/office/stage-preview/preview-target.js';
import { generateId } from '@offisim/core/browser';
import type { DramaturgyMode, ToolRichDetail } from '@offisim/shared-types';
import { create } from 'zustand';

type WorkspaceKey = 'office' | 'market' | 'personnel';
type OverlaySurface = 'mission' | 'settings' | 'studio' | 'lifecycle';
export type SurfaceKey = WorkspaceKey | OverlaySurface;

type SceneRenderMode = '3d' | '2d';
export type StagePrimaryTab = 'game' | 'board' | 'preview' | 'computer' | 'terminal' | 'review';
type BoardLens = 'board' | 'timeline';
type RailMode = 'list' | 'thread';
type StageToolStatus = 'running' | 'done' | 'error';

export type StageViewTarget =
  | { kind: 'scene' }
  | { kind: 'preview'; ref: PreviewSourceRef; title?: string }
  | {
      kind: 'browser-session';
      sessionId: string;
      scope: StageSessionScope;
      initialUrl: string;
      title?: string;
    }
  | {
      kind: 'terminal-session';
      sessionId: string;
      scope: StageSessionScope;
      title?: string;
    }
  | {
      kind: 'changes';
      path?: string | null;
      leaseId?: string;
      files?: Array<{ path: string; diff: string }>;
      status?: 'active' | 'pending_review' | 'merged' | 'discarded' | 'failed';
    }
  | {
      kind: 'logs';
      title?: string;
      tool?: string;
      sourceId?: string;
      status?: StageToolStatus;
      detail?: ToolRichDetail;
    }
  | { kind: 'computer'; threadId?: string | null };

export interface StageSessionScope {
  companyId: string;
  projectId: string;
  threadId?: string | null;
}

export type StageOpenTarget = Exclude<StageViewTarget, { kind: 'scene' }>;

export interface StageOpenTab {
  id: string;
  target: StageOpenTarget;
}

export interface StageSplitLayout extends Record<string, number> {
  'stage-primary': number;
  'stage-secondary': number;
}

export const DEFAULT_STAGE_SPLIT_LAYOUT: StageSplitLayout = {
  'stage-primary': 56,
  'stage-secondary': 44,
};

const STAGE_SPLIT_LAYOUT_STORAGE_KEY = 'offisim:ui-state:stage-split-layout';
const OFFICE_COMPANION_STORAGE_KEY = 'offisim:ui-state:office-companion-enabled';

function normalizeStageSplitLayout(value: unknown): StageSplitLayout {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    return DEFAULT_STAGE_SPLIT_LAYOUT;
  }
  const layout = value as Record<string, unknown>;
  const primary = layout['stage-primary'];
  const secondary = layout['stage-secondary'];
  if (
    typeof primary !== 'number' ||
    typeof secondary !== 'number' ||
    !Number.isFinite(primary) ||
    !Number.isFinite(secondary) ||
    primary < 30 ||
    secondary < 30 ||
    Math.abs(primary + secondary - 100) > 0.5
  ) {
    return DEFAULT_STAGE_SPLIT_LAYOUT;
  }
  return { 'stage-primary': primary, 'stage-secondary': secondary };
}

type StageSplitLayoutStorage = Pick<Storage, 'getItem' | 'setItem'>;

export function readStageSplitLayout(
  storage: StageSplitLayoutStorage | undefined = globalThis.localStorage,
): StageSplitLayout {
  try {
    const raw = storage?.getItem(STAGE_SPLIT_LAYOUT_STORAGE_KEY);
    return raw ? normalizeStageSplitLayout(JSON.parse(raw)) : DEFAULT_STAGE_SPLIT_LAYOUT;
  } catch {
    return DEFAULT_STAGE_SPLIT_LAYOUT;
  }
}

export function persistStageSplitLayout(
  value: unknown,
  storage: StageSplitLayoutStorage | undefined = globalThis.localStorage,
): StageSplitLayout {
  const layout = normalizeStageSplitLayout(value);
  try {
    storage?.setItem(STAGE_SPLIT_LAYOUT_STORAGE_KEY, JSON.stringify(layout));
  } catch {
    // A layout remains usable for this session when WebView storage is unavailable.
  }
  return layout;
}

function readOfficeCompanionEnabled(
  storage: Pick<Storage, 'getItem'> | undefined = globalThis.localStorage,
): boolean {
  try {
    return storage?.getItem(OFFICE_COMPANION_STORAGE_KEY) !== 'false';
  } catch {
    return true;
  }
}

function persistOfficeCompanionEnabled(
  enabled: boolean,
  storage: Pick<Storage, 'setItem'> | undefined = globalThis.localStorage,
): boolean {
  try {
    storage?.setItem(OFFICE_COMPANION_STORAGE_KEY, String(enabled));
  } catch {
    // The current session still honors the preference when storage is unavailable.
  }
  return enabled;
}

export function stageTabForTarget(
  target: StageOpenTarget,
): Exclude<StagePrimaryTab, 'game' | 'board'>;
export function stageTabForTarget(target: StageViewTarget): StagePrimaryTab;
export function stageTabForTarget(target: StageViewTarget): StagePrimaryTab {
  switch (target.kind) {
    case 'preview':
    case 'browser-session':
      return 'preview';
    case 'computer':
      return 'computer';
    case 'logs':
    case 'terminal-session':
      return 'terminal';
    case 'changes':
      return 'review';
    default:
      return 'game';
  }
}

function hashString(input: string): string {
  let hash = 5381;
  for (let index = 0; index < input.length; index += 1) {
    hash = (hash * 33) ^ input.charCodeAt(index);
  }
  return (hash >>> 0).toString(36);
}

function stagePreviewTabId(ref: PreviewSourceRef): string {
  switch (ref.source) {
    case 'workspace-file':
      return `preview:workspace-file:${ref.path}`;
    case 'deliverable':
      return `preview:deliverable:${ref.deliverableId}`;
    case 'browser':
      return `preview:browser:${ref.sourceId ?? ref.url ?? ref.detail?.url ?? 'latest'}`;
    case 'screenshot':
      return `preview:screenshot:${hashString(ref.dataRef)}`;
    case 'computer-artifact':
      return `preview:computer-artifact:${ref.path}`;
  }
}

function stageTabIdForTarget(target: StageOpenTarget): string {
  switch (target.kind) {
    case 'preview':
      return stagePreviewTabId(target.ref);
    case 'browser-session':
      return `browser-session:${target.sessionId}`;
    case 'changes':
      return `changes:${target.leaseId ?? target.path ?? 'workspace'}`;
    case 'logs':
      return `logs:${target.sourceId ?? target.tool ?? target.title ?? 'latest'}`;
    case 'terminal-session':
      return `terminal-session:${target.sessionId}`;
    case 'computer':
      return 'computer';
  }
}

function stageOpenTabForTarget(target: StageOpenTarget): StageOpenTab {
  return { id: stageTabIdForTarget(target), target };
}

function gameStageState() {
  return {
    activeStageTabId: null,
    stageSplitTabId: null,
    stagePrimaryTab: 'game' as const,
    stageView: { kind: 'scene' } as const,
  };
}

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

export type CompanyThreadDraft =
  | { kind: 'direct'; id: string; employeeId: string; employeeName: string }
  | {
      kind: 'group';
      id: string;
      title: string;
      employeeIds: string[];
      replyPolicy: 'mentions_only' | 'roundtable' | 'silent';
    };

interface UiState {
  surface: SurfaceKey;
  /** When Settings is opened via a capability route (e.g. `/tool`, `/computer`),
   *  the section to land on. Consumed and cleared by SettingsSurface. */
  settingsSection: string | null;
  companyId: string;
  projectId: string;

  /** Office surface */
  railMode: RailMode;
  selectedThreadId: string | null;
  /** Company-channel selection is intentionally distinct from project chat. */
  selectedCompanyThreadId: string | null;
  /** Unpersisted company channel; materialized by the first send. */
  companyThreadDraft: CompanyThreadDraft | null;
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
  stagePrimaryTab: StagePrimaryTab;
  stageView: StageViewTarget;
  stageOpenTabs: StageOpenTab[];
  activeStageTabId: string | null;
  /** Open work tab pinned to the resizable right stage pane. */
  stageSplitTabId: string | null;
  /** Last committed horizontal split, retained across pane unmounts and app restarts. */
  stageSplitLayout: StageSplitLayout;
  boardHighlightedRunId: string | null;
  boardLens: BoardLens;
  scenePipCollapsed: boolean;
  officeLeftRailCollapsed: boolean;
  officeRightRailCollapsed: boolean;
  officeStageMaximized: boolean;
  /** Dramaturgy presentation density for the office scene. */
  officeMode: DramaturgyMode;
  /** Ambient-only Codex companion visibility; never an AI/runtime actor. */
  officeCompanionEnabled: boolean;
  sceneDropDiagnostics: SceneDropDiagnostic[];
  /**
   * The employee whose workload drilldown drawer is open, or null when closed.
   * A read/inspect layer opened from the office scene (employee / workload bubble
   * / delivery chip) — never a worker-management console.
   */
  workloadDrilldown: { employeeId: string } | null;

  /** Personnel surface */
  selectedEmployeeId: string | null;
  personnelRailCollapsed: boolean;

  /** Market surface */
  selectedListingId: string | null;

  /** Loops surface (PR-08 owns the page; PR-10 sets this to open a Loop's detail
   *  from a composer chip's "open detail" affordance). */
  selectedLoopId: string | null;

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
   * One-shot intent set by "Use in Office" (PR-10) when there is NO active project:
   * routes the user to an explicit project selection before a Loop draft can be
   * opened — never a hidden default project. Carries the loop+revision so the
   * selector can resume the open flow once a project is chosen. Consumed + cleared
   * by whoever fulfils it (the selector / ScopeBar).
   */
  pendingLoopProjectSelect: { loopId: string; revisionId: string } | null;

  /** One-shot cross-project conversation focus. The target project's thread
   * query consumes this only after it has resolved successfully. */
  pendingThreadFocus: { projectId: string; threadId: string } | null;

  setSurface: (surface: SurfaceKey) => void;
  /** Open Settings, optionally deep-linking to a section (composer `/` routes). */
  openSettings: (section?: string) => void;
  /** Clear the pending Settings section once SettingsSurface has consumed it. */
  clearSettingsSection: () => void;
  /** Navigate to the lifecycle front door with an explicit initial intent. */
  openLifecycle: (intent: 'select' | 'create') => void;
  /** Navigate to Personnel and flag the Hire dialog to open on arrival. */
  requestHire: () => void;
  /** Clear the one-shot Hire intent after the Personnel surface consumes it. */
  consumePendingHire: () => void;
  /** Request an explicit project selection to resume a "Use in Office" Loop flow. */
  requestLoopProjectSelect: (intent: { loopId: string; revisionId: string }) => void;
  /** Clear the one-shot Loop project-select intent once it has been handled. */
  consumePendingLoopProjectSelect: () => { loopId: string; revisionId: string } | null;
  requestThreadFocus: (intent: { projectId: string; threadId: string }) => void;
  consumePendingThreadFocus: () => { projectId: string; threadId: string } | null;
  setScope: (companyId: string, projectId: string) => void;
  setProject: (projectId: string) => void;

  openThread: (threadId: string) => void;
  openCompanyThread: (threadId: string) => void;
  openCompanyDraft: (draft: CompanyThreadDraft) => void;
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
  setStagePrimaryTab: (tab: StagePrimaryTab, empty?: boolean) => void;
  openStageView: (target: StageViewTarget) => void;
  closeStageView: () => void;
  activateStageTab: (id: string) => void;
  closeStageTab: (id: string) => void;
  toggleStageSplitTab: (id: string) => void;
  setStageSplitLayout: (layout: Record<string, number>) => void;
  highlightBoardRun: (runId: string | null) => void;
  openBoard: (lens?: BoardLens) => void;
  setBoardLens: (lens: BoardLens) => void;
  setScenePipCollapsed: (collapsed: boolean) => void;
  setOfficeLeftRailCollapsed: (collapsed: boolean) => void;
  setOfficeRightRailCollapsed: (collapsed: boolean) => void;
  setOfficeStageMaximized: (maximized: boolean) => void;
  setOfficeMode: (mode: DramaturgyMode) => void;
  setOfficeCompanionEnabled: (enabled: boolean) => void;
  recordSceneDropDiagnostic: (event: SceneDropDiagnostic) => void;
  /** Open the workload drilldown drawer for an employee (read/inspect only). */
  openWorkloadDrilldown: (employeeId: string) => void;
  /** Close the workload drilldown drawer. */
  closeWorkloadDrilldown: () => void;

  selectEmployee: (employeeId: string | null) => void;
  setPersonnelRailCollapsed: (collapsed: boolean) => void;

  selectListing: (listingId: string | null) => void;
  /** Open a Loop's detail on the Loops (mission) surface — used by a composer chip. */
  openLoopDetail: (loopId: string) => void;
}

export const useUiState = create<UiState>((set, get) => ({
  // Land on the lifecycle front door; LifecycleSurface derives create-vs-select
  // from the real company count. No seed fixtures — ids are assigned on entry.
  surface: 'lifecycle',
  settingsSection: null,
  companyId: '',
  projectId: '',

  // First load has no selected thread; start in list mode so the rail shows
  // real conversations instead of a permanent loading skeleton.
  railMode: 'list',
  selectedThreadId: null,
  selectedCompanyThreadId: null,
  companyThreadDraft: null,
  draftThread: null,
  sceneRenderMode: '3d',
  stagePrimaryTab: 'game',
  stageView: { kind: 'scene' },
  stageOpenTabs: [],
  activeStageTabId: null,
  stageSplitTabId: null,
  stageSplitLayout: readStageSplitLayout(),
  boardHighlightedRunId: null,
  boardLens: 'board',
  scenePipCollapsed: false,
  officeLeftRailCollapsed: false,
  officeRightRailCollapsed: false,
  officeStageMaximized: false,
  officeMode: 'office',
  officeCompanionEnabled: readOfficeCompanionEnabled(),
  sceneDropDiagnostics: [],
  workloadDrilldown: null,

  selectedEmployeeId: null,
  personnelRailCollapsed: false,

  selectedListingId: null,
  selectedLoopId: null,

  lifecycleIntent: null,

  pendingHire: false,

  pendingLoopProjectSelect: null,
  pendingThreadFocus: null,

  setSurface: (surface) => set({ surface }),
  openSettings: (section) => set({ surface: 'settings', settingsSection: section ?? null }),
  clearSettingsSection: () => set({ settingsSection: null }),
  openLifecycle: (intent) => set({ surface: 'lifecycle', lifecycleIntent: intent }),
  requestHire: () => set({ surface: 'personnel', pendingHire: true }),
  consumePendingHire: () => set({ pendingHire: false }),
  requestLoopProjectSelect: (intent) =>
    set({ surface: 'office', railMode: 'list', pendingLoopProjectSelect: intent }),
  consumePendingLoopProjectSelect: (): { loopId: string; revisionId: string } | null => {
    const intent = get().pendingLoopProjectSelect;
    if (intent) set({ pendingLoopProjectSelect: null });
    return intent;
  },
  requestThreadFocus: (intent) =>
    set({
      projectId: intent.projectId,
      pendingThreadFocus: intent,
      selectedThreadId: null,
      selectedCompanyThreadId: null,
      companyThreadDraft: null,
      draftThread: null,
      railMode: 'list',
      stagePrimaryTab: 'game',
      stageView: { kind: 'scene' },
      stageOpenTabs: [],
      activeStageTabId: null,
      stageSplitTabId: null,
      boardHighlightedRunId: null,
      officeStageMaximized: false,
    }),
  consumePendingThreadFocus: () => {
    const intent = get().pendingThreadFocus;
    if (intent) set({ pendingThreadFocus: null });
    return intent;
  },
  setScope: (companyId, projectId) =>
    set({
      companyId,
      projectId,
      selectedThreadId: null,
      selectedCompanyThreadId: null,
      companyThreadDraft: null,
      draftThread: null,
      railMode: 'list',
      stagePrimaryTab: 'game',
      stageView: { kind: 'scene' },
      stageOpenTabs: [],
      activeStageTabId: null,
      stageSplitTabId: null,
      boardHighlightedRunId: null,
      pendingThreadFocus: null,
      officeStageMaximized: false,
    }),
  setProject: (projectId) =>
    set({
      projectId,
      selectedThreadId: null,
      selectedCompanyThreadId: null,
      companyThreadDraft: null,
      draftThread: null,
      railMode: 'list',
      stagePrimaryTab: 'game',
      stageView: { kind: 'scene' },
      stageOpenTabs: [],
      activeStageTabId: null,
      stageSplitTabId: null,
      boardHighlightedRunId: null,
      pendingThreadFocus: null,
      officeStageMaximized: false,
    }),

  openThread: (threadId) =>
    set({
      selectedThreadId: threadId,
      selectedCompanyThreadId: null,
      companyThreadDraft: null,
      draftThread: null,
      railMode: 'thread',
      stagePrimaryTab: 'game',
      stageView: { kind: 'scene' },
      stageOpenTabs: [],
      activeStageTabId: null,
      stageSplitTabId: null,
    }),
  openDraftThread: (employeeId = null) => {
    const id = generateId('thread');
    set({
      selectedThreadId: id,
      selectedCompanyThreadId: null,
      companyThreadDraft: null,
      draftThread: { id, employeeId: employeeId ?? null },
      railMode: 'thread',
      stagePrimaryTab: 'game',
      stageView: { kind: 'scene' },
      stageOpenTabs: [],
      activeStageTabId: null,
      stageSplitTabId: null,
    });
    return id;
  },
  openCompanyThread: (selectedCompanyThreadId) =>
    set({
      selectedCompanyThreadId,
      companyThreadDraft: null,
      selectedThreadId: null,
      draftThread: null,
      railMode: 'thread',
      stagePrimaryTab: 'game',
      stageView: { kind: 'scene' },
      stageOpenTabs: [],
      activeStageTabId: null,
      stageSplitTabId: null,
    }),
  openCompanyDraft: (companyThreadDraft) =>
    set({
      selectedCompanyThreadId: companyThreadDraft.id,
      companyThreadDraft,
      selectedThreadId: null,
      draftThread: null,
      railMode: 'thread',
      stagePrimaryTab: 'game',
      stageView: { kind: 'scene' },
      stageOpenTabs: [],
      activeStageTabId: null,
      stageSplitTabId: null,
    }),
  markDraftPersisted: () => set({ draftThread: null }),
  setDraftEmployee: (employeeId) =>
    set((s) => (s.draftThread ? { draftThread: { ...s.draftThread, employeeId } } : {})),
  closeThread: () =>
    set({
      selectedThreadId: null,
      selectedCompanyThreadId: null,
      companyThreadDraft: null,
      draftThread: null,
      railMode: 'list',
      stagePrimaryTab: 'game',
      stageView: { kind: 'scene' },
      stageOpenTabs: [],
      activeStageTabId: null,
      stageSplitTabId: null,
    }),
  setSceneRenderMode: (sceneRenderMode) => set({ sceneRenderMode }),
  setStagePrimaryTab: (stagePrimaryTab, empty = false) =>
    set((state) => {
      if (stagePrimaryTab === 'game') return gameStageState();
      if (stagePrimaryTab === 'board') {
        return {
          activeStageTabId: null,
          stageSplitTabId: null,
          stagePrimaryTab,
          stageView: { kind: 'scene' },
        };
      }
      if (empty) {
        return {
          activeStageTabId: null,
          stageSplitTabId: null,
          stagePrimaryTab,
          stageView: { kind: 'scene' },
        };
      }
      const existing = state.stageOpenTabs.find(
        (tab) => stageTabForTarget(tab.target) === stagePrimaryTab,
      );
      if (!existing) return {};
      return {
        activeStageTabId: existing.id,
        stagePrimaryTab,
        stageView: existing.target,
      };
    }),
  openStageView: (stageView) =>
    set((state) => {
      if (stageView.kind === 'scene') return gameStageState();
      const next = stageOpenTabForTarget(stageView);
      const existingIndex = state.stageOpenTabs.findIndex((tab) => tab.id === next.id);
      const stageOpenTabs =
        existingIndex >= 0
          ? state.stageOpenTabs.map((tab) => (tab.id === next.id ? next : tab))
          : [...state.stageOpenTabs, next];
      if (state.stageSplitTabId === next.id) return { stageOpenTabs };
      return {
        activeStageTabId: next.id,
        stageOpenTabs,
        stagePrimaryTab: stageTabForTarget(stageView),
        stageView,
      };
    }),
  closeStageView: () => {
    const active = get().activeStageTabId;
    if (active) {
      get().closeStageTab(active);
      return;
    }
    set(gameStageState());
  },
  activateStageTab: (id) =>
    set((state) => {
      const tab = state.stageOpenTabs.find((candidate) => candidate.id === id);
      if (!tab) return {};
      if (state.stageSplitTabId === id) {
        if (!state.activeStageTabId || state.activeStageTabId === id) {
          return {
            activeStageTabId: tab.id,
            stageSplitTabId: null,
            stagePrimaryTab: stageTabForTarget(tab.target),
            stageView: tab.target,
          };
        }
        return {
          activeStageTabId: tab.id,
          stageSplitTabId: state.activeStageTabId,
          stagePrimaryTab: stageTabForTarget(tab.target),
          stageView: tab.target,
        };
      }
      return {
        activeStageTabId: tab.id,
        stagePrimaryTab: stageTabForTarget(tab.target),
        stageView: tab.target,
      };
    }),
  closeStageTab: (id) =>
    set((state) => {
      const closedIndex = state.stageOpenTabs.findIndex((tab) => tab.id === id);
      if (closedIndex < 0) return {};
      const stageOpenTabs = state.stageOpenTabs.filter((tab) => tab.id !== id);
      if (state.stageSplitTabId === id) return { stageOpenTabs, stageSplitTabId: null };
      if (state.activeStageTabId !== id) return { stageOpenTabs };
      const unpinnedTabs = stageOpenTabs.filter((tab) => tab.id !== state.stageSplitTabId);
      const fallback =
        unpinnedTabs[Math.max(0, closedIndex - 1)] ?? unpinnedTabs[0] ?? stageOpenTabs[0] ?? null;
      if (!fallback) return { ...gameStageState(), stageOpenTabs };
      return {
        activeStageTabId: fallback.id,
        stageOpenTabs,
        stageSplitTabId: fallback.id === state.stageSplitTabId ? null : state.stageSplitTabId,
        stagePrimaryTab: stageTabForTarget(fallback.target),
        stageView: fallback.target,
      };
    }),
  toggleStageSplitTab: (id) =>
    set((state) => {
      if (state.stageSplitTabId === id) return { stageSplitTabId: null };
      if (
        state.stagePrimaryTab === 'game' ||
        state.stagePrimaryTab === 'board' ||
        !state.activeStageTabId
      ) {
        return {};
      }
      const splitTab = state.stageOpenTabs.find((tab) => tab.id === id);
      if (!splitTab) return {};
      if (state.activeStageTabId !== id) return { stageSplitTabId: id };
      const leftTab = [...state.stageOpenTabs].reverse().find((tab) => tab.id !== id);
      if (!leftTab) return {};
      return {
        activeStageTabId: leftTab.id,
        stageSplitTabId: id,
        stagePrimaryTab: stageTabForTarget(leftTab.target),
        stageView: leftTab.target,
      };
    }),
  setStageSplitLayout: (layout) => set({ stageSplitLayout: persistStageSplitLayout(layout) }),
  highlightBoardRun: (boardHighlightedRunId) => set({ boardHighlightedRunId }),
  openBoard: (boardLens = 'board') =>
    set({
      surface: 'office',
      activeStageTabId: null,
      stageSplitTabId: null,
      stagePrimaryTab: 'board',
      stageView: { kind: 'scene' },
      boardLens,
    }),
  setBoardLens: (boardLens) => set({ boardLens }),
  setScenePipCollapsed: (scenePipCollapsed) => set({ scenePipCollapsed }),
  setOfficeLeftRailCollapsed: (officeLeftRailCollapsed) => set({ officeLeftRailCollapsed }),
  setOfficeRightRailCollapsed: (officeRightRailCollapsed) => set({ officeRightRailCollapsed }),
  setOfficeStageMaximized: (officeStageMaximized) => set({ officeStageMaximized }),
  setOfficeMode: (officeMode) => set({ officeMode }),
  setOfficeCompanionEnabled: (officeCompanionEnabled) => {
    persistOfficeCompanionEnabled(officeCompanionEnabled);
    set({ officeCompanionEnabled });
  },
  recordSceneDropDiagnostic: (event) =>
    set((s) => ({ sceneDropDiagnostics: [event, ...s.sceneDropDiagnostics].slice(0, 10) })),
  openWorkloadDrilldown: (employeeId) => set({ workloadDrilldown: { employeeId } }),
  closeWorkloadDrilldown: () => set({ workloadDrilldown: null }),

  selectEmployee: (selectedEmployeeId) => set({ selectedEmployeeId }),
  setPersonnelRailCollapsed: (personnelRailCollapsed) => set({ personnelRailCollapsed }),

  selectListing: (selectedListingId) => set({ selectedListingId }),
  openLoopDetail: (selectedLoopId) => set({ surface: 'mission', selectedLoopId }),
}));
