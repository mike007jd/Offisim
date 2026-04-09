import type { PlanCreatedPayload, RuntimeEvent } from '@offisim/shared-types';
import { ToastBanner, useToasts } from '@offisim/ui-core';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useSops } from '../../../hooks/useSops';
import { useOffisimRuntime } from '../../../runtime/offisim-runtime-context';
import { WorkspacePageShell } from '../../workspace/WorkspacePageShell.js';
import { SopEditorDialog } from '../SopEditorDialog';
import { SopImportDialog } from '../SopImportDialog';
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
  onSessionStateChange: (updater: (prev: SopSessionState) => SopSessionState) => void;
}

// ---------------------------------------------------------------------------
// SopWorkspacePage
// ---------------------------------------------------------------------------

export function SopWorkspacePage({ sessionState, onSessionStateChange }: SopWorkspacePageProps) {
  const { sops, loading, deleteSop, refreshSops } = useSops();
  const { sendMessage, eventBus } = useOffisimRuntime();
  const { toasts, addToast, dismissToast } = useToasts();
  const [editorOpen, setEditorOpen] = useState(false);
  const [importOpen, setImportOpen] = useState(false);

  const selectedSop = useMemo(
    () =>
      sessionState.selectedSopId
        ? (sops.find((s) => s.sopTemplateId === sessionState.selectedSopId) ?? null)
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
      onSessionStateChange((prev) => {
        if (!prev.selectedSopId) return prev;
        return { ...prev, selectedSopId: null, centerMode: 'empty' };
      });
    }
  }, [sops, loading, sessionState.selectedSopId, onSessionStateChange, addToast]);

  // Callbacks

  const handleSelectSop = useCallback(
    (sopId: string) => {
      onSessionStateChange((prev) => ({
        ...prev,
        selectedSopId: sopId,
        centerMode: 'definition',
      }));
    },
    [onSessionStateChange],
  );

  const handleSearchChange = useCallback(
    (search: string) => {
      onSessionStateChange((prev) => ({ ...prev, search }));
    },
    [onSessionStateChange],
  );

  const handleLeftPaneModeChange = useCallback(
    (leftPaneMode: 'library' | 'active-runs') => {
      onSessionStateChange((prev) => ({ ...prev, leftPaneMode }));
    },
    [onSessionStateChange],
  );

  const handleRightPaneTabChange = useCallback(
    (rightPaneTab: 'context' | 'runs' | 'history') => {
      onSessionStateChange((prev) => ({ ...prev, rightPaneTab }));
    },
    [onSessionStateChange],
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
    onSessionStateChange((prev) => ({
      ...prev,
      centerMode: 'run-focus',
      rightPaneTab: 'runs',
    }));
  }, [onSessionStateChange]);

  const handleCreated = useCallback(() => {
    void refreshSops();
  }, [refreshSops]);

  // Auto-switch to run-focus when the selected SOP's plan starts.
  // Functional updater reads latest state via `prev` — no refs needed.
  useEffect(() => {
    return eventBus.on('plan.created', (e: RuntimeEvent<PlanCreatedPayload>) => {
      onSessionStateChange((prev) => {
        if (e.payload.sopTemplateId && prev.selectedSopId === e.payload.sopTemplateId) {
          return { ...prev, centerMode: 'run-focus', rightPaneTab: 'runs' };
        }
        return prev;
      });
    });
  }, [eventBus, onSessionStateChange]);

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
            <SopWorkspaceCanvas sop={selectedSop} onRunFocus={handleRunFocus} />
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

      <SopEditorDialog open={editorOpen} onOpenChange={setEditorOpen} onCreated={handleCreated} />
      <SopImportDialog open={importOpen} onOpenChange={setImportOpen} onImported={handleCreated} />
    </WorkspacePageShell>
  );
}

export default SopWorkspacePage;
