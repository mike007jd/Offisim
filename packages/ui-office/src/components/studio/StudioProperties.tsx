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

// -- Styles -------------------------------------------------------------------

const SECTION_CLASS = 'border-b border-line-soft px-sp-4 py-sp-3';
const LABEL_CLASS = 'mb-sp-1 text-fs-micro font-semibold uppercase tracking-ls-caps text-ink-3';
const VALUE_CLASS = 'font-mono text-fs-sm text-ink-1';
const ROW_CLASS = 'mb-sp-1 flex items-center gap-sp-2';
const AXIS_CLASS = 'text-fs-micro font-bold';
const KBD_CLASS =
  'ml-auto inline-flex h-5 min-w-5 items-center justify-center rounded-r-xs border border-line-soft bg-surface-2 px-sp-1 font-mono text-fs-micro leading-none text-ink-3';

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
    <div className="flex flex-1 flex-col items-center justify-center gap-sp-3 p-sp-5 text-center">
      <BoxSelect className="size-8 text-ink-4" aria-hidden="true" />
      <div className="text-fs-sm font-semibold text-ink-1">Nothing selected</div>
      <div className="max-w-60 text-fs-micro leading-relaxed text-ink-3">{hint.hint}</div>
      <div className="flex w-full flex-col gap-sp-1 border-t border-line-soft pt-sp-2 text-fs-micro text-ink-2">
        <span>
          Current tool: <strong className="text-ink-1">{hint.label}</strong>
        </span>
        {focusedZoneId && (
          <span>
            Focused zone:{' '}
            <strong className="text-ink-1">
              {focusedZoneId === UNASSIGNED_ZONE_ID ? 'Unassigned' : focusedZoneId}
            </strong>
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
    <div className="absolute bottom-10 right-0 top-11 z-sticky flex w-60 flex-col overflow-hidden border-l border-line bg-surface-1 font-sans">
      <div className="shrink-0 border-b border-line px-sp-3 py-sp-2 text-fs-micro font-black uppercase tracking-ls-caps text-ink-3">
        Properties
      </div>

      {/* Hierarchy anchor row */}
      <div className="shrink-0 border-b border-line-soft px-sp-3 py-sp-1 text-fs-micro tracking-ls-caps text-ink-3">
        {anchorText}
      </div>

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
              <div className={SECTION_CLASS}>
                <div className={LABEL_CLASS}>Name</div>
                <Input
                  type="text"
                  value={selectedZone.label}
                  onChange={(e) => updateZoneLabel(selectedZone.zoneId, e.target.value)}
                  aria-label="Zone name"
                  className="h-8 font-sans text-body-sm"
                />
              </div>

              {/* Archetype */}
              <div className={SECTION_CLASS}>
                <div className={LABEL_CLASS}>Archetype</div>
                <div className={ROW_CLASS}>
                  <svg className="size-2 shrink-0" viewBox="0 0 8 8" aria-hidden="true">
                    <circle cx="4" cy="4" r="4" fill={selectedZone.accentColor} />
                  </svg>
                  <span className={`${VALUE_CLASS} capitalize`}>
                    {selectedZone.archetype ?? 'Custom'}
                  </span>
                </div>
              </div>

              {/* Size */}
              <div className={SECTION_CLASS}>
                <div className={LABEL_CLASS}>Size</div>
                <div className={VALUE_CLASS}>
                  {selectedZone.w} &times; {selectedZone.d}
                </div>
              </div>

              {/* Position */}
              <div className={SECTION_CLASS}>
                <div className={LABEL_CLASS}>Position</div>
                <div className={ROW_CLASS}>
                  <span className={`${AXIS_CLASS} text-danger`}>X</span>
                  <span className={VALUE_CLASS}>{selectedZone.cx.toFixed(1)}</span>
                  <span className={`${AXIS_CLASS} ml-sp-3 text-accent`}>Z</span>
                  <span className={VALUE_CLASS}>{selectedZone.cz.toFixed(1)}</span>
                </div>
              </div>

              {/* Furniture count */}
              <div className={SECTION_CLASS}>
                <div className={LABEL_CLASS}>Furniture</div>
                <div className={VALUE_CLASS}>{zoneFurnitureCount}</div>
              </div>

              {/* Desk slots (only if > 0) */}
              {selectedZone.deskSlots > 0 && (
                <div className={SECTION_CLASS}>
                  <div className={LABEL_CLASS}>Desk Slots</div>
                  <div className={VALUE_CLASS}>{selectedZone.deskSlots}</div>
                </div>
              )}

              {/* Variant selector (only if archetype has multiple presets) */}
              {presets.length > 1 && (
                <div className={SECTION_CLASS}>
                  <div className={LABEL_CLASS}>Variant</div>
                  <Select
                    value={selectedPreset?.id}
                    onValueChange={(value) => {
                      const preset = presets.find((p) => p.id === value) as ZonePreset | undefined;
                      if (preset) swapZoneVariant(selectedZone.zoneId, preset, allPrefabsMap);
                    }}
                  >
                    <SelectTrigger aria-label="Zone variant" className="h-8 text-body-sm">
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
              <div className="px-sp-4">
                <Button
                  type="button"
                  variant="secondary"
                  size="sm"
                  onClick={() => rotateZone(selectedZone.zoneId)}
                  aria-label="Rotate zone 90° clockwise (R)"
                  className="w-full justify-center"
                >
                  <RotateCw className="size-3" aria-hidden="true" />
                  <span>Rotate +90°</span>
                  <kbd className={KBD_CLASS}>R</kbd>
                </Button>
              </div>

              {/* Spacer */}
              <div className="flex-1" />

              {/* Delete zone */}
              <div className="px-sp-4 py-sp-3">
                {required ? (
                  <Button
                    type="button"
                    variant="outline"
                    disabled
                    aria-label="Cannot delete required zone"
                    className="w-full justify-center"
                  >
                    <Lock className="size-3" aria-hidden="true" />
                    <span>Required — Cannot Delete</span>
                  </Button>
                ) : (
                  <Button
                    type="button"
                    variant="destructive"
                    onClick={() => deleteZone(selectedZone.zoneId)}
                    aria-label="Delete zone"
                    className="w-full justify-center"
                  >
                    <Trash2 className="size-3" aria-hidden="true" />
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
              <div className={SECTION_CLASS}>
                <div className={LABEL_CLASS}>Prefab</div>
                <div className={VALUE_CLASS}>{definition.name}</div>
                <div className="mt-sp-1 text-fs-micro capitalize text-ink-3">
                  {definition.category}
                </div>
              </div>

              {/* Position */}
              <div className={SECTION_CLASS}>
                <div className={LABEL_CLASS}>Position</div>
                <div className={ROW_CLASS}>
                  <span className={`${AXIS_CLASS} text-danger`}>X</span>
                  <span className={VALUE_CLASS}>{x.toFixed(1)}</span>
                  <span className={`${AXIS_CLASS} ml-sp-3 text-accent`}>Z</span>
                  <span className={VALUE_CLASS}>{z.toFixed(1)}</span>
                </div>
              </div>

              {/* Rotation */}
              <div className={SECTION_CLASS}>
                <div className={LABEL_CLASS}>Rotation</div>
                <div className={ROW_CLASS}>
                  <span className={VALUE_CLASS}>{instance.rotation}&deg;</span>
                  <Button
                    type="button"
                    variant="secondary"
                    size="sm"
                    onClick={rotateSelected}
                    aria-label="Rotate 90 degrees clockwise"
                    title="Rotate +90\u00B0"
                    className="h-7 gap-sp-1 px-sp-2 text-fs-micro"
                  >
                    <RotateCw className="size-3" aria-hidden="true" />
                    <span>+90\u00B0</span>
                  </Button>
                </div>
              </div>

              {/* Grid size */}
              <div className={SECTION_CLASS}>
                <div className={LABEL_CLASS}>Grid Size</div>
                <div className={VALUE_CLASS}>{gridLabel}</div>
              </div>

              {/* Zone */}
              <div className={SECTION_CLASS}>
                <div className={LABEL_CLASS}>Zone</div>
                <div className={ROW_CLASS}>
                  <MapPin className="size-3 shrink-0 text-ink-3" />
                  {instanceZone ? (
                    <>
                      <svg
                        className="size-2 shrink-0 rounded-sm"
                        viewBox="0 0 8 8"
                        aria-hidden="true"
                      >
                        <rect width="8" height="8" rx="2" fill={instanceZone.accentColor} />
                      </svg>
                      <span className={VALUE_CLASS}>{instanceZone.label}</span>
                    </>
                  ) : (
                    <span className="text-fs-micro italic text-ink-3">
                      {instance.zoneId === UNASSIGNED_ZONE_ID ? 'Unassigned' : instance.zoneId}
                    </span>
                  )}
                </div>
              </div>

              {/* Spacer */}
              <div className="flex-1" />

              {/* Delete */}
              <div className="px-sp-4 py-sp-3">
                <Button
                  type="button"
                  variant="destructive"
                  onClick={deleteSelected}
                  aria-label="Delete selected instance"
                  className="w-full justify-center"
                >
                  <Trash2 className="size-3" aria-hidden="true" />
                  <span>Delete Instance</span>
                </Button>
              </div>
            </>
          );
        })()}
    </div>
  );
}
