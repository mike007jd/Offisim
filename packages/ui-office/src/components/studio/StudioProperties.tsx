/**
 * StudioProperties -- Right panel showing details for the selected instance.
 *
 * Always visible. When nothing is selected, shows an empty state message.
 * When an instance is selected: prefab metadata, position, rotation, grid size, delete.
 */

import { useMemo } from 'react';
import { RotateCw, Trash2, BoxSelect } from 'lucide-react';
import { getBuiltinPrefab } from '@aics/renderer';
import { useStudioStore } from './StudioState.js';
import {
  STUDIO_COLORS,
  SP,
  FONT,
  LAYOUT,
  panelStyle,
  sectionHeaderStyle,
  labelStyle,
  valueStyle,
} from './studio-tokens.js';

// -- Styles -------------------------------------------------------------------

const SECTION_STYLE: React.CSSProperties = {
  padding: `${SP.md}px ${SP.lg}px`,
  borderBottom: `1px solid ${STUDIO_COLORS.borderSubtle}`,
};

const ROW_STYLE: React.CSSProperties = {
  display: 'flex',
  alignItems: 'center',
  gap: SP.sm,
  marginBottom: SP.xs / 2,
};

const SMALL_BTN: React.CSSProperties = {
  display: 'flex',
  alignItems: 'center',
  gap: SP.xs,
  padding: `${SP.xs}px ${SP.sm}px`,
  background: STUDIO_COLORS.surface2,
  border: `1px solid ${STUDIO_COLORS.border}`,
  borderRadius: LAYOUT.buttonRadius,
  color: STUDIO_COLORS.textSecondary,
  fontSize: FONT.sm,
  fontWeight: FONT.semibold,
  cursor: 'pointer',
  fontFamily: FONT.family,
  transition: 'background 0.1s',
};

const DELETE_BTN: React.CSSProperties = {
  ...SMALL_BTN,
  width: '100%',
  justifyContent: 'center',
  background: STUDIO_COLORS.errorMuted,
  borderColor: STUDIO_COLORS.errorMuted,
  color: STUDIO_COLORS.error,
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

  return (
    <div style={panelStyle('right')}>
      <div style={sectionHeaderStyle()}>Properties</div>

      {/* Empty state */}
      {(!instance || !definition) && (
        <div
          style={{
            flex: 1,
            display: 'flex',
            flexDirection: 'column',
            alignItems: 'center',
            justifyContent: 'center',
            gap: SP.md,
            padding: SP.xl,
          }}
        >
          <BoxSelect size={32} style={{ color: STUDIO_COLORS.textDisabled }} />
          <span
            style={{
              fontSize: FONT.base,
              color: STUDIO_COLORS.textTertiary,
              textAlign: 'center',
              lineHeight: 1.4,
            }}
          >
            Select an object to view properties
          </span>
        </div>
      )}

      {/* Selected instance details */}
      {instance && definition && (() => {
        const [x, , z] = instance.position;
        const gridLabel = `${definition.gridSize[0]}\u00D7${definition.gridSize[1]}`;

        return (
          <>
            {/* Name + category */}
            <div style={SECTION_STYLE}>
              <div style={labelStyle()}>Prefab</div>
              <div style={valueStyle()}>{definition.name}</div>
              <div
                style={{
                  fontSize: FONT.sm,
                  color: STUDIO_COLORS.textTertiary,
                  marginTop: SP.xs / 2,
                  textTransform: 'capitalize',
                }}
              >
                {definition.category}
              </div>
            </div>

            {/* Position */}
            <div style={SECTION_STYLE}>
              <div style={labelStyle()}>Position</div>
              <div style={ROW_STYLE}>
                <span style={{ fontSize: FONT.sm, fontWeight: FONT.bold, color: STUDIO_COLORS.error }}>X</span>
                <span style={{ ...valueStyle() }}>
                  {x.toFixed(1)}
                </span>
                <span style={{ fontSize: FONT.sm, fontWeight: FONT.bold, color: STUDIO_COLORS.catWorkspace, marginLeft: SP.md }}>Z</span>
                <span style={{ ...valueStyle() }}>
                  {z.toFixed(1)}
                </span>
              </div>
            </div>

            {/* Rotation */}
            <div style={SECTION_STYLE}>
              <div style={labelStyle()}>Rotation</div>
              <div style={ROW_STYLE}>
                <span style={{ ...valueStyle() }}>
                  {instance.rotation}&deg;
                </span>
                <button
                  onClick={rotateSelected}
                  aria-label="Rotate 90 degrees clockwise"
                  title="Rotate +90\u00B0"
                  style={SMALL_BTN}
                >
                  <RotateCw size={12} />
                  <span>+90\u00B0</span>
                </button>
              </div>
            </div>

            {/* Grid size */}
            <div style={SECTION_STYLE}>
              <div style={labelStyle()}>Grid Size</div>
              <div style={valueStyle()}>{gridLabel}</div>
            </div>

            {/* Spacer */}
            <div style={{ flex: 1 }} />

            {/* Delete */}
            <div style={{ padding: `${SP.md}px ${SP.lg}px` }}>
              <button
                onClick={deleteSelected}
                aria-label="Delete selected instance"
                style={DELETE_BTN}
              >
                <Trash2 size={12} />
                <span>Delete Instance</span>
              </button>
            </div>
          </>
        );
      })()}
    </div>
  );
}
