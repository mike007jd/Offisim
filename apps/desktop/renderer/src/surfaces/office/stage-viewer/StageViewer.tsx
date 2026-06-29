import {
  type StagePrimaryTab,
  type StageViewTarget,
  stageTabForTarget,
  useUiState,
} from '@/app/ui-state.js';
import { useActiveConversationRuns } from '@/assistant/runtime/conversation-run-react.js';
import { loadDeliverableBody, useDeliverables, useGitWorkbench } from '@/data/queries.js';
import type { Deliverable, GitFileChange } from '@/data/types.js';
import { CapsLabel } from '@/design-system/grammar/CapsLabel.js';
import { Icon } from '@/design-system/icons/Icon.js';
import { Popover, PopoverContent, PopoverTrigger } from '@/design-system/primitives/popover.js';
import { cn } from '@/lib/utils.js';
import { WorkBench } from '@/surfaces/office/scene/work-bench/WorkBench.js';
import type { DramaturgyMode, ToolRichDetail } from '@offisim/shared-types';
import {
  Box,
  Clapperboard,
  Coins,
  FileCode2,
  FileText,
  Focus,
  GitCompareArrows,
  Globe2,
  LayoutPanelTop,
  Maximize2,
  Minimize2,
  Plus,
  SlidersHorizontal,
  TerminalSquare,
  Users,
  X,
} from 'lucide-react';
import { useEffect, useRef, useState } from 'react';

type StageViewKind = Exclude<StageViewTarget['kind'], 'scene'>;

interface StageMenuItem {
  kind: StageViewKind;
  label: string;
  meta: string;
  disabled?: boolean;
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
  { id: 'browser', label: 'Browser', icon: Globe2 },
  { id: 'terminal', label: 'Terminal', icon: TerminalSquare },
  { id: 'review', label: 'Review', icon: GitCompareArrows },
  { id: 'files', label: 'Files', icon: FileText },
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
  const selectedThreadId = useUiState((s) => s.selectedThreadId);
  const projectId = useUiState((s) => s.projectId);
  const stagePrimaryTab = useUiState((s) => s.stagePrimaryTab);
  const setStagePrimaryTab = useUiState((s) => s.setStagePrimaryTab);
  const stageView = useUiState((s) => s.stageView);
  const openStageView = useUiState((s) => s.openStageView);
  const sceneRenderMode = useUiState((s) => s.sceneRenderMode);
  const setSceneRenderMode = useUiState((s) => s.setSceneRenderMode);
  const stageMaximized = useUiState((s) => s.officeStageMaximized);
  const setStageMaximized = useUiState((s) => s.setOfficeStageMaximized);
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
  const latestChange = git.data?.changes[0] ?? null;

  function selectPrimaryTab(tab: StagePrimaryTab) {
    if (tab === 'game') {
      setStagePrimaryTab('game');
      return;
    }
    if (stageView.kind !== 'scene' && stageTabForTarget(stageView) === tab) {
      setStagePrimaryTab(tab);
      return;
    }
    if (tab === 'browser') {
      if (latestBrowserRichDetail) {
        openStageView({
          kind: 'preview',
          sourceId: latestBrowser?.id,
          title: latestBrowserRichDetail.title ?? latestBrowser?.tool,
          url: latestBrowserRichDetail.url,
          detail: latestBrowserRichDetail,
        });
        return;
      }
      if (latestHtmlOutput) {
        openStageView({
          kind: 'preview',
          deliverableId: latestHtmlOutput.id,
          threadId: selectedThreadId,
          title: latestHtmlOutput.name,
        });
        return;
      }
      setStagePrimaryTab('browser');
      return;
    }
    if (tab === 'terminal') {
      if (latestLog) {
        openStageView({
          kind: 'logs',
          sourceId: latestLog.id,
          title: latestLog.tool,
          tool: latestLog.tool,
          detail: latestLog.richDetail,
        });
        return;
      }
      setStagePrimaryTab('terminal');
      return;
    }
    if (tab === 'review') {
      if (latestChange) {
        openStageView({ kind: 'changes', path: latestChange.path });
        return;
      }
      setStagePrimaryTab('review');
      return;
    }
    if (stageView.kind === 'file' || stageView.kind === 'output') {
      setStagePrimaryTab('files');
      return;
    }
    if (latestOutput) {
      openStageView({
        kind: 'output',
        deliverableId: latestOutput.id,
        threadId: selectedThreadId,
        title: latestOutput.name,
      });
      return;
    }
    setStagePrimaryTab('files');
  }

