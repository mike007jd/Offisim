import {
  type StageOpenTarget,
  type StagePrimaryTab,
  type StageViewTarget,
  stageTabForTarget,
  useUiState,
} from '@/app/ui-state.js';
import { useActiveConversationRuns } from '@/assistant/runtime/conversation-run-react.js';
import { workbenchOf } from '@/data/git-workbench.js';
import { useDeliverables, useGitWorkbench } from '@/data/queries.js';
import type { Deliverable, GitFileChange } from '@/data/types.js';
import { CapsLabel } from '@/design-system/grammar/CapsLabel.js';
import { Icon } from '@/design-system/icons/Icon.js';
import { Popover, PopoverContent, PopoverTrigger } from '@/design-system/primitives/popover.js';
import { cn } from '@/lib/utils.js';
import { ComputerView } from '@/surfaces/office/computer/ComputerView.js';
import { WorkBench } from '@/surfaces/office/scene/work-bench/WorkBench.js';
import { StagePreviewPane } from '@/surfaces/office/stage-preview/StagePreviewPane.js';
import {
  type PreviewSourceRef,
  previewRefViewerKind,
  viewerKindIcon,
} from '@/surfaces/office/stage-preview/preview-target.js';
import {
  StageChromeProvider,
  useStageChrome,
} from '@/surfaces/office/stage-viewer/stage-chrome.js';
import { DiffPanel } from '@/surfaces/tasks/DiffPanel.js';
import type { DramaturgyMode, ToolRichDetail } from '@offisim/shared-types';
import {
  Box,
  Clapperboard,
  Coins,
  Eye,
  FileCode2,
  FileText,
  Focus,
  GitCompareArrows,
  Globe,
  Globe2,
  Maximize2,
  Minimize2,
  MonitorSmartphone,
  Plus,
  SlidersHorizontal,
  TerminalSquare,
  Users,
  X,
} from 'lucide-react';
import { useEffect, useRef, useState } from 'react';

interface StageMenuItem {
  id: string;
  label: string;
  meta: string;
  disabled?: boolean;
  isActive?: boolean;
  icon: typeof FileCode2;
  onSelect: () => void;
}

interface StageTopBarProps {
  isRunning: boolean;
  tokensLabel: string;
  costLabel: string;
}

