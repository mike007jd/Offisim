/**
 * StudioProperties -- Right panel showing details for the selected instance or zone.
 *
 * Always visible. When nothing is selected, shows an empty state message.
 * When an instance is selected: prefab metadata, position, rotation, grid size, delete.
 * When a zone is selected: zone name, archetype, size, position, furniture count, variant, delete.
 */

import { getAllBuiltinPrefabs, getBuiltinPrefab } from '@offisim/renderer';
import type { PrefabDefinition } from '@offisim/shared-types';
import {
  Button,
  Input,
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@offisim/ui-core';

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
import { useStudioHierarchyLevel, useStudioStore } from './StudioState.js';

// -- Component ----------------------------------------------------------------

const TOOL_HINTS: Record<string, { label: string; hint: string }> = {
  select: {
    label: 'Select',
    hint: 'Click a zone or placed object to edit its properties.',
  },
  place: {
    label: 'Place',
    hint: 'Choose a prefab from the left palette, then click in the scene to place it.',
  },
  zone: {
    label: 'Zone',
    hint: 'Choose a zone preset from the palette, then drag in the scene to outline it.',
  },
  move: {
    label: 'Move',
    hint: 'Drag a placed object to relocate it within its zone.',
  },
};

const DEFAULT_TOOL_HINT = {
  label: 'Select',
  hint: 'Click a zone or placed object to edit its properties.',
};

function StudioPropertiesEmptyState() {
  const tool = useStudioStore((s) => s.tool);
  const focusedZoneId = useStudioStore((s) => s.focusedZoneId);
  const isEditingZone = useStudioStore((s) => s.isEditingZone);
  const hint = TOOL_HINTS[tool] ?? DEFAULT_TOOL_HINT;

  return (
    <div className="studio-properties-empty">
      <BoxSelect data-icon="empty" aria-hidden="true" />
      <div data-slot="title">Nothing selected</div>
      <div data-slot="hint">{hint.hint}</div>
      <div data-slot="meta">
        <span>
          Current tool: <strong>{hint.label}</strong>
        </span>
        {focusedZoneId && (
          <span>
            Focused zone:{' '}
            <strong>{focusedZoneId === UNASSIGNED_ZONE_ID ? 'Unassigned' : focusedZoneId}</strong>
          </span>
        )}
        {isEditingZone && <span>Editing zone — press Escape to exit edit mode.</span>}
      </div>
    </div>
  );
}

export function StudioProperties() {
  // Hierarchy anchor
  const level = useStudioHierarchyLevel();
  const plotSize = useStudioStore((s) => s.plotSize);
  const isEditingZone = useStudioStore((s) => s.isEditingZone);

  // Zone selection
  const selectedZoneId = useStudioStore((s) => s.selectedZoneId);
  const updateZoneLabel = useStudioStore((s) => s.updateZoneLabel);
  const deleteZone = useStudioStore((s) => s.deleteZone);
  const rotateZone = useStudioStore((s) => s.rotateZone);
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

  let anchorText = `Plot · ${plotSize.name}`;
  if (level === 'asset' && instance && definition) {
    anchorText = `Asset · ${definition.name}`;
  } else if (level === 'asset' && isEditingZone && selectedZone) {
    anchorText = `Zone · ${selectedZone.label} · editing`;
  } else if (level === 'zone' && selectedZone) {
    anchorText = `Zone · ${selectedZone.label}`;
  }

  return (
    <div className="studio-properties-panel">
      <div className="studio-properties-title">Properties</div>

      {/* Hierarchy anchor row */}
      <div className="studio-properties-anchor">{anchorText}</div>

      {/* Empty state */}
      {showEmpty && <StudioPropertiesEmptyState />}

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
          const selectedPreset = presets.find(
            (preset) =>
              preset.label === selectedZone.label &&
              preset.w === selectedZone.w &&
              preset.d === selectedZone.d,
          );
          const required = isRequiredArchetype(selectedZone.archetype);

          return (
            <>
              {/* Zone name (editable) */}
              <div className="studio-properties-section">
                <div data-slot="label">Name</div>
                <Input
                  type="text"
                  value={selectedZone.label}
                  onChange={(e) => updateZoneLabel(selectedZone.zoneId, e.target.value)}
                  aria-label="Zone name"
                  className="studio-properties-input"
                />
              </div>

              {/* Archetype */}
              <div className="studio-properties-section">
                <div data-slot="label">Archetype</div>
                <div className="studio-properties-row">
                  <svg data-swatch="round" viewBox="0 0 8 8" aria-hidden="true">
                    <circle cx="4" cy="4" r="4" fill={selectedZone.accentColor} />
                  </svg>
                  <span data-slot="value" data-transform="capitalize">
                    {selectedZone.archetype ?? 'Custom'}
                  </span>
                </div>
              </div>

              {/* Size */}
              <div className="studio-properties-section">
                <div data-slot="label">Size</div>
                <div data-slot="value">
                  {selectedZone.w} &times; {selectedZone.d}
                </div>
              </div>

              {/* Position */}
              <div className="studio-properties-section">
                <div data-slot="label">Position</div>
                <div className="studio-properties-row">
                  <span data-axis="x">X</span>
                  <span data-slot="value">{selectedZone.cx.toFixed(1)}</span>
                  <span data-axis="z">Z</span>
                  <span data-slot="value">{selectedZone.cz.toFixed(1)}</span>
                </div>
              </div>

              {/* Furniture count */}
              <div className="studio-properties-section">
                <div data-slot="label">Furniture</div>
                <div data-slot="value">{zoneFurnitureCount}</div>
              </div>

              {/* Desk slots (only if > 0) */}
              {selectedZone.deskSlots > 0 && (
                <div className="studio-properties-section">
                  <div data-slot="label">Desk Slots</div>
                  <div data-slot="value">{selectedZone.deskSlots}</div>
                </div>
              )}

              {/* Variant selector (only if archetype has multiple presets) */}
              {presets.length > 1 && (
                <div className="studio-properties-section">
                  <div data-slot="label">Variant</div>
                  <Select
                    value={selectedPreset?.id}
                    onValueChange={(value) => {
                      const preset = presets.find((p) => p.id === value) as ZonePreset | undefined;
                      if (preset) swapZoneVariant(selectedZone.zoneId, preset, allPrefabsMap);
                    }}
                  >
                    <SelectTrigger aria-label="Zone variant" className="studio-properties-select">
                      <SelectValue placeholder="Choose variant" />
                    </SelectTrigger>
                    <SelectContent>
                      {presets.map((p) => (
                        <SelectItem key={p.id} value={p.id}>
                          {p.label}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
              )}

              {/* Rotate zone */}
              <div className="studio-properties-action">
                <Button
                  type="button"
                  variant="secondary"
                  size="sm"
                  onClick={() => rotateZone(selectedZone.zoneId)}
                  aria-label="Rotate zone 90° clockwise (R)"
                  className="studio-properties-action-button"
                >
                  <RotateCw data-icon="inline-start" aria-hidden="true" />
                  <span>Rotate +90°</span>
                  <kbd className="studio-properties-keycap">R</kbd>
                </Button>
              </div>

              {/* Spacer */}
              <div className="studio-properties-spacer" />

              {/* Delete zone */}
              <div className="studio-properties-footer">
                {required ? (
                  <Button
                    type="button"
                    variant="outline"
                    disabled
                    aria-label="Cannot delete required zone"
                    className="studio-properties-action-button"
                  >
                    <Lock data-icon="inline-start" aria-hidden="true" />
                    <span>Required — Cannot Delete</span>
                  </Button>
                ) : (
                  <Button
                    type="button"
                    variant="destructive"
                    onClick={() => deleteZone(selectedZone.zoneId)}
                    aria-label="Delete zone"
                    className="studio-properties-action-button"
                  >
                    <Trash2 data-icon="inline-start" aria-hidden="true" />
                    <span>Delete Zone</span>
                  </Button>
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
              <div className="studio-properties-section">
                <div data-slot="label">Prefab</div>
                <div data-slot="value">{definition.name}</div>
                <div data-slot="muted" data-transform="capitalize">
                  {definition.category}
                </div>
              </div>

              {/* Position */}
              <div className="studio-properties-section">
                <div data-slot="label">Position</div>
                <div className="studio-properties-row">
                  <span data-axis="x">X</span>
                  <span data-slot="value">{x.toFixed(1)}</span>
                  <span data-axis="z">Z</span>
                  <span data-slot="value">{z.toFixed(1)}</span>
                </div>
              </div>

              {/* Rotation */}
              <div className="studio-properties-section">
                <div data-slot="label">Rotation</div>
                <div className="studio-properties-row">
                  <span data-slot="value">{instance.rotation}&deg;</span>
                  <Button
                    type="button"
                    variant="secondary"
                    size="sm"
                    onClick={rotateSelected}
                    aria-label="Rotate 90 degrees clockwise"
                    title="Rotate +90\u00B0"
                    className="studio-properties-inline-action"
                  >
                    <RotateCw data-icon="inline-start" aria-hidden="true" />
                    <span>+90\u00B0</span>
                  </Button>
                </div>
              </div>

              {/* Grid size */}
              <div className="studio-properties-section">
                <div data-slot="label">Grid Size</div>
                <div data-slot="value">{gridLabel}</div>
              </div>

              {/* Zone */}
              <div className="studio-properties-section">
                <div data-slot="label">Zone</div>
                <div className="studio-properties-row">
                  <MapPin data-icon="inline-start" aria-hidden="true" />
                  {instanceZone ? (
                    <>
                      <svg data-swatch="square" viewBox="0 0 8 8" aria-hidden="true">
                        <rect width="8" height="8" rx="2" fill={instanceZone.accentColor} />
                      </svg>
                      <span data-slot="value">{instanceZone.label}</span>
                    </>
                  ) : (
                    <span data-slot="muted" data-style="italic">
                      {instance.zoneId === UNASSIGNED_ZONE_ID ? 'Unassigned' : instance.zoneId}
                    </span>
                  )}
                </div>
              </div>

              {/* Spacer */}
              <div className="studio-properties-spacer" />

              {/* Delete */}
              <div className="studio-properties-footer">
                <Button
                  type="button"
                  variant="destructive"
                  onClick={deleteSelected}
                  aria-label="Delete selected instance"
                  className="studio-properties-action-button"
                >
                  <Trash2 data-icon="inline-start" aria-hidden="true" />
                  <span>Delete Instance</span>
                </Button>
              </div>
            </>
          );
        })()}
    </div>
  );
}
