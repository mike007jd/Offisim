import {
  type StageOpenTarget,
  type StagePrimaryTab,
  type StageViewTarget,
  stageTabForTarget,
  useUiState,
} from '@/app/ui-state.js';
import { RunPipelinePill } from '@/assistant/parts/RunPipelinePill.js';
import { useActiveConversationRuns } from '@/assistant/runtime/conversation-run-react.js';
import { workbenchOf } from '@/data/git-workbench.js';
import { useDeliverables, useGitWorkbench } from '@/data/queries.js';
import type { TaskAccountingPresentation } from '@/data/task-accounting-presentation.js';
import type { Deliverable } from '@/data/types.js';
import { parseUnifiedDiffFiles } from '@/data/unified-diff.js';
import { CapsLabel } from '@/design-system/grammar/CapsLabel.js';
import { Icon } from '@/design-system/icons/Icon.js';
import { Popover, PopoverContent, PopoverTrigger } from '@/design-system/primitives/popover.js';
import { cn } from '@/lib/utils.js';
import { BoardPendingReviewAutoOpen, BoardStage } from '@/surfaces/office/board/BoardStage.js';
import { DiffPanel } from '@/surfaces/office/board/DiffPanel.js';
import { ReviewWorkbenchStage } from '@/surfaces/office/board/ReviewWorkbenchStage.js';
import { useProjectWorkspaceLeaseReviews } from '@/surfaces/office/board/task-board-data.js';
import { ComputerView } from '@/surfaces/office/computer/ComputerView.js';
import { useCodexPet } from '@/surfaces/office/scene/office-companion/CodexPetProvider.js';
import { WorkBench } from '@/surfaces/office/scene/work-bench/WorkBench.js';
import { BrowserSessionView } from '@/surfaces/office/stage-browser/BrowserSessionView.js';
import { BrowserEmptyState } from '@/surfaces/office/stage-preview/BrowserEmptyState.js';
import { StageEmpty } from '@/surfaces/office/stage-preview/StageEmpty.js';
import { StagePreviewPane } from '@/surfaces/office/stage-preview/StagePreviewPane.js';
import {
  type PreviewSourceRef,
  previewRefViewerKind,
  viewerKindIcon,
} from '@/surfaces/office/stage-preview/preview-target.js';
import { TerminalSessionView } from '@/surfaces/office/stage-terminal/TerminalSessionView.js';
import {
  StageChromeProvider,
  useStageChrome,
} from '@/surfaces/office/stage-viewer/stage-chrome.js';
import type { DramaturgyMode, ToolRichDetail } from '@offisim/shared-types';
import {
  Box,
  Clapperboard,
  Coins,
  Columns3,
  Eye,
  EyeOff,
  FileCode2,
  FileText,
  Focus,
  Gauge,
  GitCompareArrows,
  Globe,
  Globe2,
  Maximize2,
  Minimize2,
  MonitorSmartphone,
  PanelLeftClose,
  PanelLeftOpen,
  PanelRightClose,
  PanelRightOpen,
  PawPrint,
  Plus,
  SlidersHorizontal,
  TerminalSquare,
  Users,
  X,
} from 'lucide-react';
import { useEffect, useMemo, useRef, useState } from 'react';
import { Group, Panel, Separator } from 'react-resizable-panels';

interface StageMenuItem {
  id: string;
  label: string;
  meta: string;
  isActive?: boolean;
  icon: typeof FileCode2;
  onSelect: () => void;
}

