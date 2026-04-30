/**
 * StudioPage -- Full-screen wrapper for Offisim Studio.
 *
 * Composes all Studio sub-components, handles keyboard shortcuts not covered
 * by StudioToolbar (rotate, delete, escape, Ctrl+S), and manages save flow
 * (create or edit) via RuntimeRepositories.
 */

import type { RuntimeRepositories } from '@offisim/core/browser';
import { hydrateZone } from '@offisim/core/browser';

import {
  STUDIO_PREVIEW_COMPANY_ID,
  SYSTEM_ZONE_TEMPLATES,
  templateToZone,
} from '@offisim/shared-types';
import {
  ToastBanner,
  getTopmostModalId,
  useRegisterModal,
  useToasts,
  useTopmostEscape,
} from '@offisim/ui-core';
import { Loader2 } from 'lucide-react';
import { useCallback, useEffect, useRef, useState } from 'react';
import { saveZonesToDb } from '../../lib/zone-persistence.js';
import { useOffisimRuntime } from '../../runtime/offisim-runtime-context.js';
import { PlotZoneBreadcrumb } from './PlotZoneBreadcrumb.js';
import { StudioCanvas } from './StudioCanvas.js';
import { STUDIO_IDENTITY_HEIGHT, StudioCompanyIdentity } from './StudioCompanyIdentity.js';
import { StudioGhost } from './StudioGhost.js';
import { StudioPalette } from './StudioPalette.js';
import { StudioPlacedPrefabs } from './StudioPlacedPrefabs.js';
import { StudioPlotSelector } from './StudioPlotSelector.js';
import { StudioProperties } from './StudioProperties.js';
import { useStudioStore } from './StudioState.js';
import { StudioToolbar } from './StudioToolbar.js';
import { StudioZoneGhost } from './StudioZoneGhost.js';
import { CREATE_PLOT_KEY, readStoredPlotSize } from './studio-plot-size-storage.js';
import { FONT, LAYOUT, SP, STUDIO_COLORS, STUDIO_Z_INDEX } from './studio-style-helpers.js';

const BREADCRUMB_HEIGHT = 32;
const TOP_CHROME_HEIGHT = LAYOUT.toolbarHeight + STUDIO_IDENTITY_HEIGHT + BREADCRUMB_HEIGHT;

// -- Props --------------------------------------------------------------------

export type StudioPageProps =
  | {
      mode: 'create';
      companyId?: undefined;
      repos: RuntimeRepositories | null;
      onBack: () => void;
      onCompanyCreated?: (companyId: string) => void;
    }
  | {
      mode: 'edit';
      companyId: string;
      repos: RuntimeRepositories | null;
      onBack: () => void;
      onCompanyCreated?: (companyId: string) => void;
    };

// -- Styles -------------------------------------------------------------------

const ROOT_STYLE: React.CSSProperties = {
  position: 'fixed',
  inset: 0,
  background: STUDIO_COLORS.canvasBg,
  fontFamily: FONT.family,
  zIndex: STUDIO_Z_INDEX.dropdown,
};

const CANVAS_CONTAINER: React.CSSProperties = {
  position: 'absolute',
  top: TOP_CHROME_HEIGHT,
  left: LAYOUT.paletteWidth,
  right: LAYOUT.propertiesWidth,
  bottom: LAYOUT.bottomBarHeight,
};

// -- Inline modal for company name --------------------------------------------

