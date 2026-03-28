/**
 * StudioPage -- Full-screen wrapper for Offisim Studio.
 *
 * Composes all Studio sub-components, handles keyboard shortcuts not covered
 * by StudioToolbar (rotate, delete, escape, Ctrl+S), and manages save flow
 * (create or edit) via RuntimeRepositories.
 */

import type { RuntimeRepositories } from '@aics/core/browser';
import { hydrateZone, ZoneService } from '@aics/core/browser';
import type { PrefabInstanceRow } from '@aics/shared-types';
import { SYSTEM_ZONE_TEMPLATES, templateToZone } from '@aics/shared-types';
import { Loader2 } from 'lucide-react';
import { useCallback, useEffect, useRef, useState } from 'react';
import { StudioCanvas } from './StudioCanvas.js';
import { StudioGhost } from './StudioGhost.js';
import { StudioPalette } from './StudioPalette.js';
import { StudioPlacedPrefabs } from './StudioPlacedPrefabs.js';
import { StudioPlotSelector } from './StudioPlotSelector.js';
import { StudioProperties } from './StudioProperties.js';
import { STUDIO_TEMP_PREFIX, useStudioStore } from './StudioState.js';
import { StudioToolbar } from './StudioToolbar.js';
import { FONT, LAYOUT, SP, STUDIO_COLORS } from './studio-tokens.js';

// -- Props --------------------------------------------------------------------

export interface StudioPageProps {
  mode: 'create' | 'edit';
  companyId?: string; // required for edit mode
  repos: RuntimeRepositories | null;
  onBack: () => void;
  onCompanyCreated?: (companyId: string) => void;
}

// -- Styles -------------------------------------------------------------------

const ROOT_STYLE: React.CSSProperties = {
  position: 'fixed',
  inset: 0,
  background: STUDIO_COLORS.canvasBg,
  fontFamily: FONT.family,
  zIndex: 50, // above normal office UI
};

const CANVAS_CONTAINER: React.CSSProperties = {
  position: 'absolute',
  top: LAYOUT.toolbarHeight,
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
        background: 'rgba(0,0,0,0.6)',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        zIndex: 100,
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

export function StudioPage({ mode, companyId, repos, onBack, onCompanyCreated }: StudioPageProps) {
  const [saving, setSaving] = useState(false);
  const [saveFlash, setSaveFlash] = useState(false);
  const [showNameModal, setShowNameModal] = useState(false);
  const [loading, setLoading] = useState(mode === 'edit');

  // Pending save resolver when waiting for company name
  const pendingSaveRef = useRef<((name: string | null) => void) | null>(null);

  // Camera focus callback — assigned by StudioCanvas, called on F/Home key
  const focusRef = useRef<((pos: [number, number, number]) => void) | null>(null);

  // -- Company isolation: reset store when company changes ----------------------

  useEffect(() => {
    if (companyId) {
      useStudioStore.getState().resetForCompany(companyId);
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

  // TODO: place success scale bounce + delete fade animations — see Skill §14 timings

  // -- Load existing data (edit mode) -----------------------------------------

  useEffect(() => {
    if (mode === 'edit' && companyId && repos) {
      setLoading(true);
      Promise.all([
        repos.prefabInstances.findByCompany(companyId),
        repos.zones.findByCompany(companyId),
      ]).then(([instanceRows, zoneRows]) => {
        const store = useStudioStore.getState();

        // Hydrate zones
        const zones = zoneRows.map((r) => hydrateZone(r));
        store.setZones(zones);

        // Load instances
        const instances = instanceRows.map((r) => ({
          id: r.instance_id,
          prefabId: r.prefab_id,
          position: [r.position_x, 0, r.position_y] as [number, number, number],
          rotation: r.rotation,
          zoneId: r.zone_id,
        }));
        store.setInstances(instances);
        setLoading(false);
      });
    } else {
      // Create mode: populate with default zone templates so placement can resolve
      const store = useStudioStore.getState();
      const defaultZones = SYSTEM_ZONE_TEMPLATES.map((t) => templateToZone(t, ''));
      store.setZones(defaultZones);
      store.setInstances([]);
      setLoading(false);
    }
  }, [mode, companyId, repos]);

  // -- Save flow --------------------------------------------------------------

  const handleSave = useCallback(async () => {
    if (!repos) return;
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

        if (!name) {
          setSaving(false);
          return;
        }

        targetCompanyId = crypto.randomUUID();
        const now = new Date().toISOString();
        await repos.companies.create({
          company_id: targetCompanyId,
          name,
          status: 'active',
          workspace_root: null,
          default_model_policy_json: null,
          created_at: now,
          updated_at: now,
        });

        // Seed system zones for the new company
        const zoneService = new ZoneService(repos.zones);
        const seededZones = await zoneService.seedSystemZones(targetCompanyId);
        useStudioStore.getState().setZones(seededZones);
      } else if (targetCompanyId) {
        // Edit mode: wipe existing prefab instances before re-writing
        await repos.prefabInstances.deleteByCompany(targetCompanyId);
      }

      if (targetCompanyId) {
        const now = new Date().toISOString();
        for (const inst of state.instances) {
          const row: PrefabInstanceRow = {
            instance_id: inst.id.startsWith(STUDIO_TEMP_PREFIX) ? crypto.randomUUID() : inst.id,
            company_id: targetCompanyId,
            prefab_id: inst.prefabId,
            zone_id: inst.zoneId,
            position_x: Number.parseFloat(inst.position[0].toFixed(4)),
            position_y: Number.parseFloat(inst.position[2].toFixed(4)),
            rotation: inst.rotation,
            bindings_json: null,
            config_json: null,
            enabled: 1,
            created_at: now,
            updated_at: now,
          };
          await repos.prefabInstances.create(row);
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
    }
  }, [repos, companyId, mode, onCompanyCreated]);

  // -- Keyboard shortcuts (non-tool shortcuts) --------------------------------
  // Tool shortcuts (1-4, G) are handled by StudioToolbar.
  // We handle: r/R rotate, Delete/Backspace delete, Escape, Ctrl+S.

  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if (e.target instanceof HTMLInputElement || e.target instanceof HTMLTextAreaElement) return;

      const store = useStudioStore.getState();

      switch (e.key) {
        case 'r':
        case 'R':
          if (store.placingPrefab) {
            store.rotateGhost();
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
        case 'Escape':
          if (store.focusedZoneId) store.unfocusZone();
          else if (store.placingPrefab) store.cancelPlacement();
          else store.selectInstance(null);
          break;
        // Number keys 1-7: focus zones by sort order
        case '1': case '2': case '3': case '4': case '5': case '6': case '7': {
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
