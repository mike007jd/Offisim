import {
  type StagePrimaryTab,
  type StageViewTarget,
  stageTabForTarget,
  useUiState,
} from '@/app/ui-state.js';
import { cn } from '@/lib/utils.js';
import { BoardStage } from '@/surfaces/office/board/BoardStage.js';
import { ComputerView } from '@/surfaces/office/computer/ComputerView.js';
import { BrowserSessionView } from '@/surfaces/office/stage-browser/BrowserSessionView.js';
import { BrowserEmptyState } from '@/surfaces/office/stage-preview/BrowserEmptyState.js';
import { StageEmpty } from '@/surfaces/office/stage-preview/StageEmpty.js';
import { StagePreviewPane } from '@/surfaces/office/stage-preview/StagePreviewPane.js';
import { TerminalSessionView } from '@/surfaces/office/stage-terminal/TerminalSessionView.js';
import { StageChromeProvider } from '@/surfaces/office/stage-viewer/stage-chrome.js';
import { Globe2, TerminalSquare } from 'lucide-react';
import { Group, Panel, Separator } from 'react-resizable-panels';

export { StageAutoOpen } from './StageAutoOpen.js';
export { GameViewOptions } from './StageViewMenu.js';
export { StageRunStatusCluster, StageTopBar } from './StageTopBar.js';
import { type StageRunStatusProps, StageViewerHead, viewerTitle } from './StageTopBar.js';
import { ChangesView } from './views/ChangesView.js';
import { LogsView } from './views/LogsView.js';
import { ReviewEmpty } from './views/ReviewEmpty.js';

export function StageViewer({ isRunning, accounting }: StageRunStatusProps) {
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
            <StageViewPane
              tab={viewerTab}
              target={visibleTarget}
              tabId={activeStageTabId}
              isRunning={isRunning}
              accounting={accounting}
            />
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
              isRunning={isRunning}
              accounting={accounting}
            />
          </Panel>
        </Group>
      ) : (
        <StageViewPane
          tab={viewerTab}
          target={visibleTarget}
          tabId={activeStageTabId}
          isRunning={isRunning}
          accounting={accounting}
        />
      )}
    </section>
  );
}

function StageViewPane({
  tab,
  target,
  tabId,
  split = false,
  isRunning,
  accounting,
}: {
  tab: Exclude<StagePrimaryTab, 'game'>;
  target: StageViewTarget | null;
  tabId: string | null;
  split?: boolean;
} & StageRunStatusProps) {
  const ownsChrome = tab === 'preview' && target?.kind === 'browser-session';
  const boardLens = useUiState((state) => state.boardLens);
  const accessibleTitle =
    tab === 'board' && boardLens === 'timeline' ? 'Timeline' : viewerTitle(tab);
  return (
    <StageChromeProvider>
      <section
        className={cn(
          'off-stage-viewer-pane',
          split && 'is-split',
          ownsChrome && 'is-surface-chrome',
        )}
        aria-label={split ? `Pinned ${accessibleTitle} view` : `${accessibleTitle} view`}
      >
        {ownsChrome ? null : (
          <StageViewerHead
            tab={tab}
            target={target}
            tabId={tabId}
            split={split}
            isRunning={isRunning}
            accounting={accounting}
          />
        )}
        <div className="off-stage-viewer-body">
          <StageTabBody tab={tab} target={target} />
        </div>
      </section>
    </StageChromeProvider>
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