interface StageTopBarProps {
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

function latestBrowserDetail(
  activity: readonly { id: string; tool: string; richDetail?: ToolRichDetail }[],
) {
  return [...activity].reverse().find((entry) => entry.richDetail?.family === 'browser') ?? null;
}

function latestRichDetail(
  activity: readonly { id: string; tool: string; richDetail?: ToolRichDetail }[],
) {
  return [...activity].reverse().find((entry) => entry.richDetail) ?? null;
}

function newestDeliverable(deliverables: readonly Deliverable[]) {
  return deliverables[0] ?? null;
}

function htmlDeliverable(deliverables: readonly Deliverable[]) {
  return deliverables.find((d) => d.format?.toUpperCase() === 'HTML') ?? null;
}

export function StageTopBar({ isRunning, accounting }: StageTopBarProps) {
  const stagePrimaryTab = useUiState((s) => s.stagePrimaryTab);
  const setStagePrimaryTab = useUiState((s) => s.setStagePrimaryTab);
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

  const labelCounts = new Map<string, number>();
  for (const tab of stageOpenTabs) {
    const label = stageTabLabel(tab.target);
    labelCounts.set(label, (labelCounts.get(label) ?? 0) + 1);
  }

  return (
    <div className="off-stage-topbar">
      <button
        type="button"
        className="off-stage-rail-toggle off-focusable"
        data-rail="workspace"
        onClick={() => setLeftRailCollapsed(!leftRailCollapsed)}
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
          className={cn('off-stage-tab off-focusable', stagePrimaryTab === 'board' && 'is-active')}
          onClick={() => setStagePrimaryTab('board')}
          aria-current={stagePrimaryTab === 'board' ? 'page' : undefined}
          aria-label={`Board${pendingReviewCount ? `, ${pendingReviewCount} pending review` : ''}`}
          title="Board"
        >
          <Icon icon={Columns3} size="sm" />
          <span>Board</span>
          {pendingReviewCount > 0 ? (
            <b className="off-stage-tab-badge">{pendingReviewCount}</b>
          ) : null}
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

      <div className="off-stage-topbar-right">
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
          onClick={() => setRightRailCollapsed(!rightRailCollapsed)}
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
      return target.path ? fileLeaf(target.path) : 'Review';
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
      return target.path ?? 'Workspace changes';
    case 'logs':
      return target.tool ?? target.title ?? 'Terminal log';
    case 'terminal-session':
      return target.title ?? 'Interactive project terminal';
    case 'computer':
      return 'Computer Use';
  }
}

export function GameViewOptions() {
  const officeMode = useUiState((s) => s.officeMode);
  const setOfficeMode = useUiState((s) => s.setOfficeMode);
  const companionEnabled = useUiState((s) => s.officeCompanionEnabled);
  const setCompanionEnabled = useUiState((s) => s.setOfficeCompanionEnabled);
  const openSettings = useUiState((s) => s.openSettings);
  const { catalog, selectedPet } = useCodexPet();
  const [open, setOpen] = useState(false);
  const options = [
    { mode: 'focus', icon: Focus, label: 'Focus' },
    { mode: 'office', icon: Users, label: 'Office' },
    { mode: 'cinematic', icon: Clapperboard, label: 'Cinematic' },
  ] as ReadonlyArray<{ mode: DramaturgyMode; icon: typeof Focus; label: string }>;

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <button
          type="button"
          className="off-stage-view-options-btn off-focusable"
          aria-label="View options"
          title="View options"
        >
          <Icon icon={SlidersHorizontal} size="sm" />
          <span>View options</span>
        </button>
      </PopoverTrigger>
      <PopoverContent className="off-stage-view-pop is-compact" align="start">
        <div className="off-stage-view-pop-head">
          <CapsLabel>Game view</CapsLabel>
        </div>
        <div className="off-stage-view-options">
          {options.map((option) => (
            <button
              key={option.mode}
              type="button"
              className={cn(
                'off-stage-view-option off-focusable',
                officeMode === option.mode && 'is-active',
              )}
              onClick={() => {
                setOfficeMode(option.mode);
                setOpen(false);
              }}
            >
              <Icon icon={option.icon} size="sm" />
              <span className="off-stage-view-option-copy">
                <span className="off-stage-view-option-label">{option.label}</span>
                <span className="off-stage-view-option-meta">Game presentation</span>
              </span>
            </button>
          ))}
          <button
            type="button"
            className={cn('off-stage-view-option off-focusable', companionEnabled && 'is-active')}
            aria-pressed={companionEnabled}
            onClick={() => setCompanionEnabled(!companionEnabled)}
          >
            <Icon icon={companionEnabled ? PawPrint : EyeOff} size="sm" />
            <span className="off-stage-view-option-copy">
              <span className="off-stage-view-option-label">Show Codex pet</span>
              <span className="off-stage-view-option-meta">
                {selectedPet?.displayName ?? 'No local Codex pet'}
              </span>
            </span>
          </button>
          <button
            type="button"
            className="off-stage-view-option off-focusable"
            onClick={() => {
              openSettings('companion');
              setOpen(false);
            }}
          >
            <Icon icon={PawPrint} size="sm" />
            <span className="off-stage-view-option-copy">
              <span className="off-stage-view-option-label">Choose pet</span>
              <span className="off-stage-view-option-meta">
                {catalog ? `${catalog.pets.length} synced from Codex` : 'Syncing local catalog…'}
              </span>
            </span>
          </button>
        </div>
      </PopoverContent>
    </Popover>
  );
}

