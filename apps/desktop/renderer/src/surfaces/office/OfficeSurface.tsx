import { useUiState } from '@/app/ui-state.js';
import { cn } from '@/lib/utils.js';
import { useEffect, useRef } from 'react';
import { Group, Panel, Separator, usePanelRef } from 'react-resizable-panels';
import { ChatRail } from './ChatRail.js';
import { OfficeStage } from './OfficeStage.js';
import { TeamDock } from './TeamDock.js';
import { WorkspacePanel } from './WorkspacePanel.js';
import {
  OFFICE_LAYOUT_MEDIA,
  OFFICE_PANEL_SIZES,
  type OfficeRailState,
  type OfficeRailTier,
  officeRailTierForWidth,
  responsiveOfficeRailState,
} from './office-layout.js';

export function OfficeSurface() {
  const leftCollapsed = useUiState((s) => s.officeLeftRailCollapsed);
  const rightCollapsed = useUiState((s) => s.officeRightRailCollapsed);
  const stageMaximized = useUiState((s) => s.officeStageMaximized);
  const setLeftCollapsed = useUiState((s) => s.setOfficeLeftRailCollapsed);
  const setRightCollapsed = useUiState((s) => s.setOfficeRightRailCollapsed);
  const workspacePanelRef = usePanelRef();
  const conversationPanelRef = usePanelRef();
  const preResponsiveRails = useRef<OfficeRailState | null>(null);

  useEffect(() => {
    const wideQuery = window.matchMedia(OFFICE_LAYOUT_MEDIA.wide);
    const compactQuery = window.matchMedia(OFFICE_LAYOUT_MEDIA.compact);
    let tier: OfficeRailTier | null = null;
    const applyTier = (next: OfficeRailTier) => {
      if (next === tier) return;
      const leavingWide = tier === null || tier === 'wide';
      tier = next;
      if (next === 'wide') {
        const previous = preResponsiveRails.current;
        if (!previous) return;
        preResponsiveRails.current = null;
        setLeftCollapsed(previous.left);
        setRightCollapsed(previous.right);
        return;
      }
      const current = useUiState.getState();
      const currentRails: OfficeRailState = {
        left: current.officeLeftRailCollapsed,
        right: current.officeRightRailCollapsed,
      };
      if (leavingWide && !preResponsiveRails.current) {
        preResponsiveRails.current = currentRails;
      }
      const responsive = responsiveOfficeRailState(
        next,
        preResponsiveRails.current ?? currentRails,
      );
      setLeftCollapsed(responsive.left);
      setRightCollapsed(responsive.right);
    };
    const applyWindowTier = () => applyTier(officeRailTierForWidth(window.innerWidth));
    applyWindowTier();
    const onChange = () => applyWindowTier();
    wideQuery.addEventListener('change', onChange);
    compactQuery.addEventListener('change', onChange);
    return () => {
      wideQuery.removeEventListener('change', onChange);
      compactQuery.removeEventListener('change', onChange);
      const previous = preResponsiveRails.current;
      if (!previous) return;
      preResponsiveRails.current = null;
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
        defaultSize={OFFICE_PANEL_SIZES.workspace.default}
        minSize={OFFICE_PANEL_SIZES.workspace.min}
        maxSize={OFFICE_PANEL_SIZES.workspace.max}
        groupResizeBehavior="preserve-pixel-size"
        collapsible
        collapsedSize={0}
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
      <Panel
        id="office-stage"
        className="off-office-center"
        minSize={OFFICE_PANEL_SIZES.stage.min}
        groupResizeBehavior="preserve-relative-size"
      >
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
        defaultSize={OFFICE_PANEL_SIZES.conversations.default}
        minSize={OFFICE_PANEL_SIZES.conversations.min}
        maxSize={OFFICE_PANEL_SIZES.conversations.max}
        groupResizeBehavior="preserve-pixel-size"
        collapsible
        collapsedSize={0}
        onResize={(size) => {
          if (!stageMaximized) setRightCollapsed(size.inPixels === 0);
        }}
      >
        <ChatRail />
      </Panel>
    </Group>
  );
}
