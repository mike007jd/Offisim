/**
 * StudioPalette -- Left sidebar showing all prefabs in an icon grid view.
 *
 * Inspired by game engine asset browsers (Godot, Unity).
 * Categories as collapsible sections, prefabs as icon cards.
 */

import { getAllBuiltinPrefabs } from '@offisim/renderer';
import type { PrefabDefinition, SemanticCategory, Zone } from '@offisim/shared-types';
import { ZONE_PRESET_GROUPS, isRequiredArchetype } from '@offisim/shared-types';
import { Button, cn } from '@offisim/ui-core';
import { BookOpen, Cpu, Leaf, Monitor, Pencil, Plus, Server, Users } from 'lucide-react';
import { useCallback, useEffect, useMemo, useState } from 'react';
import { StudioPaletteCategoryHeader } from './StudioPaletteCategoryHeader.js';
import { StudioPalettePrefabCard } from './StudioPalettePrefabCard.js';
import { StudioPaletteZonePresetCard } from './StudioPaletteZonePresetCard.js';
import { useStudioStore } from './StudioState.js';

// -- Category metadata --------------------------------------------------------

interface CategoryMeta {
  id: SemanticCategory;
  label: string;
  Icon: React.ComponentType<{ className?: string }>;
  colorClass: string;
}

const CATEGORIES: CategoryMeta[] = [
  { id: 'workspace', label: 'Workspace', Icon: Monitor, colorClass: 'text-accent' },
  { id: 'compute', label: 'Compute', Icon: Server, colorClass: 'text-info' },
  { id: 'knowledge', label: 'Knowledge', Icon: BookOpen, colorClass: 'text-warning' },
  { id: 'collaboration', label: 'Collaboration', Icon: Users, colorClass: 'text-success' },
  { id: 'infrastructure', label: 'Infrastructure', Icon: Cpu, colorClass: 'text-error' },
  { id: 'decorative', label: 'Decorative', Icon: Leaf, colorClass: 'text-text-secondary' },
];

// -- Styles -------------------------------------------------------------------

const LIST_CLASS = 'flex-1 overflow-y-auto py-1';

// -- Component ----------------------------------------------------------------

export function StudioPalette() {
  const placingPrefab = useStudioStore((s) => s.placingPrefab);
  const startPlacement = useStudioStore((s) => s.startPlacement);
  const tool = useStudioStore((s) => s.tool);
  const isEditingZone = useStudioStore((s) => s.isEditingZone);
  const focusedZone = useStudioStore((s) =>
    s.isEditingZone && s.focusedZoneId
      ? (s.zones.find((z) => z.zoneId === s.focusedZoneId) ?? null)
      : null,
  );

  const [activeTab, setActiveTab] = useState<'assets' | 'zones'>('zones');
  const [collapsed, setCollapsed] = useState<Record<string, boolean>>({});

  // Overview is zone-first; assets appear only after entering a zone.
  useEffect(() => {
    setActiveTab(isEditingZone ? 'assets' : 'zones');
  }, [isEditingZone]);

  // Filter categories when in Edit Zone mode by allowedCategories. Empty / undefined
  // allowedCategories means "no constraint", so show all categories without an empty state.
  const visibleCategories = useMemo(() => {
    if (!isEditingZone || !focusedZone) return CATEGORIES;
    if (focusedZone.allowedCategories.length === 0) return CATEGORIES;
    const allowed = new Set<SemanticCategory>(focusedZone.allowedCategories);
    return CATEGORIES.filter((cat) => allowed.has(cat.id));
  }, [isEditingZone, focusedZone]);

  const grouped = useMemo(() => {
    const all = getAllBuiltinPrefabs();
    const map = new Map<SemanticCategory, PrefabDefinition[]>();
    for (const cat of CATEGORIES) {
      map.set(cat.id, []);
    }
    for (const prefab of all) {
      const list = map.get(prefab.category);
      if (list) list.push(prefab);
    }
    return map;
  }, []);

  const toggleCategory = useCallback((catId: string) => {
    setCollapsed((prev) => ({ ...prev, [catId]: !prev[catId] }));
  }, []);

  const isPlacing = tool === 'place';

  return (
    <div className="absolute bottom-10 left-0 top-11 z-sticky flex w-60 flex-col overflow-hidden border-r border-border-default bg-surface-elevated font-sans">
      {/* Header */}
      <div className="shrink-0 border-b border-border-default px-3 py-2 text-caption font-black uppercase tracking-normal text-text-muted">
        {isEditingZone && focusedZone
          ? `${focusedZone.label} — Allowed Assets`
          : activeTab === 'assets'
            ? 'Assets'
            : 'Zones'}
      </div>

      {/* Tab content */}
      {isEditingZone && activeTab === 'assets' ? (
        <div className={LIST_CLASS}>
          {isEditingZone &&
            focusedZone &&
            focusedZone.allowedCategories.length > 0 &&
            visibleCategories.every((cat) => (grouped.get(cat.id)?.length ?? 0) === 0) && (
              <div className="px-3 py-4 text-center text-caption text-text-muted">
                No prefabs allowed in this zone
              </div>
            )}
          {visibleCategories.map((cat) => {
            const items = grouped.get(cat.id) ?? [];
            const isCollapsed = collapsed[cat.id] ?? false;

            return (
              <div key={cat.id}>
                <StudioPaletteCategoryHeader
                  collapsed={isCollapsed}
                  onClick={() => toggleCategory(cat.id)}
                  icon={<cat.Icon className={`size-3 ${cat.colorClass}`} />}
                  label={cat.label}
                  count={items.length}
                />
                {!isCollapsed && (
                  <div className="grid grid-cols-2 gap-1 px-2 pb-2 pt-0.5">
                    {items.map((prefab) => {
                      const isActive = isPlacing && placingPrefab?.prefabId === prefab.prefabId;
                      return (
                        <StudioPalettePrefabCard
                          key={prefab.prefabId}
                          definition={prefab}
                          isActive={isActive}
                          onSelect={() => startPlacement(prefab)}
                        />
                      );
                    })}
                  </div>
                )}
              </div>
            );
          })}
        </div>
      ) : (
        <ZoneOverview collapsed={collapsed} onToggleCategory={toggleCategory} />
      )}
    </div>
  );
}

