import {
  type StageOpenTarget,
  type StagePrimaryTab,
  type StageViewTarget,
  stageTabForTarget,
  useUiState,
} from '@/app/ui-state.js';
import { RunPipelinePill } from '@/assistant/parts/RunPipelinePill.js';
import type { TaskAccountingPresentation } from '@/data/task-accounting-presentation.js';
import { Icon } from '@/design-system/icons/Icon.js';
import { cn } from '@/lib/utils.js';
import { useProjectWorkspaceLeaseReviews } from '@/surfaces/office/board/task-board-data.js';
import {
  type PreviewSourceRef,
  previewRefViewerKind,
  viewerKindIcon,
} from '@/surfaces/office/stage-preview/preview-target.js';
import { useStageChrome } from '@/surfaces/office/stage-viewer/stage-chrome.js';
import {
  Box,
  Coins,
  Columns3,
  Gauge,
  GitCompareArrows,
  Globe2,
  History,
  Maximize2,
  Minimize2,
  MonitorSmartphone,
  PanelLeftClose,
  PanelLeftOpen,
  PanelRightClose,
  PanelRightOpen,
  TerminalSquare,
  X,
} from 'lucide-react';
import { StageViewMenu } from './StageViewMenu.js';

export interface StageRunStatusProps {
  isRunning: boolean;
  accounting: TaskAccountingPresentation;
}

const PRIMARY_TABS = [
  { id: 'game', label: 'Game View', icon: Box },
  { id: 'board', label: 'Board', icon: Columns3 },
  { id: 'preview', label: 'Preview', icon: Globe2 },
  { id: 'computer', label: 'Computer', icon: MonitorSmartphone },
  { id: 'terminal', label: 'Terminal', icon: TerminalSquare },
  { id: 'review', label: 'Review', icon: GitCompareArrows },
] as const satisfies ReadonlyArray<{
  id: StagePrimaryTab;
  label: string;
  icon: typeof Box;
}>;