function StageViewMenu() {
  const [menuOpen, setMenuOpen] = useState(false);
  const selectedThreadId = useUiState((s) => s.selectedThreadId);
  const draftThreadId = useUiState((s) => s.draftThread?.id ?? null);
  const projectId = useUiState((s) => s.projectId);
  const companyId = useUiState((s) => s.companyId);
  const stageView = useUiState((s) => s.stageView);
  const stagePrimaryTab = useUiState((s) => s.stagePrimaryTab);
  const setStagePrimaryTab = useUiState((s) => s.setStagePrimaryTab);
  const openStageView = useUiState((s) => s.openStageView);
  const deliverables = useDeliverables(selectedThreadId);
  const git = useGitWorkbench(projectId);
  const runs = useActiveConversationRuns();
  const run = runs.runs.find((candidate) => candidate.threadId === selectedThreadId) ?? null;
  const latestBrowser = run ? latestBrowserDetail(run.activity) : null;
  const latestBrowserRichDetail =
    latestBrowser?.richDetail?.family === 'browser' ? latestBrowser.richDetail : null;
  const latestLog = run ? latestRichDetail(run.activity) : null;
  const latestOutput = newestDeliverable(deliverables.data ?? []);
  const latestHtmlOutput = htmlDeliverable(deliverables.data ?? []);
  const gitChanges = workbenchOf(git.data)?.changes ?? [];
  const latestChange = gitChanges[0] ?? null;
  const selectedFile =
    stageView.kind === 'preview' && stageView.ref.source === 'workspace-file'
      ? { target: stageView, path: stageView.ref.path }
      : null;
  const persistedSessionThreadId = selectedThreadId === draftThreadId ? null : selectedThreadId;

  const items: StageMenuItem[] = [
    {
      id: 'output',
      label: 'Output',
      meta: latestOutput
        ? `${latestOutput.name} · ${latestOutput.format ?? 'TXT'}`
        : 'Open the output guide',
      isActive:
        stageView.kind === 'preview' &&
        stageView.ref.source === 'deliverable' &&
        stageView.ref.deliverableId === latestOutput?.id,
      icon: FileCode2,
      onSelect: () => {
        if (!latestOutput) {
          setStagePrimaryTab('preview', true);
          return;
        }
        openStageView({
          kind: 'preview',
          ref: {
            source: 'deliverable',
            deliverableId: latestOutput.id,
            threadId: selectedThreadId,
            format: latestOutput.format ?? undefined,
            name: latestOutput.name,
          },
          title: latestOutput.name,
        });
      },
    },
    {
      id: 'browser',
      label: 'Browser',
      meta: 'Navigate the web in Stage',
      isActive: stageView.kind === 'browser-session',
      icon: Globe,
      onSelect: () => {
        if (!companyId || !projectId) return;
        openStageView({
          kind: 'browser-session',
          sessionId: crypto.randomUUID(),
          scope: { companyId, projectId, threadId: persistedSessionThreadId },
          initialUrl: 'https://example.com/',
          title: 'Browser',
        });
      },
    },
    {
      id: 'browser-activity',
      label: 'Browser activity',
      meta: latestBrowserRichDetail
        ? latestBrowserRichDetail.title ||
          latestBrowserRichDetail.url ||
          latestBrowser?.tool ||
          'Agent browser page'
        : 'Open the read-only agent preview',
      isActive:
        stageView.kind === 'preview' &&
        (stageView.ref.source === 'browser' || stageView.ref.source === 'screenshot'),
      icon: Eye,
      onSelect: () => {
        if (!latestBrowserRichDetail) {
          openStageView({
            kind: 'preview',
            ref: { source: 'browser', sourceId: 'agent-latest' },
            title: 'Browser activity',
          });
          return;
        }
        openStageView({
          kind: 'preview',
          ref: {
            source: 'browser',
            sourceId: latestBrowser?.id,
            url: latestBrowserRichDetail.url,
            detail: latestBrowserRichDetail,
          },
          title: latestBrowserRichDetail.title ?? latestBrowser?.tool,
        });
      },
    },
    {
      id: 'preview',
      label: 'Preview',
      meta: latestHtmlOutput ? latestHtmlOutput.name : 'Open the preview guide',
      // Only owns the highlight when it points at a DIFFERENT deliverable than
      // Output (i.e. an older HTML output); when the newest output is itself the
      // HTML one, Output owns the highlight so the two entries never both light up.
      isActive:
        stageView.kind === 'preview' &&
        stageView.ref.source === 'deliverable' &&
        stageView.ref.deliverableId === latestHtmlOutput?.id &&
        latestHtmlOutput?.id !== latestOutput?.id,
      icon: Eye,
      onSelect: () => {
        if (!latestHtmlOutput) {
          setStagePrimaryTab('preview', true);
          return;
        }
        openStageView({
          kind: 'preview',
          ref: {
            source: 'deliverable',
            deliverableId: latestHtmlOutput.id,
            threadId: selectedThreadId,
            format: latestHtmlOutput.format ?? undefined,
            name: latestHtmlOutput.name,
          },
          title: latestHtmlOutput.name,
        });
      },
    },
    {
      id: 'changes',
      label: 'Review',
      meta: latestChange
        ? `${gitChanges.length} changed · ${latestChange.path}`
        : 'Open the review guide',
      isActive: stageView.kind === 'changes',
      icon: GitCompareArrows,
      onSelect: () => {
        if (!latestChange) {
          setStagePrimaryTab('review', true);
          return;
        }
        openStageView({ kind: 'changes', path: latestChange.path });
      },
    },
    {
      id: 'terminal',
      label: 'Terminal',
      meta: 'Interactive project shell',
      isActive: stageView.kind === 'terminal-session',
      icon: TerminalSquare,
      onSelect: () => {
        if (!companyId || !projectId) return;
        openStageView({
          kind: 'terminal-session',
          sessionId: crypto.randomUUID(),
          scope: { companyId, projectId, threadId: persistedSessionThreadId },
          title: 'Terminal',
        });
      },
    },
    {
      id: 'logs',
      label: 'Run log',
      meta: latestLog ? latestLog.tool : 'Open the read-only agent run mirror',
      isActive: stageView.kind === 'logs',
      icon: FileText,
      onSelect: () => {
        if (!latestLog) {
          setStagePrimaryTab('terminal', true);
          return;
        }
        openStageView({
          kind: 'logs',
          sourceId: latestLog.id,
          title: latestLog.tool,
          tool: latestLog.tool,
          detail: latestLog.richDetail,
        });
      },
    },
    {
      id: 'files',
      label: 'Files',
      meta: selectedFile ? selectedFile.path : 'Open the file preview guide',
      isActive: Boolean(selectedFile),
      icon: FileText,
      onSelect: () => {
        if (selectedFile) {
          openStageView(selectedFile.target);
          return;
        }
        setStagePrimaryTab('preview', true);
      },
    },
    {
      id: 'computer',
      label: 'Computer',
      meta: selectedThreadId ? 'Open Computer Use activity' : 'Open the Computer Use guide',
      isActive: stageView.kind === 'computer',
      icon: MonitorSmartphone,
      onSelect: () => openStageView({ kind: 'computer', threadId: selectedThreadId }),
    },
  ];

  return (
    <Popover open={menuOpen} onOpenChange={setMenuOpen}>
      <PopoverTrigger asChild>
        <button
          type="button"
          className={cn(
            'off-stage-view-trigger off-focusable',
            stagePrimaryTab !== 'game' && 'is-on',
          )}
          title="Open view"
          aria-label="Open view"
        >
          <Icon icon={Plus} size="sm" />
        </button>
      </PopoverTrigger>
      <PopoverContent className="off-stage-view-pop" align="start">
        <div className="off-stage-view-pop-head">
          <CapsLabel>Open view</CapsLabel>
        </div>
        <div className="off-stage-view-options">
          {items.map((item) => (
            <button
              key={item.id}
              type="button"
              className={cn('off-stage-view-option off-focusable', item.isActive && 'is-active')}
              onClick={() => {
                item.onSelect();
                setMenuOpen(false);
              }}
            >
              <Icon icon={item.icon} size="sm" />
              <span className="off-stage-view-option-copy">
                <span className="off-stage-view-option-label">{item.label}</span>
                <span className="off-stage-view-option-meta">{item.meta}</span>
              </span>
            </button>
          ))}
        </div>
      </PopoverContent>
    </Popover>
  );
}

