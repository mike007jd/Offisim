/**
 * StudioPage -- Full-screen wrapper for Offisim Studio.
 *
 * Composes all Studio sub-components, handles keyboard shortcuts not covered
 * by StudioToolbar (rotate, delete, escape, Ctrl+S), and manages save flow
 * (create or edit) via RuntimeRepositories.
 */

import { useCallback, useEffect, useRef, useState } from 'react';
import { Loader2 } from 'lucide-react';
import { useStudioStore } from './StudioState.js';
import { StudioCanvas } from './StudioCanvas.js';
import { StudioToolbar } from './StudioToolbar.js';
import { StudioPalette } from './StudioPalette.js';
import { StudioProperties } from './StudioProperties.js';
import { StudioPlotSelector } from './StudioPlotSelector.js';
import { StudioGhost } from './StudioGhost.js';
import { StudioPlacedPrefabs } from './StudioPlacedPrefabs.js';
import {
  STUDIO_COLORS,
  SP,
  FONT,
  LAYOUT,
} from './studio-tokens.js';
import type { RuntimeRepositories } from '@aics/core/browser';
import type { PrefabInstanceRow } from '@aics/shared-types';

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
      onClick={onCancel}
    >
      <div
        onClick={(e) => e.stopPropagation()}
        style={{
          background: STUDIO_COLORS.surface0,
          border: `1px solid ${STUDIO_COLORS.border}`,
          borderRadius: LAYOUT.cardRadius,
          padding: SP.xxl,
          width: 340,
          display: 'flex',
          flexDirection: 'column',
          gap: SP.lg,
        }}
      >
        <div
          style={{
            fontSize: FONT.xl,
            fontWeight: FONT.semibold,
            color: STUDIO_COLORS.textPrimary,
            fontFamily: FONT.family,
          }}
        >
          Company Name
        </div>
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
      </div>
    </div>
  );
}

// -- Component ----------------------------------------------------------------

export function StudioPage({
  mode,
  companyId,
  repos,
  onBack,
  onCompanyCreated,
}: StudioPageProps) {
  const [saving, setSaving] = useState(false);
  const [saveFlash, setSaveFlash] = useState(false);
  const [showNameModal, setShowNameModal] = useState(false);
  const [loading, setLoading] = useState(mode === 'edit');

  // Pending save resolver when waiting for company name
  const pendingSaveRef = useRef<((name: string | null) => void) | null>(null);

  // -- Load existing data (edit mode) -----------------------------------------

  useEffect(() => {
    if (mode === 'edit' && companyId && repos) {
      setLoading(true);
      repos.prefabInstances.findByCompany(companyId).then((rows) => {
        const instances = rows.map((r) => ({
          id: r.instance_id,
          prefabId: r.prefab_id,
          position: [r.position_x, 0, r.position_y] as [number, number, number],
          rotation: r.rotation,
          zoneId: r.zone_id,
        }));
        useStudioStore.getState().setInstances(instances);
        setLoading(false);
      });
    } else {
      useStudioStore.getState().setInstances([]);
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
      } else if (targetCompanyId) {
        // Edit mode: wipe existing prefab instances before re-writing
        await repos.prefabInstances.deleteByCompany(targetCompanyId);
      }

      if (targetCompanyId) {
        const now = new Date().toISOString();
        for (const inst of state.instances) {
          const row: PrefabInstanceRow = {
            instance_id: inst.id.startsWith('studio-')
              ? crypto.randomUUID()
              : inst.id,
            company_id: targetCompanyId,
            prefab_id: inst.prefabId,
            zone_id: inst.zoneId,
            position_x: parseFloat(inst.position[0].toFixed(4)),
            position_y: parseFloat(inst.position[2].toFixed(4)),
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
  }, [repos, companyId, mode, onBack, onCompanyCreated]);

  // -- Keyboard shortcuts (non-tool shortcuts) --------------------------------
  // Tool shortcuts (1-4, G) are handled by StudioToolbar.
  // We handle: r/R rotate, Delete/Backspace delete, Escape, Ctrl+S.

  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if (
        e.target instanceof HTMLInputElement ||
        e.target instanceof HTMLTextAreaElement
      )
        return;

      const store = useStudioStore.getState();

      switch (e.key) {
        case 'r':
        case 'R':
          store.rotateSelected();
          break;
        case 'f':
        case 'F':
          // Focus: reset camera to look at selected object or scene center
          // (handled via store — components subscribe and react)
          break;
        case 'Delete':
        case 'Backspace':
          store.deleteSelected();
          break;
        case 'Escape':
          if (store.placingPrefab) store.cancelPlacement();
          else store.selectInstance(null);
          break;
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
      <StudioToolbar
        onSave={handleSave}
        onBack={onBack}
        saving={saving}
        saveFlash={saveFlash}
      />

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
          <StudioCanvas>
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
      <style>{`@keyframes spin { to { transform: rotate(360deg); } }`}</style>
    </div>
  );
}