function CompanyNameModal({
  onConfirm,
  onCancel,
}: {
  onConfirm: (name: string) => void;
  onCancel: () => void;
}) {
  const [name, setName] = useState('My Company');
  const inputRef = useRef<HTMLInputElement>(null);

  useTopmostEscape('studio-company-name', onCancel);

  useEffect(() => {
    inputRef.current?.select();
  }, []);

  const handleSubmit = () => {
    const trimmed = name.trim();
    if (trimmed) onConfirm(trimmed);
  };

  return (
    <div
      style={{
        position: 'fixed',
        inset: 0,
        background: STUDIO_COLORS.surface0,
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        zIndex: STUDIO_Z_INDEX.modal,
      }}
      role="presentation"
      onClick={onCancel}
      tabIndex={-1}
      onKeyDown={(e) => {
        if (e.key === 'Escape') onCancel();
      }}
    >
      <dialog
        open
        aria-labelledby="company-name-modal-title"
        onPointerDown={(e) => e.stopPropagation()}
        style={{
          background: STUDIO_COLORS.surface0,
          border: `1px solid ${STUDIO_COLORS.border}`,
          borderRadius: LAYOUT.cardRadius,
          padding: SP.xxl,
          width: 340,
          display: 'flex',
          flexDirection: 'column',
          gap: SP.lg,
          margin: 0,
        }}
      >
        <h2
          id="company-name-modal-title"
          style={{
            fontSize: FONT.xl,
            fontWeight: FONT.semibold,
            color: STUDIO_COLORS.textPrimary,
            fontFamily: FONT.family,
          }}
        >
          Company Name
        </h2>
        <input
          ref={inputRef}
          value={name}
          onChange={(e) => setName(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter') handleSubmit();
            if (e.key === 'Escape') onCancel();
          }}
          aria-label="Company name"
          style={{
            width: '100%',
            padding: `${SP.sm}px ${SP.md}px`,
            background: STUDIO_COLORS.surface1,
            border: `1px solid ${STUDIO_COLORS.borderActive}`,
            borderRadius: LAYOUT.buttonRadius,
            color: STUDIO_COLORS.textPrimary,
            fontSize: FONT.md,
            fontFamily: FONT.family,
            outline: 'none',
            boxSizing: 'border-box',
          }}
        />
        <div style={{ display: 'flex', gap: SP.sm, justifyContent: 'flex-end' }}>
          <button
            type="button"
            onClick={onCancel}
            aria-label="Cancel"
            style={{
              padding: `${SP.sm}px ${SP.lg}px`,
              background: STUDIO_COLORS.surface2,
              border: `1px solid ${STUDIO_COLORS.border}`,
              borderRadius: LAYOUT.buttonRadius,
              color: STUDIO_COLORS.textSecondary,
              fontSize: FONT.base,
              fontFamily: FONT.family,
              cursor: 'pointer',
            }}
          >
            Cancel
          </button>
          <button
            type="button"
            onClick={handleSubmit}
            aria-label="Create company"
            style={{
              padding: `${SP.sm}px ${SP.lg}px`,
              background: STUDIO_COLORS.accentMuted,
              border: `1px solid ${STUDIO_COLORS.borderActive}`,
              borderRadius: LAYOUT.buttonRadius,
              color: STUDIO_COLORS.accentText,
              fontSize: FONT.base,
              fontWeight: FONT.semibold,
              fontFamily: FONT.family,
              cursor: 'pointer',
            }}
          >
            Create
          </button>
        </div>
      </dialog>
    </div>
  );
}

// -- Component ----------------------------------------------------------------

