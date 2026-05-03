import { SopSyncService } from '@offisim/core/browser';
import type { SopDefinition, SopStep } from '@offisim/shared-types';
import { Button, ErrorState, ToastBanner, useToasts } from '@offisim/ui-core';
import { PanelRightClose, PanelRightOpen, X } from 'lucide-react';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useLayoutTier } from '../../hooks/use-layout-tier.js';
import { useSopRuntimeState } from '../../hooks/useSopRuntimeState';
import { useSops } from '../../hooks/useSops';
import { useSidebarCollapse } from '../../lib/sidebar-collapse-store.js';
import { parseSopDefinition } from '../../lib/sop-utils';
import { useOffisimRuntime } from '../../runtime/offisim-runtime-context';
import { useAgentStates } from '../../runtime/use-agent-states';
import type { StepFormValues } from './SopAddStepPopover';
import { SopAddStepPopover } from './SopAddStepPopover';
import { SopDagCanvas } from './SopDagCanvas';
import { SopEditorDialog } from './SopEditorDialog';
import { SopEmptyState } from './SopEmptyState';
import { SopImportDialog } from './SopImportDialog';
import { SopInspectorPanel } from './SopInspectorPanel';
import { SopLibraryBar } from './SopLibraryBar';
import { SopNlCommandBar } from './SopNlCommandBar';
import { SopNodeContextMenu } from './SopNodeContextMenu';
import { SopRunProgressStrip } from './SopRunProgressStrip';
import { SopSidebar } from './SopSidebar';
import { formatModifyCommand, formatRunCommand, formatStepClickPrefill } from './sop-commands';
import {
  computeAutoLayoutPositions,
  computeDagLayout,
  getExecutionBatches,
  wouldCreateCycle,
} from './sop-dag-layout';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export type SopSessionState = {
  selectedSopId: string | null;
  focusedStepId: string | null;
  search: string;
};

export interface SopViewSurfaceProps {
  sessionState: SopSessionState;
  onSessionStateChange: (updater: (prev: SopSessionState) => SopSessionState) => void;
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

const noop = () => {};

/**
 * Pure decision for the "SOP deleted" recovery effect. Extracted for unit
 * testing — the effect wraps this with refs + side-effects.
 *
 * Contract: a SOP is only treated as "deleted" after we have observed it
 * existing in `sopIds` at least once (`confirmedId === selectedId`). First
 * render / StrictMode double-run paths land in `'noop'`.
 */
export type SopSelectionAction = 'noop' | 'confirm' | 'toast-and-reset';

export function decideSopSelectionAction(input: {
  selectedId: string | null;
  loading: boolean;
  sopIds: readonly string[];
  confirmedId: string | null;
}): SopSelectionAction {
  const { selectedId, loading, sopIds, confirmedId } = input;
  if (!selectedId || loading) return 'noop';
  if (sopIds.includes(selectedId)) return 'confirm';
  if (confirmedId === selectedId) return 'toast-and-reset';
  return 'noop';
}

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
  const { tier } = useLayoutTier();
  const [persistedSidebar, setPersistedSidebar] = useSidebarCollapse('sops');
  const { sops, loading, error, deleteSop, refreshSops } = useSops();
  const { sendMessage, repos } = useOffisimRuntime();
  const { toasts, addToast, dismissToast } = useToasts();

  const [editorOpen, setEditorOpen] = useState(false);
  const [importOpen, setImportOpen] = useState(false);
  const [nlInput, setNlInput] = useState('');
  const [selectedStepId, setSelectedStepId] = useState<string | null>(null);
  const [editMode, setEditMode] = useState(false);
  const [sidebarDrawerOpen, setSidebarDrawerOpen] = useState(false);
  const [inspectorOpen, setInspectorOpen] = useState(false);
  const [saveStatus, setSaveStatus] = useState<'idle' | 'saving' | 'saved' | 'error'>('idle');

  // Add step popover state
  const [addStepPopover, setAddStepPopover] = useState<{
    screenX: number;
    screenY: number;
    canvasX: number;
    canvasY: number;
    editStepId?: string;
  } | null>(null);

  // Context menu state
  const [contextMenu, setContextMenu] = useState<{
    stepId: string;
    screenX: number;
    screenY: number;
  } | null>(null);

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

