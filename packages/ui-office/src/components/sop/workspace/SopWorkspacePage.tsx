import type { PlanCreatedPayload, RuntimeEvent } from '@offisim/shared-types';
import { ToastBanner, useToasts } from '@offisim/ui-core';
import { Download, Play, Plus, Search } from 'lucide-react';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useSops } from '../../../hooks/useSops';
import { useOffisimRuntime } from '../../../runtime/offisim-runtime-context';
import { SopEditorDialog } from '../SopEditorDialog';
import { SopImportDialog } from '../SopImportDialog';
import { SopWorkspaceCanvas } from './SopWorkspaceCanvas';
import { SopWorkspaceEmptyState } from './SopWorkspaceEmptyState';

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
  const { sops, loading, deleteSop: _deleteSop, refreshSops } = useSops();
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

  const handleRunSop = useCallback(
    (name: string) => {
      void sendMessage(`Run the SOP: ${name}`);
    },
    [sendMessage],
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

  return (
    <div className="flex h-full flex-col" data-testid="workspace-sops" data-workspace="sops">
      <ToastBanner toasts={toasts} onDismiss={dismissToast} />

      {/* Top toolbar */}
      <div className="flex items-center gap-3 border-b border-white/[0.06] px-5 py-2.5 shrink-0">
        {/* SOP selector */}
        <div className="flex items-center gap-2 min-w-0">
          <select
            value={sessionState.selectedSopId ?? ''}
            onChange={(e) =>
              e.target.value ? handleSelectSop(e.target.value) : undefined
            }
            className="bg-white/[0.04] border border-white/[0.08] rounded-lg px-3 py-1.5 text-[13px] text-slate-200 focus:outline-none focus:border-cyan-400/30 min-w-[200px]"
          >
            <option value="">Select SOP…</option>
            {sops.map((s) => (
              <option key={s.sopTemplateId} value={s.sopTemplateId}>
                {s.name}
              </option>
            ))}
          </select>
        </div>

        {/* Search */}
        <div className="relative">
          <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-slate-500" />
          <input
            type="text"
            value={sessionState.search}
            onChange={(e) => handleSearchChange(e.target.value)}
            placeholder="Search…"
            className="bg-white/[0.04] border border-white/[0.08] rounded-lg pl-8 pr-3 py-1.5 text-[12px] text-slate-200 placeholder:text-slate-600 focus:outline-none focus:border-cyan-400/30 w-40"
          />
        </div>

        <div className="flex-1" />

        {/* Actions */}
        <button
          type="button"
          onClick={() => setImportOpen(true)}
          className="flex items-center gap-1.5 text-[12px] text-slate-400 hover:text-cyan-300 transition-colors"
        >
          <Download className="w-3.5 h-3.5" /> Import
        </button>
        <button
          type="button"
          onClick={() => setEditorOpen(true)}
          className="flex items-center gap-1.5 rounded-lg bg-cyan-500/15 border border-cyan-400/30 px-3 py-1.5 text-[12px] text-cyan-200 hover:bg-cyan-500/25 transition-colors"
        >
          <Plus className="w-3.5 h-3.5" /> Create
        </button>

        {selectedSop && (
          <button
            type="button"
            onClick={() => handleRunSop(selectedSop.name)}
            className="flex items-center gap-1.5 rounded-lg bg-emerald-500/15 border border-emerald-400/30 px-3 py-1.5 text-[12px] text-emerald-200 hover:bg-emerald-500/25 transition-colors"
          >
            <Play className="w-3.5 h-3.5" /> Run
          </button>
        )}
      </div>

      {/* Main content — full screen */}
      <div className="flex-1 min-h-0 overflow-y-auto overflow-x-auto">
        {!sessionState.selectedSopId ? (
          <SopWorkspaceEmptyState
            hasNoSops={sops.length === 0}
            onCreateClick={() => setEditorOpen(true)}
            onImportClick={() => setImportOpen(true)}
          />
        ) : selectedSop ? (
          <SopWorkspaceCanvas sop={selectedSop} onRunFocus={handleRunFocus} />
        ) : null}
      </div>

      <SopEditorDialog open={editorOpen} onOpenChange={setEditorOpen} onCreated={handleCreated} />
      <SopImportDialog open={importOpen} onOpenChange={setImportOpen} onImported={handleCreated} />
    </div>
  );
}

export default SopWorkspacePage;