export function StudioPage(props: StudioPageProps) {
  const { mode, repos, onBack, onCompanyCreated } = props;
  const companyId = props.mode === 'edit' ? props.companyId : undefined;
  const { eventBus } = useOffisimRuntime();
  const { toasts, addToast, dismissToast } = useToasts();
  const [saving, setSaving] = useState(false);
  const [saveFlash, setSaveFlash] = useState(false);
  const [showNameModal, setShowNameModal] = useState(false);
  const [loading, setLoading] = useState(mode === 'edit' || !props.repos);

  // Register in the modal stack so Office-level shortcuts gate on Studio and
  // the inline company-name modal can take topmost ownership above us.
  const studioStackId = 'studio-page';
  useRegisterModal(studioStackId, 'overlay');
  const companyNameModalStackId = 'studio-company-name';
  useRegisterModal(showNameModal ? companyNameModalStackId : null, 'dialog');

  // Pending save resolver when waiting for company name
  const pendingSaveRef = useRef<((name: string | null) => void) | null>(null);
  const savingRef = useRef(false);

  // Camera focus callback — assigned by StudioCanvas, called on F/Home key
  const focusRef = useRef<((pos: [number, number, number]) => void) | null>(null);

  // -- Company isolation: reset store when company changes ----------------------

  useEffect(() => {
    if (companyId) {
      useStudioStore.getState().resetForCompany(companyId);
    } else {
      // Create mode has no resetForCompany trigger; pull stored plotSize directly.
      const stored = readStoredPlotSize(CREATE_PLOT_KEY);
      if (stored) useStudioStore.setState({ plotSize: stored });
    }
  }, [companyId]);

  // -- beforeunload guard (Skill §15) ------------------------------------------

  const dirty = useStudioStore((s) => s.dirty);

  useEffect(() => {
    if (!dirty) return;
    const handler = (e: BeforeUnloadEvent) => {
      e.preventDefault();
    };
    window.addEventListener('beforeunload', handler);
    return () => window.removeEventListener('beforeunload', handler);
  }, [dirty]);

  // -- Load existing data (edit mode) -----------------------------------------

  useEffect(() => {
    let cancelled = false;

    async function loadStudioState() {
      const store = useStudioStore.getState();

      // Runtime not ready: initial loading state is already true; wait for
      // the effect to re-run once repos arrives.
      if (!repos) return;

      if (companyId) {
        setLoading(true);
        const [instanceRows, zoneRows] = await Promise.all([
          repos.prefabInstances.findByCompany(companyId),
          repos.zones.findByCompany(companyId),
        ]);

        if (cancelled) return;

        store.loadZonesFromDb(
          zoneRows.length > 0
            ? zoneRows.map((row) => hydrateZone(row))
            : SYSTEM_ZONE_TEMPLATES.map((template) => templateToZone(template, companyId)),
        );
        store.setInstances(
          instanceRows.map((row) => ({
            id: row.instance_id,
            prefabId: row.prefab_id,
            position: [row.position_x, 0, row.position_y] as [number, number, number],
            rotation: row.rotation,
            zoneId: row.zone_id,
          })),
        );
        setLoading(false);
        return;
      }

      // Blank create mode: sentinel prefix; saveZonesToDb rewrites to real UUID.
      store.loadZonesFromDb(
        SYSTEM_ZONE_TEMPLATES.map((t) => templateToZone(t, STUDIO_PREVIEW_COMPANY_ID)),
      );
      store.setInstances([]);
      setLoading(false);
    }

    void loadStudioState();

    return () => {
      cancelled = true;
    };
  }, [companyId, repos]);

  // -- Save flow --------------------------------------------------------------

  const handleSave = useCallback(async () => {
    if (!repos || savingRef.current) return;
    savingRef.current = true;
    setSaving(true);
    try {
      const state = useStudioStore.getState();
      let targetCompanyId = companyId;

      if (mode === 'create') {
        // Show inline modal and wait for the name
        const name = await new Promise<string | null>((resolve) => {
          pendingSaveRef.current = resolve;
          setShowNameModal(true);
        });
        pendingSaveRef.current = null;

        if (!name) return;

        targetCompanyId = crypto.randomUUID();
        const now = new Date().toISOString();
        await repos.companies.create({
          company_id: targetCompanyId,
          name,
          status: 'active',
          template_id: null,
          template_label: null,
          workspace_root: null,
          default_model_policy_json: null,
          created_at: now,
          updated_at: now,
        });
      }

      if (targetCompanyId) {
        try {
          await saveZonesToDb(
            { prefabInstances: repos.prefabInstances, zones: repos.zones },
            targetCompanyId,
            state.zones,
            state.instances,
            eventBus,
          );
        } catch (err) {
          addToast(err instanceof Error ? err.message : 'Save failed', 'error');
          return;
        }
      }

      useStudioStore.getState().markClean();

      // Show save success flash
      setSaveFlash(true);
      setTimeout(() => setSaveFlash(false), 2000);

      if (mode === 'create' && targetCompanyId && onCompanyCreated) {
        onCompanyCreated(targetCompanyId);
      } else {
        // In edit mode, stay on page (flash shows success)
      }
    } finally {
      setSaving(false);
      savingRef.current = false;
    }
  }, [repos, companyId, eventBus, mode, onCompanyCreated, addToast]);

  // -- Keyboard shortcuts (non-tool shortcuts) --------------------------------
  // Tool shortcuts (1-4, G) are handled by StudioToolbar.
  // We handle: r/R rotate, Delete/Backspace delete, Escape, Ctrl+S.

  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if (e.target instanceof HTMLInputElement || e.target instanceof HTMLTextAreaElement) return;
      // Only consume shortcuts when Studio itself owns the topmost modal slot.
      // When the company-name modal or any other dialog layers above, let it
      // handle keys and peel its own layer first.
      if (getTopmostModalId() !== studioStackId) return;

      const store = useStudioStore.getState();

      switch (e.key) {
        case 'r':
        case 'R':
          if (store.placingPrefab || store.placingZonePreset) {
            store.rotateGhost();
          } else if (store.selectedZoneId && !store.selectedInstanceId) {
            store.rotateZone(store.selectedZoneId);
          } else {
            store.rotateSelected();
          }
          break;
        case 'f':
        case 'F': {
          // Focus camera on selected instance (Skill §3)
          const sel = store.selectedInstanceId;
          if (sel && focusRef.current) {
            const inst = store.instances.find((i) => i.id === sel);
            if (inst) focusRef.current(inst.position);
          }
          break;
        }
        case 'Home':
          // Reset camera to default view (Skill §4)
          if (focusRef.current) focusRef.current([0, 0, 0]);
          break;
        case 'Delete':
        case 'Backspace':
          store.deleteSelected();
          break;
        case 'Escape': {
          // Higher precedence: cancel ghost placement before any level pop.
          if (store.placingZonePreset) {
            store.cancelZonePlacement();
            e.preventDefault();
            e.stopPropagation();
            break;
          }
          if (store.placingPrefab) {
            store.cancelPlacement();
            e.preventDefault();
            e.stopPropagation();
            break;
          }
          // Level pop: Asset → Zone → Plot. Plot level does not consume.
          if (store.isEditingZone || store.selectedInstanceId) {
            store.exitEditZone();
            e.preventDefault();
            e.stopPropagation();
            break;
          }
          if (store.selectedZoneId) {
            store.unfocusZone();
            e.preventDefault();
            e.stopPropagation();
            break;
          }
          break;
        }
        // Number keys 1-7: focus zones by sort order
        case '1':
        case '2':
        case '3':
        case '4':
        case '5':
        case '6':
        case '7': {
          if (e.ctrlKey || e.metaKey || e.altKey) break;
          const idx = Number.parseInt(e.key) - 1;
          const sorted = [...store.zones].sort((a, b) => a.sortOrder - b.sortOrder);
          const target = sorted[idx];
          if (target) {
            if (store.focusedZoneId === target.zoneId) store.unfocusZone();
            else store.focusZone(target.zoneId);
          }
          break;
        }
        case 's':
          if (e.metaKey || e.ctrlKey) {
            e.preventDefault();
            handleSave();
          }
          break;
      }
    };
    window.addEventListener('keydown', handler);
    return () => window.removeEventListener('keydown', handler);
  }, [handleSave]);

  // -- Render -----------------------------------------------------------------

  return (
    <div style={ROOT_STYLE}>
      {/* Top toolbar: tools, grid toggle, save, back */}
      <StudioToolbar onSave={handleSave} onBack={onBack} saving={saving} saveFlash={saveFlash} />

      <ToastBanner toasts={toasts} onDismiss={dismissToast} />

      <StudioCompanyIdentity
        mode={mode}
        companyId={companyId}
        repos={repos}
        onError={(message) => addToast(message, 'error')}
      />

      {/* Hierarchy breadcrumb (Plot · Zone · Asset) */}
      <PlotZoneBreadcrumb />

      {/* Left palette: prefab catalog */}
      <StudioPalette />

      {/* Right panel: properties */}
      <StudioProperties />

      {/* 3D canvas area */}
      <div style={CANVAS_CONTAINER}>
        {loading ? (
          <div
            style={{
              width: '100%',
              height: '100%',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              background: STUDIO_COLORS.canvasBg,
            }}
          >
            <Loader2
              size={32}
              style={{
                color: STUDIO_COLORS.textTertiary,
                animation: 'spin 1s linear infinite',
              }}
            />
          </div>
        ) : (
          <StudioCanvas focusRef={focusRef}>
            <StudioPlacedPrefabs />
            <StudioGhost />
            <StudioZoneGhost />
          </StudioCanvas>
        )}
      </div>

      {/* Bottom bar: plot size selector */}
      <StudioPlotSelector />

      {/* Inline modal for company name (create mode) */}
      {showNameModal && (
        <CompanyNameModal
          onConfirm={(name) => {
            setShowNameModal(false);
            pendingSaveRef.current?.(name);
          }}
          onCancel={() => {
            setShowNameModal(false);
            pendingSaveRef.current?.(null);
          }}
        />
      )}

      {/* CSS keyframes for loader spinner */}
      <style>{'@keyframes spin { to { transform: rotate(360deg); } }'}</style>
    </div>
  );
}
