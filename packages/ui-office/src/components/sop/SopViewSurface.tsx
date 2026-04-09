import { SopSyncService } from '@offisim/core/browser';
import type { SopDefinition, SopStep } from '@offisim/shared-types';
import { ToastBanner, useToasts } from '@offisim/ui-core';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useSopRuntimeState } from '../../hooks/useSopRuntimeState';
import { useSops } from '../../hooks/useSops';
import { parseSopDefinition } from '../../lib/sop-utils';
import { useOffisimRuntime } from '../../runtime/offisim-runtime-context';
import { SopDagCanvas } from './SopDagCanvas';
import { SopEditorDialog } from './SopEditorDialog';
import { SopEmptyState } from './SopEmptyState';
import { SopImportDialog } from './SopImportDialog';
import { SopLibraryBar } from './SopLibraryBar';
import { SopNlCommandBar } from './SopNlCommandBar';
import { SopSidebar } from './SopSidebar';
import { formatModifyCommand, formatRunCommand, formatStepClickPrefill } from './sop-commands';
import { computeDagLayout, getExecutionBatches } from './sop-dag-layout';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export type SopSessionState = {
  selectedSopId: string | null;
  search: string;
};

export interface SopViewSurfaceProps {
  sessionState: SopSessionState;
  onSessionStateChange: (updater: (prev: SopSessionState) => SopSessionState) => void;
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function validateNoCycles(def: SopDefinition): boolean {
  try {
    const batches = getExecutionBatches(def);
    return batches.flat().length === def.steps.length;
  } catch {
    return false;
  }
}

// ---------------------------------------------------------------------------
// SopViewSurface — entry component for the SOP workspace
// ---------------------------------------------------------------------------

export function SopViewSurface({ sessionState, onSessionStateChange }: SopViewSurfaceProps) {
  const { sops, loading, deleteSop, refreshSops } = useSops();
  const { sendMessage, repos } = useOffisimRuntime();
  const { toasts, addToast, dismissToast } = useToasts();

  const [editorOpen, setEditorOpen] = useState(false);
  const [importOpen, setImportOpen] = useState(false);
  const [nlInput, setNlInput] = useState('');
  const [selectedStepId, setSelectedStepId] = useState<string | null>(null);
  const [editMode, setEditMode] = useState(false);

  // Selected SOP
  const selectedSop = useMemo(
    () =>
      sessionState.selectedSopId
        ? (sops.find((s) => s.sopTemplateId === sessionState.selectedSopId) ?? null)
        : null,
    [sops, sessionState.selectedSopId],
  );

  // Parse definition
  const definition = useMemo(
    () => (selectedSop ? parseSopDefinition(selectedSop.definitionJson) : null),
    [selectedSop],
  );

  // Compute layout
  const layout = useMemo(() => (definition ? computeDagLayout(definition) : null), [definition]);

  // Runtime state
  const runtimeState = useSopRuntimeState(selectedSop?.sopTemplateId);

  // Step IDs for index mapping
  const stepIds = useMemo(() => definition?.steps.map((s) => s.step_id) ?? [], [definition]);

  // --- Deleted SOP recovery ---
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
        return { ...prev, selectedSopId: null };
      });
    }
  }, [sops, loading, sessionState.selectedSopId, onSessionStateChange, addToast]);

  // --- Mutation helper: update definition and persist ---
  const updateDefinition = useCallback(
    async (mutate: (def: SopDefinition) => SopDefinition) => {
      if (!selectedSop || !definition || !repos?.sopTemplates) return;
      const next = mutate(definition);
      if (!validateNoCycles(next)) {
        addToast('Cannot create a cycle in the workflow', 'error');
        return;
      }
      try {
        await repos.sopTemplates.update(selectedSop.sopTemplateId, {
          definition_json: JSON.stringify(next),
        });
        await refreshSops();
      } catch {
        addToast('Failed to update SOP', 'error');
      }
    },
    [selectedSop, definition, repos, refreshSops, addToast],
  );

  // --- Callbacks ---

  const handleSelectSop = useCallback(
    (sopId: string) => {
      onSessionStateChange((prev) => ({ ...prev, selectedSopId: sopId }));
      setSelectedStepId(null);
      setNlInput('');
    },
    [onSessionStateChange],
  );

  const handleSearchChange = useCallback(
    (search: string) => {
      onSessionStateChange((prev) => ({ ...prev, search }));
    },
    [onSessionStateChange],
  );

  const handleRun = useCallback(() => {
    if (!selectedSop) return;
    void sendMessage(formatRunCommand(selectedSop.name));
  }, [selectedSop, sendMessage]);

  const handleDelete = useCallback(async () => {
    if (!selectedSop) return;
    await deleteSop(selectedSop.sopTemplateId);
  }, [selectedSop, deleteSop]);

  const handleSync = useCallback(async () => {
    if (!selectedSop || !repos?.sopTemplates) return;
    try {
      const svc = new SopSyncService(repos.sopTemplates);
      await svc.syncFromUrl(selectedSop.sopTemplateId);
      await refreshSops();
      addToast('SOP synced successfully', 'success');
    } catch {
      addToast('Failed to sync SOP', 'error');
    }
  }, [selectedSop, repos, refreshSops, addToast]);

  const handleStepClick = useCallback(
    (stepId: string) => {
      setSelectedStepId(stepId);
      const step = definition?.steps.find((s) => s.step_id === stepId);
      if (step) {
        setNlInput(formatStepClickPrefill(step.label, step.role_slug));
      }
    },
    [definition],
  );

  const handleNlSubmit = useCallback(
    (text: string) => {
      if (!selectedSop) return;
      void sendMessage(formatModifyCommand(selectedSop.name, text));
      setNlInput('');
    },
    [selectedSop, sendMessage],
  );

  const handleCreated = useCallback(() => {
    void refreshSops();
  }, [refreshSops]);

  // --- DAG edit callbacks ---

  const handleAddDependency = useCallback(
    (fromStepId: string, toStepId: string) => {
      void updateDefinition((def) => ({
        ...def,
        steps: def.steps.map((s) =>
          s.step_id === toStepId && !s.dependencies.includes(fromStepId)
            ? { ...s, dependencies: [...s.dependencies, fromStepId] }
            : s,
        ),
      }));
    },
    [updateDefinition],
  );

  const handleRemoveDependency = useCallback(
    (fromStepId: string, toStepId: string) => {
      void updateDefinition((def) => ({
        ...def,
        steps: def.steps.map((s) =>
          s.step_id === toStepId
            ? { ...s, dependencies: s.dependencies.filter((d) => d !== fromStepId) }
            : s,
        ),
      }));
    },
    [updateDefinition],
  );

  const handleDeleteStep = useCallback(
    (stepId: string) => {
      void updateDefinition((def) => ({
        ...def,
        steps: def.steps
          .filter((s) => s.step_id !== stepId)
          .map((s) => ({
            ...s,
            dependencies: s.dependencies.filter((d) => d !== stepId),
          })),
      }));
      if (selectedStepId === stepId) setSelectedStepId(null);
    },
    [updateDefinition, selectedStepId],
  );

  const handleAddStep = useCallback(() => {
    if (!definition) return;
    const id = `step-${Date.now()}`;
    const newStep: SopStep = {
      step_id: id,
      label: 'New Step',
      role_slug: 'developer' as SopStep['role_slug'],
      instruction: '',
      dependencies: [],
      output_key: id,
    };
    void updateDefinition((def) => ({
      ...def,
      steps: [...def.steps, newStep],
    }));
  }, [definition, updateDefinition]);

  const showEmpty = !sessionState.selectedSopId || !layout;

  return (
    <div className="flex h-full">
      <ToastBanner toasts={toasts} onDismiss={dismissToast} />

      {/* Left sidebar — SOP list */}
      <SopSidebar
        sops={sops}
        selectedSopId={sessionState.selectedSopId}
        search={sessionState.search}
        loading={loading}
        onSelectSop={handleSelectSop}
        onSearchChange={handleSearchChange}
        onCreateClick={() => setEditorOpen(true)}
        onImportClick={() => setImportOpen(true)}
      />

      {/* Right panel — toolbar + canvas + command bar */}
      <div className="flex-1 flex flex-col min-w-0">
        <SopLibraryBar
          selectedSopId={sessionState.selectedSopId}
          hasSourceUrl={!!selectedSop?.sourceUrl}
          onRun={handleRun}
          onDelete={handleDelete}
          onSync={handleSync}
          onCreateClick={() => setEditorOpen(true)}
          onImportClick={() => setImportOpen(true)}
          editMode={editMode}
          onEditModeToggle={() => setEditMode((prev) => !prev)}
        />

        {showEmpty ? (
          <SopEmptyState
            hasNoSops={sops.length === 0}
            onCreateClick={() => setEditorOpen(true)}
            onImportClick={() => setImportOpen(true)}
          />
        ) : (
          <SopDagCanvas
            layout={layout}
            runtimeState={runtimeState}
            selectedStepId={selectedStepId}
            onStepClick={handleStepClick}
            stepIds={stepIds}
            editMode={editMode}
            onAddDependency={handleAddDependency}
            onRemoveDependency={handleRemoveDependency}
            onDeleteStep={handleDeleteStep}
            onAddStep={handleAddStep}
          />
        )}

        <SopNlCommandBar
          value={nlInput}
          onChange={setNlInput}
          onSubmit={handleNlSubmit}
          disabled={!selectedSop}
          placeholder={
            selectedSop ? `Command for "${selectedSop.name}"…` : 'Select an SOP to start…'
          }
        />
      </div>

      <SopEditorDialog open={editorOpen} onOpenChange={setEditorOpen} onCreated={handleCreated} />
      <SopImportDialog open={importOpen} onOpenChange={setImportOpen} onImported={handleCreated} />
    </div>
  );
}
