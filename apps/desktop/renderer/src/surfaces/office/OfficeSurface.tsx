import { useUiState } from '@/app/ui-state.js';
import { cn } from '@/lib/utils.js';
import { useEffect, useRef } from 'react';
import { Group, Panel, Separator, usePanelRef } from 'react-resizable-panels';
import { ChatRail } from './ChatRail.js';
import { OfficeStage } from './OfficeStage.js';
import { TeamDock } from './TeamDock.js';
import { WorkspacePanel } from './WorkspacePanel.js';

const COMPACT_OFFICE_QUERY = '(max-width: 1100px)';

export function OfficeSurface() {
  const leftCollapsed = useUiState((s) => s.officeLeftRailCollapsed);
  const rightCollapsed = useUiState((s) => s.officeRightRailCollapsed);
  const stageMaximized = useUiState((s) => s.officeStageMaximized);
  const setLeftCollapsed = useUiState((s) => s.setOfficeLeftRailCollapsed);
  const setRightCollapsed = useUiState((s) => s.setOfficeRightRailCollapsed);
  const workspacePanelRef = usePanelRef();
  const conversationPanelRef = usePanelRef();
  const preCompactRails = useRef<{ left: boolean; right: boolean } | null>(null);

  useEffect(() => {
    const query = window.matchMedia(COMPACT_OFFICE_QUERY);
    const applyCompactLayout = (compact: boolean) => {
      if (compact) {
        if (!preCompactRails.current) {
          const state = useUiState.getState();
          preCompactRails.current = {
            left: state.officeLeftRailCollapsed,
            right: state.officeRightRailCollapsed,
          };
        }
        setLeftCollapsed(true);
        setRightCollapsed(true);
        return;
      }
      const previous = preCompactRails.current;
      if (!previous) return;
      preCompactRails.current = null;
      setLeftCollapsed(previous.left);
      setRightCollapsed(previous.right);
    };
    applyCompactLayout(query.matches);
    const onChange = (event: MediaQueryListEvent) => applyCompactLayout(event.matches);
    query.addEventListener('change', onChange);
    return () => {
      query.removeEventListener('change', onChange);
      const previous = preCompactRails.current;
      if (!previous) return;
      preCompactRails.current = null;
      setLeftCollapsed(previous.left);
      setRightCollapsed(previous.right);
    };
  }, [setLeftCollapsed, setRightCollapsed]);

  useEffect(() => {
    if (stageMaximized || leftCollapsed) workspacePanelRef.current?.collapse();
    else workspacePanelRef.current?.expand();
  }, [leftCollapsed, stageMaximized, workspacePanelRef]);

  useEffect(() => {
    if (stageMaximized || rightCollapsed) conversationPanelRef.current?.collapse();
    else conversationPanelRef.current?.expand();
  }, [conversationPanelRef, rightCollapsed, stageMaximized]);

  return (
    <Group
      orientation="horizontal"
      className={cn(
        'off-office',
        leftCollapsed && 'is-left-collapsed',
        rightCollapsed && 'is-right-collapsed',
        stageMaximized && 'is-stage-maximized',
      )}
    >
      <Panel
        id="office-workspace"
        panelRef={workspacePanelRef}
        className="off-office-aux-panel"
        defaultSize="23%"
        minSize="18%"
        maxSize="32%"
        collapsible
        collapsedSize="0%"
        onResize={(size) => {
          if (!stageMaximized) setLeftCollapsed(size.inPixels === 0);
        }}
      >
        <WorkspacePanel />
      </Panel>
      <Separator
        className={cn(
          'off-resize-handle off-office-resize-handle',
          (leftCollapsed || stageMaximized) && 'is-hidden',
        )}
      />
      <Panel id="office-stage" className="off-office-center" minSize="34%">
        <OfficeStage />
        <TeamDock />
      </Panel>
      <Separator
        className={cn(
          'off-resize-handle off-office-resize-handle',
          (rightCollapsed || stageMaximized) && 'is-hidden',
        )}
      />
      <Panel
        id="office-conversations"
        panelRef={conversationPanelRef}
        className="off-office-aux-panel"
        defaultSize="42%"
        minSize="32%"
        maxSize="50%"
        collapsible
        collapsedSize="0%"
        onResize={(size) => {
          if (!stageMaximized) setRightCollapsed(size.inPixels === 0);
        }}
      >
        <ChatRail />
      </Panel>
    </Group>
  );
}
