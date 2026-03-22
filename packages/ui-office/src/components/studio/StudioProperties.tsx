/**
 * StudioProperties -- Right panel showing details for the selected instance.
 *
 * Only renders when an instance is selected. Shows prefab metadata,
 * position, rotation with +90 button, grid size, and a delete action.
 */

import { useMemo } from 'react';
import { getBuiltinPrefab } from '@aics/renderer';
import { useStudioStore } from './StudioState.js';

// -- Styles -------------------------------------------------------------------

const PANEL_STYLE: React.CSSProperties = {
  position: 'absolute',
  right: 0,
  top: 48,
  bottom: 48,
  width: 240,
  background: 'rgba(15, 15, 26, 0.95)',
  borderLeft: '1px solid #333',
  display: 'flex',
  flexDirection: 'column',
  overflow: 'hidden',
  fontFamily: 'Inter, system-ui, sans-serif',
  zIndex: 10,
};

const HEADER_STYLE: React.CSSProperties = {
  padding: '10px 14px',
  fontSize: 11,
  fontWeight: 900,
  letterSpacing: 2,
  textTransform: 'uppercase',
  color: '#94a3b8',
  borderBottom: '1px solid #333',
  flexShrink: 0,
};

const SECTION_STYLE: React.CSSProperties = {
  padding: '10px 14px',
  borderBottom: '1px solid rgba(51,51,51,0.6)',
};

const LABEL_STYLE: React.CSSProperties = {
  fontSize: 9,
  fontWeight: 700,
  letterSpacing: 1,
  textTransform: 'uppercase',
  color: '#64748b',
  marginBottom: 4,
};

const VALUE_STYLE: React.CSSProperties = {
  fontSize: 12,
  color: '#e2e8f0',
  fontWeight: 500,
};

const ROW_STYLE: React.CSSProperties = {
  display: 'flex',
  alignItems: 'center',
  gap: 8,
  marginBottom: 2,
};

const SMALL_BTN: React.CSSProperties = {
  padding: '3px 8px',
  background: 'rgba(255,255,255,0.05)',
  border: '1px solid #333',
  borderRadius: 3,
  color: '#ccc',
  fontSize: 10,
  fontWeight: 600,
  cursor: 'pointer',
  fontFamily: 'inherit',
  transition: 'background 0.1s',
};

const DELETE_BTN: React.CSSProperties = {
  ...SMALL_BTN,
  width: '100%',
  textAlign: 'center' as const,
  background: 'rgba(239,68,68,0.15)',
  borderColor: 'rgba(239,68,68,0.3)',
  color: '#fca5a5',
};

// -- Component ----------------------------------------------------------------

export function StudioProperties() {
  const selectedId = useStudioStore((s) => s.selectedInstanceId);
  const instances = useStudioStore((s) => s.instances);
  const rotateSelected = useStudioStore((s) => s.rotateSelected);
  const deleteSelected = useStudioStore((s) => s.deleteSelected);

  const instance = useMemo(
    () => (selectedId ? instances.find((i) => i.id === selectedId) : undefined),
    [selectedId, instances],
  );

  const definition = useMemo(
    () => (instance ? getBuiltinPrefab(instance.prefabId) : undefined),
    [instance?.prefabId],
  );

  // Only show when an instance is selected
  if (!instance || !definition) return null;

  const [x, , z] = instance.position;
  const gridLabel = `${definition.gridSize[0]}\u00D7${definition.gridSize[1]}`;

  return (
    <div style={PANEL_STYLE}>
      <div style={HEADER_STYLE}>Properties</div>

      {/* Name + category */}
      <div style={SECTION_STYLE}>
        <div style={LABEL_STYLE}>Prefab</div>
        <div style={VALUE_STYLE}>{definition.name}</div>
        <div
          style={{
            fontSize: 10,
            color: '#64748b',
            marginTop: 2,
            textTransform: 'capitalize',
          }}
        >
          {definition.category}
        </div>
      </div>

      {/* Position */}
      <div style={SECTION_STYLE}>
        <div style={LABEL_STYLE}>Position</div>
        <div style={ROW_STYLE}>
          <span style={{ fontSize: 10, fontWeight: 700, color: '#f87171' }}>X</span>
          <span style={{ fontSize: 12, fontFamily: 'monospace', color: '#e2e8f0' }}>
            {x.toFixed(1)}
          </span>
          <span style={{ fontSize: 10, fontWeight: 700, color: '#60a5fa', marginLeft: 12 }}>Z</span>
          <span style={{ fontSize: 12, fontFamily: 'monospace', color: '#e2e8f0' }}>
            {z.toFixed(1)}
          </span>
        </div>
      </div>

      {/* Rotation */}
      <div style={SECTION_STYLE}>
        <div style={LABEL_STYLE}>Rotation</div>
        <div style={ROW_STYLE}>
          <span style={{ fontSize: 12, fontFamily: 'monospace', color: '#e2e8f0' }}>
            {instance.rotation}&deg;
          </span>
          <button onClick={rotateSelected} style={SMALL_BTN} title="Rotate +90\u00B0">
            +90&deg;
          </button>
        </div>
      </div>

      {/* Grid size */}
      <div style={SECTION_STYLE}>
        <div style={LABEL_STYLE}>Grid Size</div>
        <div style={VALUE_STYLE}>{gridLabel}</div>
      </div>

      {/* Spacer */}
      <div style={{ flex: 1 }} />

      {/* Delete */}
      <div style={{ padding: '10px 14px' }}>
        <button onClick={deleteSelected} style={DELETE_BTN}>
          Delete Instance
        </button>
      </div>
    </div>
  );
}