const PRIMARY_TABS = [
  { id: 'game', label: 'Game View', icon: Box },
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

export function StageTopBar({ isRunning, tokensLabel, costLabel }: StageTopBarProps) {
  const stagePrimaryTab = useUiState((s) => s.stagePrimaryTab);
  const setStagePrimaryTab = useUiState((s) => s.setStagePrimaryTab);
  const stageOpenTabs = useUiState((s) => s.stageOpenTabs);
  const activeStageTabId = useUiState((s) => s.activeStageTabId);
  const activateStageTab = useUiState((s) => s.activateStageTab);
  const closeStageTab = useUiState((s) => s.closeStageTab);
  const stageMaximized = useUiState((s) => s.officeStageMaximized);
  const setStageMaximized = useUiState((s) => s.setOfficeStageMaximized);

  const labelCounts = new Map<string, number>();
  for (const tab of stageOpenTabs) {
    const label = stageTabLabel(tab.target);
    labelCounts.set(label, (labelCounts.get(label) ?? 0) + 1);
  }

  return (
    <div className="off-stage-topbar">
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
            >
              <button
                type="button"
                className="off-stage-tab off-focusable"
                onClick={() => activateStageTab(tab.id)}
                onAuxClick={(event) => {
                  if (event.button === 1) closeStageTab(tab.id);
                }}
                aria-current={activeStageTabId === tab.id ? 'page' : undefined}
                aria-label={label}
                title={stageTabTitle(tab.target)}
              >
                <Icon icon={stageTabIcon(tab.target)} size="sm" />
                <span>{label}</span>
              </button>
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
        <output className={cn('off-stage-readout', isRunning && 'is-live')} aria-label="Run cost">
          <span className="off-stage-readout-part">
            <Icon icon={Coins} size="sm" />
            <b>{tokensLabel}</b> tok
          </span>
          <span className="off-stage-readout-div" />
          <b>{costLabel}</b>
          {isRunning ? (
            <>
              <span className="off-stage-readout-div" />
              <span className="off-stage-run-state">live</span>
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
    case 'changes':
      return target.path ? fileLeaf(target.path) : 'Review';
    case 'logs':
      return target.tool ?? target.title ?? 'Terminal';
    case 'computer':
      return 'Computer';
  }
}

function stageTabTitle(target: StageOpenTarget) {
  switch (target.kind) {
    case 'preview':
      return target.title ?? previewRefTitle(target.ref);
    case 'changes':
      return target.path ?? 'Workspace changes';
    case 'logs':
      return target.tool ?? target.title ?? 'Terminal log';
    case 'computer':
      return 'Computer Use';
  }
}

export function GameViewOptions() {
  const officeMode = useUiState((s) => s.officeMode);
  const setOfficeMode = useUiState((s) => s.setOfficeMode);
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
        </div>
      </PopoverContent>
    </Popover>
  );
}

function StageViewMenu() {
  const [menuOpen, setMenuOpen] = useState(false);
  const selectedThreadId = useUiState((s) => s.selectedThreadId);
  const projectId = useUiState((s) => s.projectId);
  const stageView = useUiState((s) => s.stageView);
  const stagePrimaryTab = useUiState((s) => s.stagePrimaryTab);
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

  const items: StageMenuItem[] = [
    {
      id: 'output',
      label: 'Output',
      meta: latestOutput
        ? `${latestOutput.name} · ${latestOutput.format ?? 'TXT'}`
        : 'No output yet',
      disabled: !latestOutput,
      isActive:
        stageView.kind === 'preview' &&
        stageView.ref.source === 'deliverable' &&
        stageView.ref.deliverableId === latestOutput?.id,
      icon: FileCode2,
      onSelect: () => {
        if (!latestOutput) return;
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
      meta: latestBrowserRichDetail
        ? latestBrowserRichDetail.title ||
          latestBrowserRichDetail.url ||
          latestBrowser?.tool ||
          'Browser page'
        : 'No browser page yet',
      disabled: !latestBrowserRichDetail,
      isActive:
        stageView.kind === 'preview' &&
        (stageView.ref.source === 'browser' || stageView.ref.source === 'screenshot'),
      icon: Globe,
      onSelect: () => {
        if (!latestBrowserRichDetail) return;
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
      meta: latestHtmlOutput ? latestHtmlOutput.name : 'No preview yet',
      disabled: !latestHtmlOutput,
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
        if (!latestHtmlOutput) return;
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
        : 'No local changes',
      disabled: !latestChange,
      isActive: stageView.kind === 'changes',
      icon: GitCompareArrows,
      onSelect: () => openStageView({ kind: 'changes', path: latestChange?.path ?? null }),
    },
    {
      id: 'logs',
      label: 'Terminal',
      meta: latestLog ? latestLog.tool : 'No tool logs yet',
      disabled: !latestLog,
      isActive: stageView.kind === 'logs',
      icon: TerminalSquare,
      onSelect: () => {
        if (!latestLog) return;
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
      meta: selectedFile ? selectedFile.path : 'Pick a file on the left',
      disabled: !selectedFile,
      isActive: Boolean(selectedFile),
      icon: FileText,
      onSelect: () => {
        if (selectedFile) openStageView(selectedFile.target);
      },
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
              disabled={item.disabled}
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
  if (!selectedThreadId) return null;
  return <StageAutoOpenForThread key={selectedThreadId} threadId={selectedThreadId} />;
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
  const viewerTab = stagePrimaryTab;
  if (viewerTab === 'game') return null;
  const visibleTarget =
    stageView.kind !== 'scene' && stageTabForTarget(stageView) === viewerTab ? stageView : null;
  return (
    <StageChromeProvider>
      <section className="off-stage-viewer" aria-label="Stage viewer">
        <StageViewerHead tab={viewerTab} target={visibleTarget} />
        <div className="off-stage-viewer-body">
          <StageTabBody tab={viewerTab} target={visibleTarget} />
        </div>
      </section>
    </StageChromeProvider>
  );
}

function StageViewerHead({
  tab,
  target,
}: {
  tab: Exclude<StagePrimaryTab, 'game'>;
  target: StageViewTarget | null;
}) {
  const closeStageView = useUiState((s) => s.closeStageView);
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
      {chrome?.actions ? <div className="off-preview-actions">{chrome.actions}</div> : null}
      <button
        type="button"
        className="off-stage-viewer-close off-focusable"
        onClick={closeStageView}
        title="Close view"
      >
        <Icon icon={X} size="sm" />
      </button>
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
  if (tab === 'preview') {
    if (target?.kind === 'preview') return <StagePreviewPane target={target} />;
    return (
      <StageEmpty
        title="No preview open"
        detail="Outputs, workspace files, browser pages, and screenshots appear here when available."
      />
    );
  }
  if (tab === 'computer') {
    return <ComputerView threadId={target?.kind === 'computer' ? target.threadId : null} />;
  }
  if (tab === 'terminal') {
    if (target?.kind === 'logs') return <LogsView target={target} />;
    return (
      <StageEmpty
        title="No terminal log"
        detail="Tool and terminal activity will appear here as a read-only run log."
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
    default:
      return 'Office scene';
  }
}

function viewerMeta(target: StageViewTarget) {
  switch (target.kind) {
    case 'preview':
      return target.title ?? previewRefMeta(target.ref);
    case 'changes':
      return target.path ?? 'Workspace diff';
    case 'logs':
      return target.tool ?? target.title ?? 'Tool run';
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
        title="Not a git repository yet"
        detail="Initialize a repository from the Git tab in the workspace rail to review diffs here."
      />
    );
  }
  if (git.data?.status === 'invalid-folder') {
    return (
      <StageEmpty
        title="Workspace folder not found"
        detail="Rebind this project to a folder that exists from the Git tab in the workspace rail."
      />
    );
  }
  return (
    <StageEmpty
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
  const projectId = useUiState((s) => s.projectId);
  const openStageView = useUiState((s) => s.openStageView);
  const git = useGitWorkbench(projectId);
  const workbench = workbenchOf(git.data);
  if (git.isLoading)
    return <StageEmpty title="Loading changes" detail="Reading workspace status." />;
  if (!workbench)
    return <StageEmpty title="No changes" detail="This project has no git workbench data." />;
  return (
    <div className="off-stage-changes">
      <div className="off-stage-change-list">
        {workbench.changes.map((change) => (
          <button
            key={change.path}
            type="button"
            className={cn(
              'off-stage-change-row off-focusable',
              target.path === change.path && 'is-active',
            )}
            onClick={() => openStageView({ kind: 'changes', path: change.path })}
          >
            <ChangeStatus change={change} />
            <span className="off-stage-change-path">{change.path}</span>
            <span className="off-stage-change-stat">
              +{change.added} -{change.removed}
            </span>
          </button>
        ))}
      </div>
      <DiffPanel files={workbench.diffFiles} status="workspace" initialPath={target.path} />
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

function ChangeStatus({ change }: { change: GitFileChange }) {
  const glyph: Record<GitFileChange['status'], string> = {
    added: 'A',
    modified: 'M',
    deleted: 'D',
    renamed: 'R',
  };
  return (
    <span className={cn('off-stage-change-status', `is-${change.status}`)}>
      {glyph[change.status]}
    </span>
  );
}

function StageEmpty({ title, detail }: { title: string; detail: string }) {
  return (
    <div className="off-stage-empty">
      <strong>{title}</strong>
      <span>{detail}</span>
    </div>
  );
}