function ZoneOverview({
  collapsed,
  onToggleCategory,
}: {
  collapsed: Record<string, boolean>;
  onToggleCategory: (catId: string) => void;
}) {
  const zones = useStudioStore((s) => s.zones);
  const instances = useStudioStore((s) => s.instances);
  const selectedZoneId = useStudioStore((s) => s.selectedZoneId);
  const selectZone = useStudioStore((s) => s.selectZone);
  const enterEditZone = useStudioStore((s) => s.enterEditZone);
  const startZonePlacement = useStudioStore((s) => s.startZonePlacement);
  const [showPresets, setShowPresets] = useState(false);

  const sortedZones = useMemo(() => [...zones].sort((a, b) => a.sortOrder - b.sortOrder), [zones]);
  const instanceCounts = useMemo(() => {
    const counts = new Map<string, number>();
    for (const instance of instances) {
      counts.set(instance.zoneId, (counts.get(instance.zoneId) ?? 0) + 1);
    }
    return counts;
  }, [instances]);

  return (
    <div className={LIST_CLASS}>
      <div className="flex flex-col gap-2 p-2">
        <Button
          type="button"
          size="sm"
          onClick={() => setShowPresets((open) => !open)}
          aria-expanded={showPresets}
          className="min-h-8 justify-center gap-1 font-bold"
        >
          <Plus className="size-3.5" aria-hidden="true" />
          Add Zone
        </Button>

        {sortedZones.length === 0 ? (
          <div className="rounded-md border border-dashed border-border-subtle p-3 text-center text-caption text-text-muted">
            No zones yet.
          </div>
        ) : (
          sortedZones.map((zone) => (
            <ZoneOverviewRow
              key={zone.zoneId}
              zone={zone}
              itemCount={instanceCounts.get(zone.zoneId) ?? 0}
              selected={zone.zoneId === selectedZoneId}
              onSelect={() => selectZone(zone.zoneId)}
              onEdit={() => enterEditZone(zone.zoneId)}
            />
          ))
        )}
      </div>

      {showPresets && (
        <div className="border-t border-border-subtle pt-1">
          {ZONE_PRESET_GROUPS.map((group) => {
            const isCollapsed = collapsed[`zone-${group.archetype}`] ?? false;
            const required = isRequiredArchetype(group.archetype);

            return (
              <div key={group.archetype}>
                <StudioPaletteCategoryHeader
                  collapsed={isCollapsed}
                  onClick={() => onToggleCategory(`zone-${group.archetype}`)}
                  icon={<span className="text-caption">{group.icon}</span>}
                  label={group.label}
                  count={group.presets.length}
                  required={required}
                  ariaLabel={`${isCollapsed ? 'Expand' : 'Collapse'} ${group.label} zone group (${group.presets.length} presets)`}
                />
                {!isCollapsed && (
                  <div className="flex flex-col gap-1 px-2 pb-2 pt-0.5">
                    {group.presets.map((preset) => (
                      <StudioPaletteZonePresetCard
                        key={preset.id}
                        preset={preset}
                        isRequired={required}
                        onStartPlacement={() => {
                          startZonePlacement(preset);
                          setShowPresets(false);
                        }}
                      />
                    ))}
                  </div>
                )}
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}

function ZoneOverviewRow({
  zone,
  itemCount,
  selected,
  onSelect,
  onEdit,
}: {
  zone: Zone;
  itemCount: number;
  selected: boolean;
  onSelect: () => void;
  onEdit: () => void;
}) {
  return (
    <div
      className={cn(
        'flex min-h-11 items-center gap-2 rounded-md border px-2 py-1',
        selected ? 'border-border-focus bg-accent-muted' : 'border-border-subtle bg-surface-muted',
      )}
    >
      <Button
        type="button"
        variant="ghost"
        onClick={onSelect}
        className="h-auto min-w-0 flex-1 justify-start gap-2 border-0 bg-transparent p-0 text-left hover:bg-transparent"
      >
        <span
          className="size-5 shrink-0 rounded"
          style={{
            border: `2px solid ${zone.accentColor}`,
            background: zone.floorColor,
          }}
        />
        <span className="min-w-0 flex-1">
          <span
            className={cn(
              'block truncate text-caption font-bold',
              selected ? 'text-accent-text' : 'text-text-primary',
            )}
          >
            {zone.label}
          </span>
          <span className="mt-0.5 block text-caption text-text-muted">
            {zone.w}x{zone.d} · {itemCount} items · {zone.deskSlots} desks
          </span>
        </span>
      </Button>
      <Button
        type="button"
        variant="secondary"
        size="sm"
        onClick={onEdit}
        aria-label={`Edit ${zone.label}`}
        className="h-7 rounded-full px-2 text-caption font-bold"
      >
        <Pencil className="size-3" aria-hidden="true" />
        Edit
      </Button>
    </div>
  );
}