  return (
    <div className="off-stage-topbar">
      <nav className="off-stage-tabs" aria-label="Stage views">
        {PRIMARY_TABS.map((tab) => (
          <button
            key={tab.id}
            type="button"
            className={cn('off-stage-tab off-focusable', stagePrimaryTab === tab.id && 'is-active')}
            onClick={() => selectPrimaryTab(tab.id)}
            aria-current={stagePrimaryTab === tab.id ? 'page' : undefined}
            aria-label={tab.label}
            title={tab.label}
          >
            <Icon icon={tab.icon} size="sm" />
            <span>{tab.label}</span>
          </button>
        ))}
        <StageViewMenu />
      </nav>

      {stagePrimaryTab === 'game' ? (
        <div className="off-stage-game-tools">
          <div className="off-stage-render-toggle" aria-label="Game view render mode">
            <button
              type="button"
              className={cn(
                'off-stage-mode-btn off-focusable',
                sceneRenderMode === '3d' && 'is-on',
              )}
              onClick={() => setSceneRenderMode('3d')}
            >
              <Icon icon={Box} size="sm" />
              3D
            </button>
            <button
              type="button"
              className={cn(
                'off-stage-mode-btn off-focusable',
                sceneRenderMode === '2d' && 'is-on',
              )}
              onClick={() => setSceneRenderMode('2d')}
            >
              <Icon icon={LayoutPanelTop} size="sm" />
              2D
            </button>
          </div>
          <GameViewOptions />
        </div>
      ) : null}

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

function GameViewOptions() {
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

export function StageViewMenu() {
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
  const latestChange = git.data?.changes[0] ?? null;
  const selectedFile = stageView.kind === 'file' ? stageView : null;

  const items: StageMenuItem[] = [
    {
      kind: 'output',
      label: 'Output',
      meta: latestOutput
        ? `${latestOutput.name} · ${latestOutput.format ?? 'TXT'}`
        : 'No output yet',
      disabled: !latestOutput,
      icon: FileCode2,
      onSelect: () => {
        if (!latestOutput) return;
        openStageView({
          kind: 'output',
          deliverableId: latestOutput.id,
          threadId: selectedThreadId,
          title: latestOutput.name,
        });
      },
    },
    {
      kind: 'preview',
      label: 'Preview',
      meta: latestBrowserRichDetail
        ? latestBrowserRichDetail.title ||
          latestBrowserRichDetail.url ||
          latestBrowser?.tool ||
          'Browser'
        : latestHtmlOutput
          ? latestHtmlOutput.name
          : 'No preview yet',
      disabled: !latestBrowserRichDetail && !latestHtmlOutput,
      icon: Globe2,
      onSelect: () => {
        if (latestBrowserRichDetail) {
          openStageView({
            kind: 'preview',
            sourceId: latestBrowser?.id,
            title: latestBrowserRichDetail.title ?? latestBrowser?.tool,
            url: latestBrowserRichDetail.url,
            detail: latestBrowserRichDetail,
          });
          return;
        }
        if (latestHtmlOutput) {
          openStageView({
            kind: 'preview',
            deliverableId: latestHtmlOutput.id,
            threadId: selectedThreadId,
            title: latestHtmlOutput.name,
          });
        }
      },
    },
    {
      kind: 'changes',
      label: 'Changes',
      meta: latestChange
        ? `${git.data?.changes.length ?? 0} changed · ${latestChange.path}`
        : 'No local changes',
      disabled: !latestChange,
      icon: GitCompareArrows,
      onSelect: () => openStageView({ kind: 'changes', path: latestChange?.path ?? null }),
    },
    {
      kind: 'logs',
      label: 'Logs',
      meta: latestLog ? latestLog.tool : 'No tool logs yet',
      disabled: !latestLog,
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
      kind: 'file',
      label: 'Files',
      meta: selectedFile ? selectedFile.path : 'Pick a file on the left',
      disabled: !selectedFile,
      icon: FileText,
      onSelect: () => {
        if (selectedFile) openStageView(selectedFile);
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
              key={item.kind}
              type="button"
              className={cn(
                'off-stage-view-option off-focusable',
                stageView.kind === item.kind && 'is-active',
              )}
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
      kind: 'output',
      deliverableId: fresh.id,
      threadId,
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
      sourceId: latest.id,
      title: latest.richDetail.title ?? latest.tool,
      url: latest.richDetail.url,
      detail: latest.richDetail,
    });
  }, [openStageView, run]);

  return null;
}

export function StageViewer() {
  const stagePrimaryTab = useUiState((s) => s.stagePrimaryTab);
  const stageView = useUiState((s) => s.stageView);
  const closeStageView = useUiState((s) => s.closeStageView);
  const viewerTab = stagePrimaryTab;
  if (viewerTab === 'game') return null;
  const visibleTarget =
    stageView.kind !== 'scene' && stageTabForTarget(stageView) === viewerTab ? stageView : null;
  return (
    <section className="off-stage-viewer" aria-label="Stage viewer">
      <div className="off-stage-viewer-head">
        <ViewerIcon tab={viewerTab} />
        <div className="off-stage-viewer-title">
          <span>{viewerTitle(viewerTab)}</span>
          <small>{visibleTarget ? viewerMeta(visibleTarget) : viewerEmptyMeta(viewerTab)}</small>
        </div>
        <button
          type="button"
          className="off-stage-viewer-close off-focusable"
          onClick={closeStageView}
          title="Close view"
        >
          <Icon icon={X} size="sm" />
        </button>
      </div>
      <div className="off-stage-viewer-body">
        <StageTabBody tab={viewerTab} target={visibleTarget} />
      </div>
    </section>
  );
}

function StageTabBody({
  tab,
  target,
}: {
  tab: Exclude<StagePrimaryTab, 'game'>;
  target: StageViewTarget | null;
}) {
  if (tab === 'browser') {
    if (target?.kind === 'preview') return <PreviewView target={target} />;
    return (
      <StageEmpty
        title="No browser preview"
        detail="Browser pages, localhost previews, and screenshots appear here when available."
      />
    );
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
    return (
      <StageEmpty
        title="No changes to review"
        detail="Git diffs and changed files will appear here when the workspace changes."
      />
    );
  }
  if (target?.kind === 'output') return <OutputView target={target} />;
  if (target?.kind === 'file') return <FileView target={target} />;
  return (
    <StageEmpty
      title="No file open"
      detail="AI outputs and selected workspace files will appear here."
    />
  );
}

function ViewerIcon({ tab }: { tab: StagePrimaryTab }) {
  const icon = PRIMARY_TABS.find((candidate) => candidate.id === tab)?.icon ?? Box;
  return <Icon icon={icon} size="sm" className="off-stage-viewer-icon" />;
}

function viewerTitle(tab: StagePrimaryTab) {
  switch (tab) {
    case 'browser':
      return 'Browser';
    case 'terminal':
      return 'Terminal';
    case 'review':
      return 'Review';
    case 'files':
      return 'Files';
    default:
      return 'Game View';
  }
}

function viewerEmptyMeta(tab: StagePrimaryTab) {
  switch (tab) {
    case 'browser':
      return 'Preview workspace';
    case 'terminal':
      return 'Run log';
    case 'review':
      return 'Workspace changes';
    case 'files':
      return 'Outputs and files';
    default:
      return 'Office scene';
  }
}

function viewerMeta(target: StageViewTarget) {
  switch (target.kind) {
    case 'output':
      return target.title ?? target.deliverableId;
    case 'preview':
      return target.title ?? target.url ?? 'Browser view';
    case 'changes':
      return target.path ?? 'Workspace diff';
    case 'logs':
      return target.tool ?? target.title ?? 'Tool run';
    case 'file':
      return target.path;
    default:
      return '';
  }
}

function OutputView({
  target,
}: {
  target: Extract<StageViewTarget, { kind: 'output' }>;
}) {
  const deliverables = useDeliverables(target.threadId);
  const deliverable = deliverables.data?.find((row) => row.id === target.deliverableId) ?? null;
  const body = useDeliverableText(deliverable);
  if (!deliverable)
    return (
      <StageEmpty title="Output unavailable" detail="The output is not in this thread anymore." />
    );
  return (
    <div className="off-stage-doc">
      <div className="off-stage-doc-bar">
        <span>{deliverable.name}</span>
        <span>{deliverable.format ?? 'TXT'}</span>
      </div>
      <pre className="off-stage-doc-body">
        {body.text || (body.loading ? 'Loading output...' : 'No output body.')}
      </pre>
    </div>
  );
}

function PreviewView({
  target,
}: {
  target: Extract<StageViewTarget, { kind: 'preview' }>;
}) {
  const deliverables = useDeliverables(target.threadId ?? null);
  const deliverable =
    target.deliverableId && deliverables.data
      ? deliverables.data.find((row) => row.id === target.deliverableId)
      : null;
  const body = useDeliverableText(deliverable ?? null);
  const screenshot = target.detail?.screenshot;
  const previewUrl = target.url ?? target.detail?.url;
  if (deliverable && body.text) {
    return (
      <iframe
        className="off-stage-preview-frame"
        title={target.title ?? deliverable.name}
        sandbox="allow-forms allow-scripts allow-same-origin"
        srcDoc={body.text}
      />
    );
  }
  if (body.loading)
    return <StageEmpty title="Loading preview" detail="Preparing the output preview." />;
  if (previewUrl && isEmbeddablePreviewUrl(previewUrl)) {
    return (
      <iframe
        className="off-stage-preview-frame"
        title={target.title ?? previewUrl}
        sandbox="allow-forms allow-scripts allow-same-origin"
        src={previewUrl}
      />
    );
  }
  if (screenshot?.dataRef) {
    return (
      <div className="off-stage-preview-shot-wrap">
        <img
          className="off-stage-preview-shot"
          src={screenshot.dataRef}
          alt={target.title ?? previewUrl ?? 'Browser preview'}
        />
        {previewUrl ? <code className="off-stage-preview-url">{previewUrl}</code> : null}
      </div>
    );
  }
  return (
    <StageEmpty
      title="Preview unavailable"
      detail="No browser frame or screenshot is available yet."
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
  const workbench = git.data;
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
      <pre className="off-stage-diff">
        {workbench.diffPreview.map((line, index) => (
          <span
            // biome-ignore lint/suspicious/noArrayIndexKey: static diff preview lines
            key={index}
            className={cn('off-stage-diff-line', `is-${line.kind}`)}
          >
            {line.kind === 'add' ? '+ ' : line.kind === 'remove' ? '- ' : '  '}
            {line.text}
          </span>
        ))}
      </pre>
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

function FileView({
  target,
}: {
  target: Extract<StageViewTarget, { kind: 'file' }>;
}) {
  return (
    <div className="off-stage-doc">
      <div className="off-stage-doc-bar">
        <span>{target.path}</span>
        {target.totalSize != null ? <span>{target.totalSize.toLocaleString()} B</span> : null}
      </div>
      {target.loading ? (
        <StageEmpty title="Loading file" detail="Reading the workspace file." />
      ) : null}
      {target.error ? <StageEmpty title="File unavailable" detail={target.error} /> : null}
      {target.content != null ? (
        <pre className="off-stage-doc-body">
          {target.content}
          {target.truncated ? '\n...' : ''}
        </pre>
      ) : null}
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

function useDeliverableText(deliverable: Deliverable | null) {
  const [state, setState] = useState({ loading: false, text: '' });
  useEffect(() => {
    let cancelled = false;
    if (!deliverable) {
      setState({ loading: false, text: '' });
      return;
    }
    const preview = deliverable.preview ?? '';
    setState({ loading: true, text: preview });
    void loadDeliverableBody(deliverable)
      .then((text) => {
        if (!cancelled) setState({ loading: false, text });
      })
      .catch(() => {
        if (!cancelled) setState({ loading: false, text: preview });
      });
    return () => {
      cancelled = true;
    };
  }, [deliverable]);
  return state;
}

function isEmbeddablePreviewUrl(url: string) {
  return /^https?:\/\/(?:localhost|127\.0\.0\.1|0\.0\.0\.0|\[::1\])(?::|\/|$)/i.test(url);
}
