/**
 * StudioProperties -- Right panel showing details for the selected instance or zone.
 *
 * Always visible. When nothing is selected, shows an empty state message.
 * When an instance is selected: prefab metadata, position, rotation, grid size, delete.
 * When a zone is selected: zone name, archetype, size, position, furniture count, variant, delete.
 */

import { getAllBuiltinPrefabs, getBuiltinPrefab } from '@offisim/renderer';
import type { PrefabDefinition } from '@offisim/shared-types';

// Module-level constant — built-in prefabs never change at runtime
const ALL_PREFABS_MAP: Map<string, PrefabDefinition> = new Map(
  getAllBuiltinPrefabs().map((p) => [p.prefabId, p]),
);
import type { ZonePreset } from '@offisim/shared-types';
import {
  UNASSIGNED_ZONE_ID,
  getPresetsForArchetype,
  isRequiredArchetype,
} from '@offisim/shared-types';
import { BoxSelect, Lock, MapPin, RotateCw, Trash2 } from 'lucide-react';
import { useMemo } from 'react';
import { useStudioStore } from './StudioState.js';
import {
  FONT,
  LAYOUT,
  SP,
  STUDIO_COLORS,
  labelStyle,
  panelStyle,
  sectionHeaderStyle,
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

const DELETE_BTN_DISABLED: React.CSSProperties = {
  ...SMALL_BTN,
  width: '100%',
  justifyContent: 'center',
  background: 'transparent',
  borderColor: STUDIO_COLORS.border,
  color: STUDIO_COLORS.textDisabled,
  cursor: 'default',
};

// -- Component ----------------------------------------------------------------

export function StudioProperties() {
  // Zone selection
  const selectedZoneId = useStudioStore((s) => s.selectedZoneId);
  const updateZoneLabel = useStudioStore((s) => s.updateZoneLabel);
  const deleteZone = useStudioStore((s) => s.deleteZone);
  const swapZoneVariant = useStudioStore((s) => s.swapZoneVariant);

  // Instance selection
  const selectedId = useStudioStore((s) => s.selectedInstanceId);
  const rotateSelected = useStudioStore((s) => s.rotateSelected);
  const deleteSelected = useStudioStore((s) => s.deleteSelected);

  // Shared state
  const instances = useStudioStore((s) => s.instances);
  const zones = useStudioStore((s) => s.zones);

  // Resolve selected zone
  const selectedZone = useMemo(
    () => (selectedZoneId ? zones.find((z) => z.zoneId === selectedZoneId) : undefined),
    [selectedZoneId, zones],
  );

  // Resolve selected instance
  const instance = useMemo(
    () => (selectedId ? instances.find((i) => i.id === selectedId) : undefined),
    [selectedId, instances],
  );

  const definition = useMemo(
    () => (instance ? getBuiltinPrefab(instance.prefabId) : undefined),
    [instance],
  );

  const instanceZone = useMemo(
    () => (instance ? zones.find((z) => z.zoneId === instance.zoneId) : undefined),
    [instance, zones],
  );

  const allPrefabsMap = ALL_PREFABS_MAP;

  const showZone = Boolean(selectedZoneId && selectedZone);
  const showInstance = Boolean(!showZone && instance && definition);
  const showEmpty = !showZone && !showInstance;

  return (
    <div style={panelStyle('right')}>
      <div style={sectionHeaderStyle()}>Properties</div>

      {/* Empty state */}
      {showEmpty && (
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

      {/* Selected zone details */}
      {showZone &&
        selectedZone &&
        (() => {
          const zoneFurnitureCount = instances.filter(
            (i) => i.zoneId === selectedZone.zoneId,
          ).length;
          const presets = selectedZone.archetype
            ? getPresetsForArchetype(selectedZone.archetype)
            : [];
          const required = isRequiredArchetype(selectedZone.archetype);

          return (
            <>
              {/* Zone name (editable) */}
              <div style={SECTION_STYLE}>
                <div style={labelStyle()}>Name</div>
                <input
                  type="text"
                  value={selectedZone.label}
                  onChange={(e) => updateZoneLabel(selectedZone.zoneId, e.target.value)}
                  aria-label="Zone name"
                  style={{
                    width: '100%',
                    boxSizing: 'border-box',
                    background: STUDIO_COLORS.surface1,
                    border: `1px solid ${STUDIO_COLORS.border}`,
                    borderRadius: LAYOUT.buttonRadius,
                    color: STUDIO_COLORS.textPrimary,
                    fontSize: FONT.md,
                    fontFamily: FONT.family,
                    padding: `${SP.xs}px ${SP.sm}px`,
                    outline: 'none',
                  }}
                />
              </div>

              {/* Archetype */}
              <div style={SECTION_STYLE}>
                <div style={labelStyle()}>Archetype</div>
                <div style={ROW_STYLE}>
                  <span
                    style={{
                      display: 'inline-block',
                      width: 8,
                      height: 8,
                      borderRadius: '50%',
                      background: selectedZone.accentColor,
                      flexShrink: 0,
                    }}
                  />
                  <span
                    style={{
                      ...valueStyle(),
                      textTransform: 'capitalize',
                    }}
                  >
                    {selectedZone.archetype ?? 'Custom'}
                  </span>
                </div>
              </div>

              {/* Size */}
              <div style={SECTION_STYLE}>
                <div style={labelStyle()}>Size</div>
                <div style={{ ...valueStyle() }}>
                  {selectedZone.w} &times; {selectedZone.d}
                </div>
              </div>

              {/* Position */}
              <div style={SECTION_STYLE}>
                <div style={labelStyle()}>Position</div>
                <div style={ROW_STYLE}>
                  <span
                    style={{ fontSize: FONT.sm, fontWeight: FONT.bold, color: STUDIO_COLORS.error }}
                  >
                    X
                  </span>
                  <span style={{ ...valueStyle() }}>{selectedZone.cx.toFixed(1)}</span>
                  <span
                    style={{
                      fontSize: FONT.sm,
                      fontWeight: FONT.bold,
                      color: STUDIO_COLORS.catWorkspace,
                      marginLeft: SP.md,
                    }}
                  >
                    Z
                  </span>
                  <span style={{ ...valueStyle() }}>{selectedZone.cz.toFixed(1)}</span>
                </div>
              </div>

              {/* Furniture count */}
              <div style={SECTION_STYLE}>
                <div style={labelStyle()}>Furniture</div>
                <div style={{ ...valueStyle() }}>{zoneFurnitureCount}</div>
              </div>

              {/* Desk slots (only if > 0) */}
              {selectedZone.deskSlots > 0 && (
                <div style={SECTION_STYLE}>
                  <div style={labelStyle()}>Desk Slots</div>
                  <div style={{ ...valueStyle() }}>{selectedZone.deskSlots}</div>
                </div>
              )}

              {/* Variant selector (only if archetype has multiple presets) */}
              {presets.length > 1 && (
                <div style={SECTION_STYLE}>
                  <div style={labelStyle()}>Variant</div>
                  <select
                    aria-label="Zone variant"
                    onChange={(e) => {
                      const preset = presets.find((p) => p.id === e.target.value) as
                        | ZonePreset
                        | undefined;
                      if (preset) swapZoneVariant(selectedZone.zoneId, preset, allPrefabsMap);
                    }}
                    style={{
                      width: '100%',
                      boxSizing: 'border-box',
                      background: STUDIO_COLORS.surface1,
                      border: `1px solid ${STUDIO_COLORS.border}`,
                      borderRadius: LAYOUT.buttonRadius,
                      color: STUDIO_COLORS.textPrimary,
                      fontSize: FONT.md,
                      fontFamily: FONT.family,
                      padding: `${SP.xs}px ${SP.sm}px`,
                      outline: 'none',
                      cursor: 'pointer',
                    }}
                  >
                    {presets.map((p) => (
                      <option key={p.id} value={p.id}>
                        {p.label}
                      </option>
                    ))}
                  </select>
                </div>
              )}

              {/* Spacer */}
              <div style={{ flex: 1 }} />

              {/* Delete zone */}
              <div style={{ padding: `${SP.md}px ${SP.lg}px` }}>
                {required ? (
                  <button
                    type="button"
                    disabled
                    aria-label="Cannot delete required zone"
                    style={DELETE_BTN_DISABLED}
                  >
                    <Lock size={12} />
                    <span>Required — Cannot Delete</span>
                  </button>
                ) : (
                  <button
                    type="button"
                    onClick={() => deleteZone(selectedZone.zoneId)}
                    aria-label="Delete zone"
                    style={DELETE_BTN}
                  >
                    <Trash2 size={12} />
                    <span>Delete Zone</span>
                  </button>
                )}
              </div>
            </>
          );
        })()}

      {/* Selected instance details */}
      {showInstance &&
        instance &&
        definition &&
        (() => {
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
                  <span
                    style={{ fontSize: FONT.sm, fontWeight: FONT.bold, color: STUDIO_COLORS.error }}
                  >
                    X
                  </span>
                  <span style={{ ...valueStyle() }}>{x.toFixed(1)}</span>
                  <span
                    style={{
                      fontSize: FONT.sm,
                      fontWeight: FONT.bold,
                      color: STUDIO_COLORS.catWorkspace,
                      marginLeft: SP.md,
                    }}
                  >
                    Z
                  </span>
                  <span style={{ ...valueStyle() }}>{z.toFixed(1)}</span>
                </div>
              </div>

              {/* Rotation */}
              <div style={SECTION_STYLE}>
                <div style={labelStyle()}>Rotation</div>
                <div style={ROW_STYLE}>
                  <span style={{ ...valueStyle() }}>{instance.rotation}&deg;</span>
                  <button
                    type="button"
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

              {/* Zone */}
              <div style={SECTION_STYLE}>
                <div style={labelStyle()}>Zone</div>
                <div style={ROW_STYLE}>
                  <MapPin
                    size={12}
                    style={{
                      color: instanceZone?.accentColor ?? STUDIO_COLORS.textTertiary,
                      flexShrink: 0,
                    }}
                  />
                  {instanceZone ? (
                    <>
                      <span
                        style={{
                          display: 'inline-block',
                          width: 8,
                          height: 8,
                          borderRadius: 2,
                          background: instanceZone.accentColor,
                          flexShrink: 0,
                        }}
                      />
                      <span style={{ ...valueStyle() }}>{instanceZone.label}</span>
                    </>
                  ) : (
                    <span
                      style={{
                        fontSize: FONT.sm,
                        color: STUDIO_COLORS.textTertiary,
                        fontStyle: 'italic',
                      }}
                    >
                      {instance.zoneId === UNASSIGNED_ZONE_ID ? 'Unassigned' : instance.zoneId}
                    </span>
                  )}
                </div>
              </div>

              {/* Spacer */}
              <div style={{ flex: 1 }} />

              {/* Delete */}
              <div style={{ padding: `${SP.md}px ${SP.lg}px` }}>
                <button
                  type="button"
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