export function StageAutoOpen() {
  const selectedThreadId = useUiState((s) => s.selectedThreadId);
  return (
    <>
      <BoardPendingReviewAutoOpen />
      {selectedThreadId ? (
        <StageAutoOpenForThread key={selectedThreadId} threadId={selectedThreadId} />
      ) : null}
    </>
  );
}

function StageAutoOpenForThread({ threadId }: { threadId: string }) {
  const openStageView = useUiState((s) => s.openStageView);
  const deliverables = useDeliverables(threadId);
  const runs = useActiveConversationRuns();
  const run = runs.runs.find((candidate) => candidate.threadId === threadId) ?? null;
  const seenDeliverables = useRef<Set<string> | null>(null);
  const seenBrowserActivities = useRef<Set<string> | null>(null);
  const seenComputerActivities = useRef<Set<string> | null>(null);

  useEffect(() => {
    const rows = deliverables.data;
    if (!rows) return;
    const ids = new Set(rows.map((d) => d.id));
    if (!seenDeliverables.current) {
      seenDeliverables.current = ids;
      return;
    }
    const fresh = rows.find((d) => !seenDeliverables.current?.has(d.id));
    seenDeliverables.current = ids;
    if (!fresh) return;
    openStageView({
      kind: 'preview',
      ref: {
        source: 'deliverable',
        deliverableId: fresh.id,
        threadId,
        format: fresh.format ?? undefined,
        name: fresh.name,
      },
      title: fresh.name,
    });
  }, [deliverables.data, openStageView, threadId]);

  useEffect(() => {
    if (!run) return;
    const browserActivities = run.activity.filter(
      (entry) =>
        entry.richDetail?.family === 'browser' &&
        (entry.richDetail.url || entry.richDetail.screenshot),
    );
    const ids = new Set(browserActivities.map((entry) => entry.id));
    if (!seenBrowserActivities.current) {
      seenBrowserActivities.current = ids;
      return;
    }
    const latest = [...browserActivities]
      .reverse()
      .find((entry) => !seenBrowserActivities.current?.has(entry.id));
    seenBrowserActivities.current = ids;
    if (!latest?.richDetail || latest.richDetail.family !== 'browser') return;
    openStageView({
      kind: 'preview',
      ref: {
        source: 'browser',
        sourceId: latest.id,
        url: latest.richDetail.url,
        detail: latest.richDetail,
      },
      title: latest.richDetail.title ?? latest.tool,
    });
  }, [openStageView, run]);

  useEffect(() => {
    if (!run) return;
    const computerActivities = run.activity.filter(
      (entry) => entry.richDetail?.family === 'computer',
    );
    const ids = new Set(computerActivities.map((entry) => entry.id));
    if (!seenComputerActivities.current) {
      seenComputerActivities.current = ids;
      return;
    }
    const latest = [...computerActivities]
      .reverse()
      .find((entry) => !seenComputerActivities.current?.has(entry.id));
    seenComputerActivities.current = ids;
    if (!latest) return;
    openStageView({ kind: 'computer', threadId });
  }, [openStageView, run, threadId]);

  return null;
}

