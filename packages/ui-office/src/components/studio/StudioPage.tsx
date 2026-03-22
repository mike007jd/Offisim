/**
 * StudioPage -- Full-screen wrapper for Offisim Studio.
 *
 * Composes all Studio sub-components, handles keyboard shortcuts not covered
 * by StudioToolbar (rotate, delete, escape, Ctrl+S), and manages save flow
 * (create or edit) via RuntimeRepositories.
 */

import { useCallback, useEffect, useState } from 'react';
import { useStudioStore } from './StudioState.js';
import { StudioCanvas } from './StudioCanvas.js';
import { StudioToolbar } from './StudioToolbar.js';
import { StudioPalette } from './StudioPalette.js';
import { StudioGhost } from './StudioGhost.js';
import { StudioPlacedPrefabs } from './StudioPlacedPrefabs.js';
import type { RuntimeRepositories } from '@aics/core/browser';
import type { PrefabInstanceRow } from '@aics/shared-types';

// ── Props ────────────────────────────────────────────────────────

export interface StudioPageProps {
  mode: 'create' | 'edit';
  companyId?: string; // required for edit mode
  repos: RuntimeRepositories | null;
  onBack: () => void;
  onCompanyCreated?: (companyId: string) => void;
}

// ── Styles ───────────────────────────────────────────────────────

const ROOT_STYLE: React.CSSProperties = {
  position: 'fixed',
  inset: 0,
  background: '#111',
  fontFamily: 'Inter, system-ui, sans-serif',
  zIndex: 50, // above normal office UI
};

const CANVAS_CONTAINER: React.CSSProperties = {
  position: 'absolute',
  top: 48,
  left: 220,
  right: 0,
  bottom: 48,
};

const BOTTOM_BAR: React.CSSProperties = {
  position: 'absolute',
  bottom: 0,
  left: 0,
  right: 0,
  height: 48,
  background: 'rgba(15, 15, 26, 0.95)',
  borderTop: '1px solid #333',
  display: 'flex',
  alignItems: 'center',
  padding: '0 14px',
  gap: 8,
  zIndex: 10,
};

// ── Component ────────────────────────────────────────────────────

export function StudioPage({
  mode,
  companyId,
  repos,
  onBack,
  onCompanyCreated,
}: StudioPageProps) {
  const [saving, setSaving] = useState(false);

  // ── Load existing data (edit mode) ───────────────────────────

  useEffect(() => {
    if (mode === 'edit' && companyId && repos) {
      repos.prefabInstances.findByCompany(companyId).then((rows) => {
        const instances = rows.map((r) => ({
          id: r.instance_id,
          prefabId: r.prefab_id,
          position: [r.position_x, 0, r.position_y] as [number, number, number],
          rotation: r.rotation,
          zoneId: r.zone_id,
        }));
        useStudioStore.getState().setInstances(instances);
      });
    } else {
      useStudioStore.getState().setInstances([]);
    }
  }, [mode, companyId, repos]);

  // ── Save flow ────────────────────────────────────────────────

  const handleSave = useCallback(async () => {
    if (!repos) return;
    setSaving(true);
    try {
      const state = useStudioStore.getState();
      let targetCompanyId = companyId;

      if (mode === 'create') {
        const name = window.prompt('Company name:', 'My Company');
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

      if (mode === 'create' && targetCompanyId && onCompanyCreated) {
        onCompanyCreated(targetCompanyId);
      } else {
        onBack();
      }
    } finally {
      setSaving(false);
    }
  }, [repos, companyId, mode, onBack, onCompanyCreated]);

  // ── Keyboard shortcuts (non-tool shortcuts) ──────────────────
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

  // ── Plot selector state (bottom bar) ─────────────────────────

  const plotSize = useStudioStore((s) => s.plotSize);

  // ── Render ───────────────────────────────────────────────────

  return (
    <div style={ROOT_STYLE}>
      {/* Top toolbar: tools, grid toggle, save, back */}
      <StudioToolbar onSave={handleSave} onBack={onBack} saving={saving} />

      {/* Left palette: prefab catalog */}
      <StudioPalette />

      {/* 3D canvas area */}
      <div style={CANVAS_CONTAINER}>
        <StudioCanvas>
          <StudioPlacedPrefabs />
          <StudioGhost />
        </StudioCanvas>
      </div>

      {/* Bottom bar: plot size display (StudioPlotSelector placeholder) */}
      <div style={BOTTOM_BAR}>
        <span
          style={{
            fontSize: 11,
            color: '#94a3b8',
            fontWeight: 600,
          }}
        >
          {plotSize.name}
        </span>
        <span
          style={{
            fontSize: 10,
            fontFamily: 'monospace',
            color: '#64748b',
          }}
        >
          {plotSize.width} x {plotSize.depth}
        </span>
      </div>
    </div>
  );
}