export function StageTopBar() {
  const stagePrimaryTab = useUiState((s) => s.stagePrimaryTab);
  const setStagePrimaryTab = useUiState((s) => s.setStagePrimaryTab);
  const boardLens = useUiState((s) => s.boardLens);
  const openBoard = useUiState((s) => s.openBoard);
  const stageOpenTabs = useUiState((s) => s.stageOpenTabs);
  const activeStageTabId = useUiState((s) => s.activeStageTabId);
  const activateStageTab = useUiState((s) => s.activateStageTab);
  const closeStageTab = useUiState((s) => s.closeStageTab);
  const stageSplitTabId = useUiState((s) => s.stageSplitTabId);
  const toggleStageSplitTab = useUiState((s) => s.toggleStageSplitTab);
  const stageMaximized = useUiState((s) => s.officeStageMaximized);
  const setStageMaximized = useUiState((s) => s.setOfficeStageMaximized);
  const leftRailCollapsed = useUiState((s) => s.officeLeftRailCollapsed);
  const setLeftRailCollapsed = useUiState((s) => s.setOfficeLeftRailCollapsed);
  const rightRailCollapsed = useUiState((s) => s.officeRightRailCollapsed);
  const setRightRailCollapsed = useUiState((s) => s.setOfficeRightRailCollapsed);
  const projectId = useUiState((s) => s.projectId);
  const leaseReviews = useProjectWorkspaceLeaseReviews(projectId || null);
  const pendingReviewCount = new Set(
    leaseReviews.rows
      .filter((lease) => lease.status === 'pending_review')
      .map((lease) => lease.rootRunId),
  ).size;
  const toggleLeftRail = () => {
    const expanding = leftRailCollapsed;
    if (expanding && window.matchMedia('(max-width: 1100px)').matches) {
      setRightRailCollapsed(true);
    }
    setLeftRailCollapsed(!leftRailCollapsed);
  };
  const toggleRightRail = () => {
    const expanding = rightRailCollapsed;
    if (expanding && window.matchMedia('(max-width: 1100px)').matches) {
      setLeftRailCollapsed(true);
    }
    setRightRailCollapsed(!rightRailCollapsed);
  };

  const labelCounts = new Map<string, number>();
  for (const tab of stageOpenTabs) {
    const label = stageTabLabel(tab.target);
    labelCounts.set(label, (labelCounts.get(label) ?? 0) + 1);
  }

  return (
    <div className="off-stage-topbar">
      <div className="off-stage-topbar-tabs">
        <button
          type="button"
          className="off-stage-rail-toggle off-focusable"
          data-rail="workspace"
          onClick={toggleLeftRail}
          aria-label={leftRailCollapsed ? 'Expand workspace' : 'Collapse workspace'}
          aria-expanded={!leftRailCollapsed}
          title={leftRailCollapsed ? 'Expand workspace' : 'Collapse workspace'}
        >
          <Icon icon={leftRailCollapsed ? PanelLeftOpen : PanelLeftClose} size="sm" />
        </button>
        <nav className="off-stage-tabs" aria-label="Stage views">
          <button
            type="button"
            className={cn('off-stage-tab off-focusable', stagePrimaryTab === 'game' && 'is-active')}
            onClick={() => setStagePrimaryTab('game')}
            aria-current={stagePrimaryTab === 'game' ? 'page' : undefined}
            aria-label="Game View"
            title="Game View"
          >
            <Icon icon={Box} size="sm" />
            <span>Game View</span>
          </button>
          <button
            type="button"
            className={cn(
              'off-stage-tab off-focusable',
              stagePrimaryTab === 'board' && boardLens === 'board' && 'is-active',
            )}
            onClick={() => openBoard('board')}
            aria-current={stagePrimaryTab === 'board' && boardLens === 'board' ? 'page' : undefined}
            aria-label={`Board${pendingReviewCount ? `, ${pendingReviewCount} pending review` : ''}`}
            title="Board"
          >
            <Icon icon={Columns3} size="sm" />
            <span>Board</span>
            {pendingReviewCount > 0 ? (
              <b className="off-stage-tab-badge">{pendingReviewCount}</b>
            ) : null}
          </button>
          <button
            type="button"
            className={cn(
              'off-stage-tab off-focusable',
              stagePrimaryTab === 'board' && boardLens === 'timeline' && 'is-active',
            )}
            onClick={() => openBoard('timeline')}
            aria-current={
              stagePrimaryTab === 'board' && boardLens === 'timeline' ? 'page' : undefined
            }
            aria-label="Timeline"
            title="Timeline"
          >
            <Icon icon={History} size="sm" />
            <span>Timeline</span>
          </button>
          {stageOpenTabs.map((tab) => {
            const baseLabel = stageTabLabel(tab.target);
            const label =
              (labelCounts.get(baseLabel) ?? 0) > 1
                ? stageTabDisambiguatedLabel(tab.target)
                : baseLabel;
            return (
              <div
                key={tab.id}
                className={cn('off-stage-tab-shell', activeStageTabId === tab.id && 'is-active')}
                data-split={stageSplitTabId === tab.id ? 'right' : undefined}
              >
                <button
                  type="button"
                  className="off-stage-tab off-focusable"
                  onClick={() => activateStageTab(tab.id)}
                  onAuxClick={(event) => {
                    if (event.button === 1) closeStageTab(tab.id);
                  }}
                  onContextMenu={(event) => {
                    event.preventDefault();
                    if (stagePrimaryTab !== 'game' && stagePrimaryTab !== 'board') {
                      toggleStageSplitTab(tab.id);
                    }
                  }}
                  aria-current={activeStageTabId === tab.id ? 'page' : undefined}
                  aria-label={label}
                  title={stageTabTitle(tab.target)}
                >
                  <Icon icon={stageTabIcon(tab.target)} size="sm" />
                  <span>{label}</span>
                </button>
                {stagePrimaryTab !== 'game' && stagePrimaryTab !== 'board' ? (
                  <button
                    type="button"
                    className="off-stage-tab-split off-focusable"
                    onClick={() => toggleStageSplitTab(tab.id)}
                    aria-label={
                      stageSplitTabId === tab.id
                        ? `Restore ${label} to single view`
                        : `Split ${label} to right`
                    }
                    aria-pressed={stageSplitTabId === tab.id}
                    title={
                      stageSplitTabId === tab.id
                        ? 'Restore single view'
                        : stageOpenTabs.length > 1
                          ? 'Split to right'
                          : 'Open another work view to split'
                    }
                    disabled={stageOpenTabs.length < 2 && stageSplitTabId !== tab.id}
                  >
                    <Icon
                      icon={stageSplitTabId === tab.id ? PanelRightClose : PanelRightOpen}
                      size="sm"
                    />
                  </button>
                ) : null}
                <button
                  type="button"
                  className="off-stage-tab-close off-focusable"
                  onClick={() => closeStageTab(tab.id)}
                  aria-label={`Close ${label}`}
                  title={`Close ${label}`}
                >
                  <Icon icon={X} size="sm" />
                </button>
              </div>
            );
          })}
          <StageViewMenu />
        </nav>
      </div>

      <div className="off-stage-topbar-right">
        <button
          type="button"
          className="off-stage-max-btn off-focusable"
          onClick={() => setStageMaximized(!stageMaximized)}
          title={stageMaximized ? 'Restore stage' : 'Maximize stage'}
        >
          <Icon icon={stageMaximized ? Minimize2 : Maximize2} size="sm" />
        </button>
        <button
          type="button"
          className="off-stage-rail-toggle off-focusable"
          data-rail="conversations"
          onClick={toggleRightRail}
          aria-label={rightRailCollapsed ? 'Expand conversations' : 'Collapse conversations'}
          aria-expanded={!rightRailCollapsed}
          title={rightRailCollapsed ? 'Expand conversations' : 'Collapse conversations'}
        >
          <Icon icon={rightRailCollapsed ? PanelRightOpen : PanelRightClose} size="sm" />
        </button>
      </div>
    </div>
  );
}