export function StageViewer() {
  const stagePrimaryTab = useUiState((s) => s.stagePrimaryTab);
  const stageView = useUiState((s) => s.stageView);
  const stageOpenTabs = useUiState((s) => s.stageOpenTabs);
  const activeStageTabId = useUiState((s) => s.activeStageTabId);
  const stageSplitTabId = useUiState((s) => s.stageSplitTabId);
  const stageSplitLayout = useUiState((s) => s.stageSplitLayout);
  const setStageSplitLayout = useUiState((s) => s.setStageSplitLayout);
  const viewerTab = stagePrimaryTab;
  if (viewerTab === 'game') return null;
  const visibleTarget =
    stageView.kind !== 'scene' && stageTabForTarget(stageView) === viewerTab ? stageView : null;
  const splitTab =
    viewerTab !== 'board' && stageSplitTabId !== activeStageTabId
      ? (stageOpenTabs.find((tab) => tab.id === stageSplitTabId) ?? null)
      : null;
  return (
    <section className="off-stage-viewer" aria-label="Stage viewer">
      {splitTab ? (
        <Group
          orientation="horizontal"
          className="off-stage-split"
          id="stage-split-view"
          defaultLayout={stageSplitLayout}
          onLayoutChanged={setStageSplitLayout}
        >
          <Panel id="stage-primary" minSize="30%">
            <StageViewPane tab={viewerTab} target={visibleTarget} tabId={activeStageTabId} />
          </Panel>
          <Separator
            className="off-resize-handle off-stage-split-handle"
            aria-label="Resize stage views"
          />
          <Panel id="stage-secondary" minSize="30%">
            <StageViewPane
              tab={stageTabForTarget(splitTab.target)}
              target={splitTab.target}
              tabId={splitTab.id}
              split
            />
          </Panel>
        </Group>
      ) : (
        <StageViewPane tab={viewerTab} target={visibleTarget} tabId={activeStageTabId} />
      )}
    </section>
  );
}

