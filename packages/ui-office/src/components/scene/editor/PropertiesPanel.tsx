/**
 * PropertiesPanel — Right-side floating panel for selected prefab details.
 *
 * Shows the selected prefab's name, category, position, rotation,
 * binding slots, and a delete button. Only visible when a prefab is
 * selected in edit mode.
 */

import { useMemo } from 'react';
import { getBuiltinPrefab } from '@aics/renderer';
import type { PrefabBindingSlotDef } from '@aics/shared-types';
import { useEditor } from './EditorMode.js';

// ── Styles ───────────────────────────────────────────────────────

const PANEL_STYLE: React.CSSProperties = {
  position: 'absolute',
  right: 12,
  top: 52,
  width: 210,
  background: 'rgba(15, 23, 42, 0.92)',
  backdropFilter: 'blur(12px)',
  border: '1px solid rgba(51, 65, 85, 0.5)',
  borderRadius: 12,
  fontFamily: 'Inter, system-ui, sans-serif',
  zIndex: 20,
  overflow: 'hidden',
};

const SECTION_STYLE: React.CSSProperties = {
  padding: '8px 12px',
  borderBottom: '1px solid rgba(51, 65, 85, 0.3)',
};

const LABEL_STYLE: React.CSSProperties = {
  fontSize: 9,
  fontWeight: 700,
  letterSpacing: 1.5,
  textTransform: 'uppercase',
  color: '#64748b',
  marginBottom: 4,
};

const VALUE_STYLE: React.CSSProperties = {
  fontSize: 11,
  color: '#e2e8f0',
  fontFamily: 'monospace',
};

const ROW_STYLE: React.CSSProperties = {
  display: 'flex',
  justifyContent: 'space-between',
  alignItems: 'center',
  gap: 8,
  marginBottom: 3,
};

// ── Category colors ──────────────────────────────────────────────

const CATEGORY_COLORS: Record<string, string> = {
  workspace: '#3b82f6',
  compute: '#f97316',
  knowledge: '#a855f7',
  collaboration: '#22c55e',
  infrastructure: '#06b6d4',
  decorative: '#10b981',
};

// ── Component ────────────────────────────────────────────────────

export function PropertiesPanel() {
  const {
    selectedInstanceId,
    placedPrefabs,
    deleteSelected,
    updateRotation,
  } = useEditor();

  const instance = useMemo(
    () => placedPrefabs.find((p) => p.id === selectedInstanceId),
    [placedPrefabs, selectedInstanceId],
  );

  const definition = useMemo(
    () => (instance ? getBuiltinPrefab(instance.prefabId) : null),
    [instance],
  );

  if (!instance || !definition) return null;

  const catColor = CATEGORY_COLORS[definition.category] ?? '#64748b';
  const pos = instance.position;

  const handleRotate = () => {
    const next = ((instance.rotation + 90) % 360);
    updateRotation(instance.id, next);
  };

  return (
    <div style={PANEL_STYLE}>
      {/* Header */}
      <div style={{
        ...SECTION_STYLE,
        display: 'flex',
        alignItems: 'center',
        gap: 8,
      }}>
        <div style={{
          width: 8,
          height: 8,
          borderRadius: '50%',
          background: catColor,
          flexShrink: 0,
        }} />
        <div style={{ flex: 1, minWidth: 0 }}>
          <div style={{
            fontSize: 12,
            fontWeight: 700,
            color: '#f1f5f9',
            whiteSpace: 'nowrap',
            overflow: 'hidden',
            textOverflow: 'ellipsis',
          }}>
            {definition.name}
          </div>
          <div style={{
            fontSize: 9,
            color: catColor,
            textTransform: 'uppercase',
            fontWeight: 600,
            letterSpacing: 1,
          }}>
            {definition.category}
          </div>
        </div>
      </div>

      {/* Grid size */}
      <div style={SECTION_STYLE}>
        <div style={LABEL_STYLE}>Grid Size</div>
        <div style={VALUE_STYLE}>
          {definition.gridSize[0]} x {definition.gridSize[1]}
        </div>
      </div>

      {/* Position */}
      <div style={SECTION_STYLE}>
        <div style={LABEL_STYLE}>Position</div>
        <div style={ROW_STYLE}>
          <span style={{ ...VALUE_STYLE, color: '#f87171' }}>
            X {pos[0].toFixed(1)}
          </span>
          <span style={{ ...VALUE_STYLE, color: '#4ade80' }}>
            Y {pos[1].toFixed(1)}
          </span>
          <span style={{ ...VALUE_STYLE, color: '#60a5fa' }}>
            Z {pos[2].toFixed(1)}
          </span>
        </div>
      </div>

      {/* Rotation */}
      <div style={SECTION_STYLE}>
        <div style={LABEL_STYLE}>Rotation</div>
        <div style={ROW_STYLE}>
          <span style={VALUE_STYLE}>{instance.rotation}deg</span>
          <button
            onClick={handleRotate}
            style={{
              background: 'rgba(51, 65, 85, 0.5)',
              border: '1px solid rgba(71, 85, 105, 0.5)',
              borderRadius: 6,
              padding: '2px 8px',
              fontSize: 10,
              color: '#94a3b8',
              cursor: 'pointer',
              fontFamily: 'inherit',
            }}
          >
            Rotate 90
          </button>
        </div>
      </div>

      {/* Binding slots */}
      {definition.bindingSlots.length > 0 && (
        <div style={SECTION_STYLE}>
          <div style={LABEL_STYLE}>Binding Slots</div>
          {definition.bindingSlots.map((slot: PrefabBindingSlotDef) => (
            <div
              key={slot.name}
              style={{
                ...ROW_STYLE,
                fontSize: 10,
                color: '#94a3b8',
              }}
            >
              <span style={{ fontFamily: 'monospace' }}>{slot.name}</span>
              <span style={{
                fontSize: 8,
                padding: '1px 4px',
                borderRadius: 3,
                background: slot.required
                  ? 'rgba(239, 68, 68, 0.15)'
                  : 'rgba(71, 85, 105, 0.3)',
                color: slot.required ? '#fca5a5' : '#64748b',
              }}>
                {slot.required ? 'required' : 'optional'}
              </span>
            </div>
          ))}
        </div>
      )}

      {/* Description */}
      <div style={SECTION_STYLE}>
        <div style={LABEL_STYLE}>Description</div>
        <div style={{
          fontSize: 10,
          color: '#94a3b8',
          lineHeight: 1.4,
        }}>
          {definition.description}
        </div>
      </div>

      {/* Actions */}
      <div style={{
        padding: '8px 12px',
        display: 'flex',
        gap: 6,
      }}>
        <button
          onClick={deleteSelected}
          style={{
            flex: 1,
            background: 'rgba(239, 68, 68, 0.15)',
            border: '1px solid rgba(239, 68, 68, 0.3)',
            borderRadius: 6,
            padding: '5px 0',
            fontSize: 10,
            fontWeight: 600,
            color: '#fca5a5',
            cursor: 'pointer',
            fontFamily: 'inherit',
            transition: 'background 0.1s',
          }}
        >
          Delete
        </button>
      </div>
    </div>
  );
}