/** Run state belongs to stage content, never to the view-tab strip. */
export function StageRunStatusCluster({ isRunning, accounting }: StageRunStatusProps) {
  return (
    <div className="off-stage-status-cluster" data-stage-run-status aria-label="Stage run status">
      <RunPipelinePill />
      <output
        className={cn(
          'off-stage-readout',
          isRunning && 'is-live',
          accounting.tone !== 'neutral' && `is-${accounting.tone}`,
        )}
        aria-label={accounting.ariaLabel}
        title={accounting.title}
      >
        <span className="off-stage-readout-part">
          <Icon icon={accounting.kind === 'subscription' ? Gauge : Coins} size="sm" />
          <b>{accounting.primary}</b>
        </span>
        {accounting.secondary ? (
          <>
            <span className="off-stage-readout-div" />
            <b>{accounting.secondary}</b>
          </>
        ) : null}
      </output>
    </div>
  );
}

function stageTabIcon(target: StageOpenTarget) {
  if (target.kind === 'preview') {
    const kind = previewRefViewerKind(target.ref);
    if (kind) return viewerKindIcon(kind);
  }
  return PRIMARY_TABS.find((candidate) => candidate.id === stageTabForTarget(target))?.icon ?? Box;
}

function fileLeaf(path: string) {
  const normalized = path.replace(/\\/g, '/');
  const parts = normalized.split('/').filter(Boolean);
  return parts[parts.length - 1] ?? path;
}

function fileParentLeaf(path: string) {
  const parts = path.replace(/\\/g, '/').split('/').filter(Boolean);
  const leaf = parts[parts.length - 1] ?? path;
  const parent = parts[parts.length - 2];
  return parent ? `${parent}/${leaf}` : leaf;
}

/** Longer label used when two open tabs would otherwise read identically. */
function stageTabDisambiguatedLabel(target: StageOpenTarget) {
  if (
    target.kind === 'preview' &&
    (target.ref.source === 'workspace-file' || target.ref.source === 'computer-artifact')
  ) {
    return fileParentLeaf(target.ref.path);
  }
  if (target.kind === 'changes' && target.path) return fileParentLeaf(target.path);
  return stageTabLabel(target);
}

function previewRefLabel(ref: PreviewSourceRef) {
  switch (ref.source) {
    case 'workspace-file':
    case 'computer-artifact':
      return fileLeaf(ref.path);
    case 'deliverable':
      return ref.name ?? 'Output';
    case 'browser':
      return ref.detail?.title ?? ref.url ?? 'Browser';
    case 'screenshot':
      return ref.title ?? ref.url ?? 'Screenshot';
  }
}

function previewRefTitle(ref: PreviewSourceRef) {
  switch (ref.source) {
    case 'workspace-file':
    case 'computer-artifact':
      return ref.path;
    case 'deliverable':
      return ref.name ?? ref.deliverableId;
    case 'browser':
      return ref.detail?.url ?? ref.url ?? ref.sourceId ?? 'Browser preview';
    case 'screenshot':
      return ref.url ?? ref.title ?? 'Screenshot';
  }
}

function previewRefMeta(ref: PreviewSourceRef) {
  switch (ref.source) {
    case 'workspace-file':
      return ref.path;
    case 'deliverable':
      return ref.format ?? 'Generated output';
    case 'browser':
      return ref.detail?.url ?? ref.url ?? 'Browser preview';
    case 'screenshot':
      return ref.url ?? ref.mimeType;
    case 'computer-artifact':
      return ref.runId ? `${ref.runId} · ${ref.path}` : ref.path;
  }
}