  // Persistent missing-role surface (replaces handleRun one-shot toast).
  // `useAgentStates` is already the live SSOT (subscribes to employee.*),
  // so the chip updates reactively as employees come and go.
  const agents = useAgentStates();
  const presentRoleSlugs = useMemo(() => {
    const set = new Set<string>();
    for (const a of agents.values()) set.add(a.role);
    return set;
  }, [agents]);
  const missingRoleSet = useMemo(() => {
    if (!definition) return new Set<string>();
    const missing = new Set<string>();
    for (const s of definition.steps) {
      if (s.role_slug && !presentRoleSlugs.has(s.role_slug)) missing.add(s.role_slug);
    }
    return missing;
  }, [definition, presentRoleSlugs]);

  // --- Deleted SOP recovery ---
  // Only fire "deleted" after observing the id existing in sops — guards
  // against first-frame empty sops and StrictMode effect double-runs.
  const confirmedSelectedIdRef = useRef<string | null>(null);

  useEffect(() => {
    const action = decideSopSelectionAction({
      selectedId: sessionState.selectedSopId,
      loading,
      sopIds: sops.map((s) => s.sopTemplateId),
      confirmedId: confirmedSelectedIdRef.current,
    });

    if (action === 'noop') return;
    if (action === 'confirm') {
      confirmedSelectedIdRef.current = sessionState.selectedSopId;
      return;
    }
    addToast('The selected SOP was deleted.', 'info');
    confirmedSelectedIdRef.current = null;
    onSessionStateChange((prev) => {
      if (!prev.selectedSopId) return prev;
      return { ...prev, selectedSopId: null };
    });
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
      setSaveStatus('saving');
      try {
        await repos.sopTemplates.update(selectedSop.sopTemplateId, {
          definition_json: JSON.stringify(next),
        });
        await refreshSops();
        setSaveStatus('saved');
      } catch {
        setSaveStatus('error');
        addToast('Failed to update SOP', 'error');
      }
    },
    [selectedSop, definition, repos, refreshSops, addToast],
  );

  // Auto-fade the 'saved' indicator back to idle after 1.5s
  useEffect(() => {
    if (saveStatus !== 'saved') return;
    const timer = window.setTimeout(() => setSaveStatus('idle'), 1500);
    return () => window.clearTimeout(timer);
  }, [saveStatus]);

  // --- Callbacks ---

  const handleSelectSop = useCallback(
    (sopId: string) => {
      onSessionStateChange((prev) => ({ ...prev, selectedSopId: sopId, focusedStepId: null }));
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
    // SOP runs are unscoped until OfficeSessionState.selectedThreadId exists;
    // deliverables land in the cross-thread bucket (chatThreadId=null).
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
      onSessionStateChange((prev) => ({ ...prev, focusedStepId: stepId }));
      const step = definition?.steps.find((s) => s.step_id === stepId);
      if (step) {
        setNlInput(formatStepClickPrefill(step.label, step.role_slug));
      }
    },
    [definition, onSessionStateChange],
  );

  useEffect(() => {
    if (!sessionState.focusedStepId) {
      setSelectedStepId(null);
      return;
    }
    if (!stepIds.includes(sessionState.focusedStepId)) {
      onSessionStateChange((prev) =>
        prev.focusedStepId ? { ...prev, focusedStepId: null } : prev,
      );
      return;
    }
    setSelectedStepId(sessionState.focusedStepId);
  }, [onSessionStateChange, sessionState.focusedStepId, stepIds]);

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

  // --- Bake positions on edit mode enter (await before enabling drag) ---
  const handleEditModeToggle = useCallback(async () => {
    if (!editMode && definition) {
      const needsBake = definition.steps.some((s) => s.position == null);
      if (needsBake) {
        const positions = computeAutoLayoutPositions(definition);
        await updateDefinition((def) => ({
          ...def,
          steps: def.steps.map((s) => ({
            ...s,
            position: positions.get(s.step_id) ?? { x: 0, y: 0 },
          })),
        }));
      }
    }
    setEditMode((prev) => !prev);
  }, [editMode, definition, updateDefinition]);

  // --- Move step (node drag) ---
  const handleMoveStep = useCallback(
    (stepId: string, x: number, y: number) => {
      void updateDefinition((def) => ({
        ...def,
        steps: def.steps.map((s) => (s.step_id === stepId ? { ...s, position: { x, y } } : s)),
      }));
    },
    [updateDefinition],
  );

