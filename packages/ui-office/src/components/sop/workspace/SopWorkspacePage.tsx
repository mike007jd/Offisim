import type { PlanCreatedPayload, RuntimeEvent } from '@offisim/shared-types';
import { useToasts, ToastBanner } from '@offisim/ui-core';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useSops } from '../../../hooks/useSops';
import { useOffisimRuntime } from '../../../runtime/offisim-runtime-context';
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
  filters: string[];
};

type SopWorkspaceState =
  | { mode: 'browse-empty' }
  | { mode: 'browse-selected'; sopId: string }
  | { mode: 'run-focus'; sopId: string; runId: string }
  | { mode: 'editing-meta'; sopId: string }
  | { mode: 'creating' }
  | { mode: 'importing' };

// ---------------------------------------------------------------------------
// Props
// ---------------------------------------------------------------------------

export interface SopWorkspacePageProps {
  sessionState: SopSessionState;
  onSessionStateChange: (state: SopSessionState) => void;
}

// ---------------------------------------------------------------------------
// Derive the internal state-machine mode from SopSessionState
// ---------------------------------------------------------------------------

export function deriveWorkspaceState(session: SopSessionState): SopWorkspaceState {
  if (!session.selectedSopId) {
    return { mode: 'browse-empty' };
  }
  if (session.centerMode === 'run-focus') {
    return { mode: 'run-focus', sopId: session.selectedSopId, runId: '' };
  }
  if (session.centerMode === 'definition') {
    return { mode: 'browse-selected', sopId: session.selectedSopId };
  }
  return { mode: 'browse-empty' };
}

// ---------------------------------------------------------------------------
// SopWorkspacePage
// ---------------------------------------------------------------------------

/**
 * Full SOPs workspace with 3-pane layout.
 *
 * - Left pane:   SOP library sidebar (search, filters, SOP list)
 * - Center pane: SOP definition canvas or empty state
 * - Right pane:  Context pane (run status, linked tasks, history)
 *
 * Manages the internal state machine:
 *   browse-empty → browse-selected → run-focus
 *   browse-empty → creating | importing
 *   browse-selected → editing-meta
 *
 * Task 5.6: Handles deleted entity recovery, zero-results, and run completion.
 */
export function SopWorkspacePage({
  sessionState,
  onSessionStateChange,
}: SopWorkspacePageProps) {
  const { sops, loading, deleteSop, refreshSops } = useSops();
  const { sendMessage, eventBus } = useOffisimRuntime();
  const { toasts, addToast, dismissToast } = useToasts();
  const [editorOpen, setEditorOpen] = useState(false);
  const [importOpen, setImportOpen] = useState(false);

  const workspaceState = useMemo(
    () => deriveWorkspaceState(sessionState),
    [sessionState],
  );

  // Resolve the selected SOP from the list
  const selectedSop = useMemo(
    () =>
      sessionState.selectedSopId
        ? sops.find((s) => s.sopTemplateId === sessionState.selectedSopId) ?? null
        : null,
    [sops, sessionState.selectedSopId],
  );

  // -----------------------------------------------------------------------
  // Task 5.6: Deleted entity recovery
  // When the selected SOP disappears from the list (deleted), fall back to
  // browse-empty while preserving search, filters, and mode.
  // -----------------------------------------------------------------------
  const prevSelectedIdRef = useRef(sessionState.selectedSopId);

  useEffect(() => {
    const prevId = prevSelectedIdRef.current;
    prevSelectedIdRef.current = sessionState.selectedSopId;

    // Only act if we had a selection, it's still in session state, but the
    // SOP is no longer in the loaded list (and we're not still loading).
    if (
      sessionState.selectedSopId &&
      !loading &&
      sops.length >= 0 &&
      !sops.find((s) => s.sopTemplateId === sessionState.selectedSopId)
    ) {
      // Only toast if the ID was previously valid (i.e. it was deleted, not
      // a stale deep-link on first load).
      if (prevId === sessionState.selectedSopId) {
        addToast('The selected SOP was deleted.', 'info');
      }
      // Fall back — preserve search, filters, leftPaneMode
      onSessionStateChange({
        ...sessionState,
        selectedSopId: null,
        centerMode: 'empty',
      });
    }
  }, [sops, loading, sessionState, onSessionStateChange, addToast]);

  // -----------------------------------------------------------------------
  // Task 5.6: Running SOP completion notification — don't hijack selection
  // We listen for plan.completed but only show a toast, never change selection.
  // -----------------------------------------------------------------------
  useEffect(() => {
    return eventBus.on('plan.completed', () => {
      // Notification only — selection stays as-is
    });
  }, [eventBus]);

  // -----------------------------------------------------------------------
  // Callbacks
  // -----------------------------------------------------------------------

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
      // Deleted entity recovery is handled by the useEffect above
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

  // -----------------------------------------------------------------------
  // Auto-select newly created SOP when plan starts
  // -----------------------------------------------------------------------
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

  const showEmptyCenter =
    workspaceState.mode === 'browse-empty' ||
    workspaceState.mode === 'creating' ||
    workspaceState.mode === 'importing';

  return (
    <div data-workspace="sops" data-testid="workspace-sops" className="flex flex-col h-full">
      {/* Toast banner for deleted entity notifications */}
      <ToastBanner toasts={toasts} onDismiss={dismissToast} />

      {/* Page header */}
      <header className="workspace-shell-header">
        <div className="flex items-start justify-between gap-4 flex-wrap">
          <div className="min-w-0">
            <p className="workspace-shell-eyebrow">Workspace</p>
            <h1 className="workspace-shell-title">SOPs</h1>
          </div>
        </div>
      </header>

      {/* 3-pane layout */}
      <div className="sop-workspace-panes">
        {/* Left pane — Library sidebar */}
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
            filters={sessionState.filters}
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

        {/* Center pane — Definition canvas or empty state */}
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
              centerMode={sessionState.centerMode}
              onRunFocus={handleRunFocus}
            />
          )}
        </main>

        {/* Right pane — Context pane */}
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

      {/* Dialogs — kept as modals per spec */}
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
    </div>
  );
}

export default SopWorkspacePage;