function stageTabLabel(target: StageOpenTarget) {
  switch (target.kind) {
    case 'preview':
      return target.title ?? previewRefLabel(target.ref);
    case 'browser-session':
      return target.title ?? 'Browser';
    case 'changes':
      return target.comparisonGroupId
        ? 'Compare drafts'
        : target.path
          ? fileLeaf(target.path)
          : 'Review';
    case 'logs':
      return target.tool ?? target.title ?? 'Terminal';
    case 'terminal-session':
      return target.title ?? 'Terminal';
    case 'computer':
      return 'Computer';
  }
}

function stageTabTitle(target: StageOpenTarget) {
  switch (target.kind) {
    case 'preview':
      return target.title ?? previewRefTitle(target.ref);
    case 'browser-session':
      return target.title ?? target.initialUrl;
    case 'changes':
      return target.comparisonGroupId
        ? 'Competitive draft review'
        : (target.path ?? 'Workspace changes');
    case 'logs':
      return target.tool ?? target.title ?? 'Terminal log';
    case 'terminal-session':
      return target.title ?? 'Interactive project terminal';
    case 'computer':
      return 'Computer Use';
  }
}

export function StageViewerHead({
  tab,
  target,
  tabId,
  split,
  isRunning,
  accounting,
}: {
  tab: Exclude<StagePrimaryTab, 'game'>;
  target: StageViewTarget | null;
  tabId: string | null;
  split: boolean;
} & StageRunStatusProps) {
  const closeStageView = useUiState((s) => s.closeStageView);
  const closeStageTab = useUiState((s) => s.closeStageTab);
  const toggleStageSplitTab = useUiState((s) => s.toggleStageSplitTab);
  const chrome = useStageChrome();
  return (
    <div className="off-stage-viewer-head">
      <ViewerIcon tab={tab} />
      <div className="off-stage-viewer-title">
        <span>
          {chrome?.title ?? viewerTitle(tab)}
          {chrome?.badge ? <em className="off-preview-trust">{chrome.badge}</em> : null}
        </span>
        <small>{chrome?.meta ?? (target ? viewerMeta(target) : viewerEmptyMeta(tab))}</small>
      </div>
      <div className="off-stage-viewer-controls">
        {chrome?.actions ? <div className="off-preview-actions">{chrome.actions}</div> : null}
        <StageRunStatusCluster isRunning={isRunning} accounting={accounting} />
        {split && tabId ? (
          <button
            type="button"
            className="off-stage-viewer-split off-focusable"
            onClick={() => toggleStageSplitTab(tabId)}
            aria-label="Restore single stage view"
            title="Restore single view"
          >
            <Icon icon={PanelRightClose} size="sm" />
          </button>
        ) : null}
        <button
          type="button"
          className="off-stage-viewer-close off-focusable"
          onClick={() => (split && tabId ? closeStageTab(tabId) : closeStageView())}
          aria-label={`Close ${viewerTitle(tab)} view`}
          title="Close view"
        >
          <Icon icon={X} size="sm" />
        </button>
      </div>
    </div>
  );
}

function ViewerIcon({ tab }: { tab: StagePrimaryTab }) {
  const icon = PRIMARY_TABS.find((candidate) => candidate.id === tab)?.icon ?? Box;
  return <Icon icon={icon} size="sm" className="off-stage-viewer-icon" />;
}

export function viewerTitle(tab: StagePrimaryTab) {
  switch (tab) {
    case 'preview':
      return 'Preview';
    case 'computer':
      return 'Computer';
    case 'terminal':
      return 'Terminal';
    case 'review':
      return 'Review';
    case 'board':
      return 'Board';
    default:
      return 'Game View';
  }
}

function viewerEmptyMeta(tab: StagePrimaryTab) {
  switch (tab) {
    case 'preview':
      return 'Preview workspace';
    case 'computer':
      return 'Computer Use';
    case 'terminal':
      return 'Run log';
    case 'review':
      return 'Workspace changes';
    case 'board':
      return 'Requests and review';
    default:
      return 'Office scene';
  }
}

function viewerMeta(target: StageViewTarget) {
  switch (target.kind) {
    case 'preview':
      return target.title ?? previewRefMeta(target.ref);
    case 'browser-session':
      return target.initialUrl;
    case 'changes':
      return target.path ?? 'Workspace diff';
    case 'logs':
      return target.tool ?? target.title ?? 'Tool run';
    case 'terminal-session':
      return target.scope.threadId ?? target.scope.projectId;
    case 'computer':
      return target.threadId ?? 'Computer Use';
    default:
      return '';
  }
}