  // --- Auto layout ---
  const handleAutoLayout = useCallback(() => {
    if (!definition) return;
    const positions = computeAutoLayoutPositions(definition);
    void updateDefinition((def) => ({
      ...def,
      steps: def.steps.map((s) => ({
        ...s,
        position: positions.get(s.step_id) ?? { x: 0, y: 0 },
      })),
    }));
  }, [definition, updateDefinition]);

  // --- Add step popover submit ---
  const handleAddStepSubmit = useCallback(
    (values: StepFormValues) => {
      if (!definition) return;
      const popover = addStepPopover;

      if (popover?.editStepId) {
        void updateDefinition((def) => ({
          ...def,
          steps: def.steps.map((s) =>
            s.step_id === popover.editStepId
              ? {
                  ...s,
                  label: values.label,
                  role_slug: values.roleSlug,
                  instruction: values.instruction,
                }
              : s,
          ),
        }));
      } else {
        const id = `step-${Date.now()}`;
        void updateDefinition((def) => ({
          ...def,
          steps: [
            ...def.steps,
            {
              step_id: id,
              label: values.label || 'New Step',
              role_slug: values.roleSlug,
              instruction: values.instruction,
              dependencies: [],
              output_key: id,
              position: popover ? { x: popover.canvasX, y: popover.canvasY } : undefined,
            },
          ],
        }));
      }
      setAddStepPopover(null);
    },
    [definition, updateDefinition, addStepPopover],
  );

  // --- Double-click canvas blank → add step at position ---
  const handleDoubleClickCanvas = useCallback(
    (canvasX: number, canvasY: number, screenX: number, screenY: number) => {
      setContextMenu(null);
      setAddStepPopover({ screenX, screenY, canvasX, canvasY });
    },
    [],
  );

  // --- Double-click node → edit step ---
  const handleDoubleClickNode = useCallback(
    (stepId: string, screenX: number, screenY: number) => {
      const step = definition?.steps.find((s) => s.step_id === stepId);
      if (!step) return;
      setContextMenu(null);
      setAddStepPopover({
        screenX,
        screenY,
        canvasX: step.position?.x ?? 0,
        canvasY: step.position?.y ?? 0,
        editStepId: stepId,
      });
    },
    [definition],
  );

  // --- Context menu open ---
  const handleContextMenu = useCallback((stepId: string, screenX: number, screenY: number) => {
    setAddStepPopover(null);
    setContextMenu({ stepId, screenX, screenY });
  }, []);

  // --- Context menu: edit ---
  const handleEditStepFromMenu = useCallback(
    (stepId: string) => {
      const step = definition?.steps.find((s) => s.step_id === stepId);
      if (!step) return;
      // contextMenu is read from closure before onClose sets it to null
      setAddStepPopover({
        screenX: contextMenu?.screenX ?? 0,
        screenY: contextMenu?.screenY ?? 0,
        canvasX: step.position?.x ?? 0,
        canvasY: step.position?.y ?? 0,
        editStepId: stepId,
      });
    },
    [definition, contextMenu],
  );

  // --- Context menu: duplicate ---
  const handleDuplicateStep = useCallback(
    (stepId: string) => {
      const step = definition?.steps.find((s) => s.step_id === stepId);
      if (!step) return;
      const newId = `step-${Date.now()}`;
      const newStep: SopStep = {
        ...step,
        step_id: newId,
        label: `${step.label} (copy)`,
        output_key: newId,
        dependencies: [...step.dependencies],
        position: step.position ? { x: step.position.x + 40, y: step.position.y + 40 } : undefined,
      };
      void updateDefinition((def) => ({
        ...def,
        steps: [...def.steps, newStep],
      }));
    },
    [definition, updateDefinition],
  );

  // Live cycle preview during port-drag. Shares `getExecutionBatches` with
  // validateNoCycles, so the predicate matches the post-drop backstop.
  const canConnect = useCallback(
    (fromStepId: string, toStepId: string) => {
      if (!definition) return false;
      if (fromStepId === toStepId) return false;
      return !wouldCreateCycle(definition, fromStepId, toStepId);
    },
    [definition],
  );

  const showEmpty = !sessionState.selectedSopId || !layout;
  const sidebarCollapsed = tier === 'tablet' && persistedSidebar === 'collapsed';
  const showInlineSidebar = tier !== 'narrow';
  const showInlineInspector = tier === 'desktop' && !showEmpty;
  const showInspectorHandle = tier === 'tablet' && !showEmpty;
  const showInspectorSheet = tier === 'narrow' && !showEmpty && inspectorOpen;
  const showInspectorOverlay = tier === 'tablet' && !showEmpty && inspectorOpen;