function StageViewPane({
  tab,
  target,
  tabId,
  split = false,
}: {
  tab: Exclude<StagePrimaryTab, 'game'>;
  target: StageViewTarget | null;
  tabId: string | null;
  split?: boolean;
}) {
  return (
    <StageChromeProvider>
      <section
        className={cn('off-stage-viewer-pane', split && 'is-split')}
        aria-label={split ? `Pinned ${viewerTitle(tab)} view` : `${viewerTitle(tab)} view`}
      >
        <StageViewerHead tab={tab} target={target} tabId={tabId} split={split} />
        <div className="off-stage-viewer-body">
          <StageTabBody tab={tab} target={target} />
        </div>
      </section>
    </StageChromeProvider>
  );
}

function StageViewerHead({
  tab,
  target,
  tabId,
  split,
}: {
  tab: Exclude<StagePrimaryTab, 'game'>;
  target: StageViewTarget | null;
  tabId: string | null;
  split: boolean;
}) {
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

function StageTabBody({
  tab,
  target,
}: {
  tab: Exclude<StagePrimaryTab, 'game'>;
  target: StageViewTarget | null;
}) {
  if (tab === 'board') return <BoardStage />;
  if (tab === 'preview') {
    if (target?.kind === 'browser-session') {
      return <BrowserSessionView key={target.sessionId} target={target} />;
    }
    if (
      target?.kind === 'preview' &&
      target.ref.source === 'browser' &&
      !target.ref.url &&
      !target.ref.detail?.url &&
      !target.ref.detail?.screenshot
    ) {
      return <BrowserEmptyState sourceId={target.ref.sourceId ?? 'manual'} />;
    }
    if (target?.kind === 'preview') return <StagePreviewPane target={target} />;
    return (
      <StageEmpty
        icon={Globe2}
        title="No preview open"
        detail="Outputs, workspace files, browser pages, and screenshots appear here when available."
      />
    );
  }
  if (tab === 'computer') {
    return <ComputerView threadId={target?.kind === 'computer' ? target.threadId : null} />;
  }
  if (tab === 'terminal') {
    if (target?.kind === 'terminal-session') return <TerminalSessionView target={target} />;
    if (target?.kind === 'logs') return <LogsView target={target} />;
    return (
      <StageEmpty
        icon={TerminalSquare}
        title="No terminal log"
        detail="This is a read-only mirror of agent terminal and tool runs. Activity appears here automatically."
      />
    );
  }
  if (tab === 'review') {
    if (target?.kind === 'changes') return <ChangesView target={target} />;
    return <ReviewEmpty />;
  }
  return (
    <StageEmpty title="No preview open" detail="Open an output or workspace file to inspect it." />
  );
}

function ViewerIcon({ tab }: { tab: StagePrimaryTab }) {
  const icon = PRIMARY_TABS.find((candidate) => candidate.id === tab)?.icon ?? Box;
  return <Icon icon={icon} size="sm" className="off-stage-viewer-icon" />;
}

function viewerTitle(tab: StagePrimaryTab) {
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

/** Review-tab empty state that mirrors the workspace Git panel: a valid folder
 *  that is not yet a repo (or a missing folder) points at the Git tab where the
 *  Initialize/Rebind actions live, instead of a generic "no changes" message
 *  that cannot tell non-repo from a clean tree. */
function ReviewEmpty() {
  const projectId = useUiState((s) => s.projectId);
  const git = useGitWorkbench(projectId);
  if (git.data?.status === 'uninitialized') {
    return (
      <StageEmpty
        icon={GitCompareArrows}
        title="Not a git repository yet"
        detail="Initialize a repository from the Git tab in the workspace rail to review diffs here."
      />
    );
  }
  if (git.data?.status === 'invalid-folder') {
    return (
      <StageEmpty
        icon={GitCompareArrows}
        title="Workspace folder not found"
        detail="Rebind this project to a folder that exists from the Git tab in the workspace rail."
      />
    );
  }
  return (
    <StageEmpty
      icon={GitCompareArrows}
      title="No changes to review"
      detail="Git diffs and changed files will appear here when the workspace changes."
    />
  );
}

function ChangesView({
  target,
}: {
  target: Extract<StageViewTarget, { kind: 'changes' }>;
}) {
  const setStageMaximized = useUiState((state) => state.setOfficeStageMaximized);
  useEffect(() => setStageMaximized(true), [setStageMaximized]);
  if (target.leaseId) {
    return (
      <ReviewWorkbenchStage
        leaseId={target.leaseId}
        initialPath={target.path}
        fallbackFiles={target.files}
      />
    );
  }
  return target.files ? (
    <LeaseChangesView target={{ ...target, files: target.files }} />
  ) : (
    <WorkspaceChangesView target={target} />
  );
}

function LeaseChangesView({
  target,
}: {
  target: Extract<StageViewTarget, { kind: 'changes' }> & {
    files: NonNullable<Extract<StageViewTarget, { kind: 'changes' }>['files']>;
  };
}) {
  const document = useMemo(() => parseUnifiedDiffFiles(target.files), [target.files]);
  return (
    <div className="off-stage-changes is-lease-review">
      <DiffPanel document={document} mode="readonly" initialPath={target.path} />
    </div>
  );
}

function WorkspaceChangesView({
  target,
}: {
  target: Extract<StageViewTarget, { kind: 'changes' }>;
}) {
  const projectId = useUiState((s) => s.projectId);
  const git = useGitWorkbench(projectId);
  const workbench = workbenchOf(git.data);
  const document = useMemo(
    () => parseUnifiedDiffFiles(workbench?.diffFiles ?? []),
    [workbench?.diffFiles],
  );
  if (git.isLoading)
    return <StageEmpty title="Loading changes" detail="Reading workspace status." />;
  if (!workbench)
    return <StageEmpty title="No changes" detail="This project has no git workbench data." />;
  return (
    <div className="off-stage-changes">
      <DiffPanel document={document} mode="readonly" initialPath={target.path} />
    </div>
  );
}

function LogsView({
  target,
}: {
  target: Extract<StageViewTarget, { kind: 'logs' }>;
}) {
  if (!target.detail)
    return (
      <StageEmpty title="No log detail" detail="The latest tool has no structured detail yet." />
    );
  return (
    <div className="off-stage-logs">
      <WorkBench detail={target.detail} status={target.status ?? 'done'} />
    </div>
  );
}
