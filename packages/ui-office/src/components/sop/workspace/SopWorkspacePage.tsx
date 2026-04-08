import type { PlanCreatedPayload, RuntimeEvent } from '@offisim/shared-types';
import { useToasts, ToastBanner } from '@offisim/ui-core';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useSops } from '../../../hooks/useSops';
import { useOffisimRuntime } from '../../../runtime/offisim-runtime-context';
import { SopEditorDialog } from '../SopEditorDialog';
import { SopImportDialog } from '../SopImportDialog';
import { WorkspacePageShell } from '../../workspace/WorkspacePageShell.js';
import { SopWorkspaceCanvas } from './SopWorkspaceCanvas';
import { SopWorkspaceContextPane } from './SopWorkspaceContextPane';
import { SopWorkspaceEmptyState } from './SopWorkspaceEmptyState';
import { SopWorkspaceSidebar } from './SopWorkspaceSidebar';

// ---------------------------------------------------------------------------
// Types — mirrored from apps/web workspace types to avoid cross-package deps
// ---------------------------------------------------------------------------

export type SopSessionState = {
  selectedSopId: string | null;
  leftPaneMode: 'library' | 'active-runs';
  centerMode: 'empty' | 'definition' | 'run-focus';
  rightPaneTab: 'context' | 'runs' | 'history';
  search: string;
};

// ---------------------------------------------------------------------------
// Props
// ---------------------------------------------------------------------------

export interface SopWorkspacePageProps {
  sessionState: SopSessionState;
  onSessionStateChange: (state: SopSessionState) => void;
}

// ---------------------------------------------------------------------------
// SopWorkspacePage
// ---------------------------------------------------------------------------

export function SopWorkspacePage({
  sessionState,
  onSessionStateChange,
}: SopWorkspacePageProps) {
  const { sops, loading, deleteSop, refreshSops } = useSops();
  const { sendMessage, eventBus } = useOffisimRuntime();
  const { toasts, addToast, dismissToast } = useToasts();
  const [editorOpen, setEditorOpen] = useState(false);
  const [importOpen, setImportOpen] = useState(false);

  const selectedSop = useMemo(
    () =>
      sessionState.selectedSopId
        ? sops.find((s) => s.sopTemplateId === sessionState.selectedSopId) ?? null
        : null,
    [sops, sessionState.selectedSopId],
  );

  // Deleted entity recovery: when the selected SOP disappears from the list,
  // fall back to browse-empty while preserving search and leftPaneMode.
  const prevSelectedIdRef = useRef(sessionState.selectedSopId);

  useEffect(() => {
    const prevId = prevSelectedIdRef.current;
    prevSelectedIdRef.current = sessionState.selectedSopId;

    if (
      sessionState.selectedSopId &&
      !loading &&
      !sops.find((s) => s.sopTemplateId === sessionState.selectedSopId)
    ) {
      if (prevId === sessionState.selectedSopId) {
        addToast('The selected SOP was deleted.', 'info');
      }
      onSessionStateChange({
        ...sessionState,
        selectedSopId: null,
        centerMode: 'empty',
      });
    }
  }, [sops, loading, sessionState, onSessionStateChange, addToast]);

  // Callbacks

  const handleSelectSop = useCallback(
    (sopId: string) => {
      onSessionStateChange({
        ...sessionState,
        selectedSopId: sopId,
        centerMode: 'definition',
      });
    },
    [sessionState, onSessionStateChange],
  );

  const handleSearchChange = useCallback(
    (search: string) => {
      onSessionStateChange({ ...sessionState, search });
    },
    [sessionState, onSessionStateChange],
  );

  const handleLeftPaneModeChange = useCallback(
    (leftPaneMode: 'library' | 'active-runs') => {
      onSessionStateChange({ ...sessionState, leftPaneMode });
    },
    [sessionState, onSessionStateChange],
  );

  const handleRightPaneTabChange = useCallback(
    (rightPaneTab: 'context' | 'runs' | 'history') => {
      onSessionStateChange({ ...sessionState, rightPaneTab });
    },
    [sessionState, onSessionStateChange],
  );

  const handleRunSop = useCallback(
    (name: string) => {
      void sendMessage(`Run the SOP: ${name}`);
    },
    [sendMessage],
  );

  const handleDeleteSop = useCallback(
    async (sopTemplateId: string) => {
      await deleteSop(sopTemplateId);
    },
    [deleteSop],
  );

  const handleRunFocus = useCallback(() => {
    onSessionStateChange({
      ...sessionState,
      centerMode: 'run-focus',
      rightPaneTab: 'runs',
    });
  }, [sessionState, onSessionStateChange]);

  const handleCreated = useCallback(() => {
    void refreshSops();
  }, [refreshSops]);

  // Auto-switch to run-focus when the selected SOP's plan starts
  useEffect(() => {
    return eventBus.on('plan.created', (e: RuntimeEvent<PlanCreatedPayload>) => {
      if (e.payload.sopTemplateId && sessionState.selectedSopId === e.payload.sopTemplateId) {
        onSessionStateChange({
          ...sessionState,
          centerMode: 'run-focus',
          rightPaneTab: 'runs',
        });
      }
    });
  }, [eventBus, sessionState, onSessionStateChange]);

  const showEmptyCenter = !sessionState.selectedSopId;

  return (
    <WorkspacePageShell
      title="SOPs"
      workspace="sops"
      testId="workspace-sops"
      topSlot={<ToastBanner toasts={toasts} onDismiss={dismissToast} />}
    >
      <div className="sop-workspace-panes">
        <aside
          className="sop-workspace-sidebar"
          data-testid="sop-workspace-sidebar"
          aria-label="SOP library"
        >
          <SopWorkspaceSidebar
            sops={sops}
            loading={loading}
            selectedSopId={sessionState.selectedSopId}
            search={sessionState.search}
            leftPaneMode={sessionState.leftPaneMode}
            onSelectSop={handleSelectSop}
            onSearchChange={handleSearchChange}
            onRunSop={handleRunSop}
            onDeleteSop={handleDeleteSop}
            onCreateClick={() => setEditorOpen(true)}
            onImportClick={() => setImportOpen(true)}
            onLeftPaneModeChange={handleLeftPaneModeChange}
          />
        </aside>

        <main
          className="sop-workspace-canvas"
          data-testid="sop-workspace-canvas"
          aria-label="SOP definition"
        >
          {showEmptyCenter ? (
            <SopWorkspaceEmptyState
              hasNoSops={sops.length === 0}
              onCreateClick={() => setEditorOpen(true)}
              onImportClick={() => setImportOpen(true)}
            />
          ) : (
            <SopWorkspaceCanvas
              sop={selectedSop}
              onRunFocus={handleRunFocus}
            />
          )}
        </main>

        <aside
          className="sop-workspace-context"
          data-testid="sop-workspace-context"
          aria-label="SOP context"
        >
          <SopWorkspaceContextPane
            sop={selectedSop}
            activeTab={sessionState.rightPaneTab}
            onTabChange={handleRightPaneTabChange}
          />
        </aside>
      </div>

      <SopEditorDialog
        open={editorOpen}
        onOpenChange={setEditorOpen}
        onCreated={handleCreated}
      />
      <SopImportDialog
        open={importOpen}
        onOpenChange={setImportOpen}
        onImported={handleCreated}
      />
    </WorkspacePageShell>
  );
}

export default SopWorkspacePage;