  useEffect(() => {
    if (tier === 'narrow' && editMode) setEditMode(false);
  }, [editMode, tier]);

  useEffect(() => {
    if (tier !== 'desktop' && selectedStepId) setInspectorOpen(true);
  }, [selectedStepId, tier]);

  const toggleSidebarCollapse = useCallback(() => {
    setPersistedSidebar(persistedSidebar === 'collapsed' ? 'expanded' : 'collapsed');
  }, [persistedSidebar, setPersistedSidebar]);

  const sidebar = (
    <SopSidebar
      sops={sops}
      selectedSopId={sessionState.selectedSopId}
      search={sessionState.search}
      loading={loading}
      onSelectSop={(sopId) => {
        handleSelectSop(sopId);
        setSidebarDrawerOpen(false);
      }}
      onSearchChange={handleSearchChange}
      onCreateClick={() => {
        setEditorOpen(true);
        setSidebarDrawerOpen(false);
      }}
      onImportClick={() => {
        setImportOpen(true);
        setSidebarDrawerOpen(false);
      }}
      collapsed={sidebarCollapsed}
      onToggleCollapse={tier === 'tablet' ? toggleSidebarCollapse : undefined}
    />
  );

  return (
    <div
      className="relative flex h-full overflow-hidden bg-surface text-text-primary"
      data-layout-tier={tier}
    >
      <ToastBanner toasts={toasts} onDismiss={dismissToast} />

      {/* Left sidebar — SOP list */}
      {showInlineSidebar && sidebar}

      {/* Right panel — toolbar + canvas + command bar */}
        <div className="relative flex min-w-0 flex-1 flex-col bg-surface">
        <SopLibraryBar
          selectedSopId={sessionState.selectedSopId}
          hasSourceUrl={!!selectedSop?.sourceUrl}
          onRun={handleRun}
          onDelete={handleDelete}
          onSync={handleSync}
          onCreateClick={() => setEditorOpen(true)}
          onImportClick={() => setImportOpen(true)}
          onToggleSidebar={tier === 'narrow' ? () => setSidebarDrawerOpen(true) : undefined}
          editMode={tier === 'narrow' ? false : editMode}
          onEditModeToggle={tier === 'narrow' ? undefined : handleEditModeToggle}
          onAutoLayout={handleAutoLayout}
          allowEditMode={tier !== 'narrow'}
        />

        {error && (
          <ErrorState
            variant="banner"
            className="m-3"
            title="Couldn't load SOPs"
            message="The SOP library could not be refreshed."
            technicalDetail={error}
            primaryAction={{ label: 'Retry', onClick: () => void refreshSops() }}
          />
        )}

        {saveStatus !== 'idle' && (
          <div className="pointer-events-none absolute right-4 top-14 z-10">
            <span
              className={`rounded px-2 py-1 font-mono text-[10px] uppercase tracking-wider ${
                saveStatus === 'saving'
                  ? 'border border-border-default bg-surface-elevated text-text-secondary'
                  : saveStatus === 'saved'
                    ? 'border border-success/30 bg-success-muted text-success'
                    : 'border border-error/30 bg-error-muted text-error'
              }`}
            >
              {saveStatus === 'saving'
                ? 'Saving…'
                : saveStatus === 'saved'
                  ? 'All changes saved'
                  : 'Save failed'}
            </span>
          </div>
        )}

        {selectedSop && definition && (
          <SopRunProgressStrip definition={definition} sopTemplateId={selectedSop.sopTemplateId} />
        )}

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
            onAddStep={noop}
            onMoveStep={handleMoveStep}
            onContextMenu={handleContextMenu}
            onDoubleClickCanvas={handleDoubleClickCanvas}
            onDoubleClickNode={handleDoubleClickNode}
            canConnect={canConnect}
            missingRoleSet={missingRoleSet}
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

      {/* Right inspector — mounted whenever a SOP is selected */}
      {showInlineInspector && (
        <SopInspectorPanel
          definition={definition}
          selectedStepId={selectedStepId}
          runtimeState={runtimeState}
          stepIds={stepIds}
          onSelectStep={handleStepClick}
          missingRoleSet={missingRoleSet}
        />
      )}

      {showInspectorHandle && (
        <Button
          type="button"
          variant="ghost"
          size="icon"
          className="absolute right-3 top-14 z-overlay h-9 w-9 rounded-full border border-border-subtle bg-surface-elevated shadow-modal"
          onClick={() => setInspectorOpen((prev) => !prev)}
          aria-label={inspectorOpen ? 'Close SOP inspector' : 'Open SOP inspector'}
        >
          {inspectorOpen ? (
            <PanelRightClose className="h-4 w-4" />
          ) : (
            <PanelRightOpen className="h-4 w-4" />
          )}
        </Button>
      )}

      {showInspectorOverlay && (
        <div className="absolute inset-y-10 right-3 z-overlay w-[340px] overflow-hidden rounded-xl border border-border-subtle bg-surface-elevated shadow-modal">
          <div className="flex h-9 items-center justify-end border-b border-border-subtle px-2">
            <Button
              type="button"
              variant="ghost"
              size="icon"
              className="h-7 w-7"
              onClick={() => setInspectorOpen(false)}
              aria-label="Close SOP inspector"
            >
              <X className="h-4 w-4" />
            </Button>
          </div>
          <SopInspectorPanel
            definition={definition}
            selectedStepId={selectedStepId}
            runtimeState={runtimeState}
            stepIds={stepIds}
            onSelectStep={handleStepClick}
            missingRoleSet={missingRoleSet}
            className="h-[calc(100%-2.25rem)] w-full border-l-0"
          />
        </div>
      )}

      {sidebarDrawerOpen && tier === 'narrow' && (
        <div className="absolute inset-0 z-modal flex">
          <button
            type="button"
            aria-label="Close SOP list"
            className="absolute inset-0 bg-surface/70"
            onClick={() => setSidebarDrawerOpen(false)}
          />
          <div className="relative z-10 h-full shadow-modal">{sidebar}</div>
        </div>
      )}

      {showInspectorSheet && (
        <div className="absolute inset-x-0 bottom-0 z-overlay max-h-[52vh] overflow-hidden rounded-t-2xl border-t border-border-subtle bg-surface-elevated shadow-modal">
          <div className="flex h-10 items-center justify-between border-b border-border-subtle px-3">
            <span className="text-xs font-semibold text-text-secondary">Step inspector</span>
            <Button
              type="button"
              variant="ghost"
              size="icon"
              className="h-7 w-7"
              onClick={() => setInspectorOpen(false)}
              aria-label="Close SOP inspector"
            >
              <X className="h-4 w-4" />
            </Button>
          </div>
          <SopInspectorPanel
            definition={definition}
            selectedStepId={selectedStepId}
            runtimeState={runtimeState}
            stepIds={stepIds}
            onSelectStep={handleStepClick}
            missingRoleSet={missingRoleSet}
            className="max-h-[calc(52vh-2.5rem)] w-full border-l-0"
          />
        </div>
      )}

      <SopEditorDialog open={editorOpen} onOpenChange={setEditorOpen} onCreated={handleCreated} />
      <SopImportDialog open={importOpen} onOpenChange={setImportOpen} onImported={handleCreated} />

      {/* Add/Edit step popover */}
      {addStepPopover && (
        <SopAddStepPopover
          open={true}
          onOpenChange={(open) => {
            if (!open) setAddStepPopover(null);
          }}
          anchor={
            <div
              className="fixed h-px w-px"
              style={{ left: addStepPopover.screenX, top: addStepPopover.screenY }}
            />
          }
          initialValues={
            addStepPopover.editStepId
              ? (() => {
                  const step = definition?.steps.find(
                    (s) => s.step_id === addStepPopover.editStepId,
                  );
                  return step
                    ? {
                        label: step.label,
                        roleSlug: step.role_slug,
                        instruction: step.instruction,
                      }
                    : undefined;
                })()
              : undefined
          }
          submitLabel={addStepPopover.editStepId ? 'Save' : 'Add'}
          stackId={`sop-step-popover-${addStepPopover.editStepId ?? 'create'}`}
          onSubmit={handleAddStepSubmit}
        />
      )}

      {/* Node context menu */}
      {contextMenu && (
        <SopNodeContextMenu
          stepId={contextMenu.stepId}
          position={{ x: contextMenu.screenX, y: contextMenu.screenY }}
          onEdit={handleEditStepFromMenu}
          onDuplicate={handleDuplicateStep}
          onDelete={(stepId) => {
            handleDeleteStep(stepId);
            setContextMenu(null);
          }}
          onClose={() => setContextMenu(null)}
        />
      )}
    </div>
  );
}
