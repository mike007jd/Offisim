/**
 * StudioPalette -- Left sidebar showing all prefabs in an icon grid view.
 *
 * Inspired by game engine asset browsers (Godot, Unity).
 * Categories as collapsible sections, prefabs as icon cards.
 */

import { getAllBuiltinPrefabs } from '@offisim/renderer';
import type { PrefabDefinition, SemanticCategory, Zone } from '@offisim/shared-types';
import { ZONE_PRESET_GROUPS, isRequiredArchetype } from '@offisim/shared-types';
import { Button } from '@offisim/ui-core';
import {
  BookOpen,
  Cpu,
  Leaf,
  type LucideIcon,
  Monitor,
  Pencil,
  Plus,
  Server,
  Users,
} from 'lucide-react';
import { useCallback, useEffect, useMemo, useState } from 'react';
import { StudioPaletteCategoryHeader } from './StudioPaletteCategoryHeader.js';
import { StudioPalettePrefabCard } from './StudioPalettePrefabCard.js';
import { StudioPaletteZonePresetCard } from './StudioPaletteZonePresetCard.js';
import { useStudioStore } from './StudioState.js';

// -- Category metadata --------------------------------------------------------

interface CategoryMeta {
  id: SemanticCategory;
  label: string;
  Icon: LucideIcon;
  tone: 'accent' | 'warn' | 'ok' | 'danger' | 'muted';
}

const CATEGORIES: CategoryMeta[] = [
  { id: 'workspace', label: 'Workspace', Icon: Monitor, tone: 'accent' },
  { id: 'compute', label: 'Compute', Icon: Server, tone: 'accent' },
  { id: 'knowledge', label: 'Knowledge', Icon: BookOpen, tone: 'warn' },
  { id: 'collaboration', label: 'Collaboration', Icon: Users, tone: 'ok' },
  { id: 'infrastructure', label: 'Infrastructure', Icon: Cpu, tone: 'danger' },
  { id: 'decorative', label: 'Decorative', Icon: Leaf, tone: 'muted' },
];

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
    <div className="studio-palette">
      {/* Header */}
      <div className="studio-palette-head">
        {isEditingZone && focusedZone
          ? `${focusedZone.label} — Allowed Assets`
          : activeTab === 'assets'
            ? 'Assets'
            : 'Zones'}
      </div>

      {/* Tab content */}
      {isEditingZone && activeTab === 'assets' ? (
        <div className="studio-palette-list">
          {isEditingZone &&
            focusedZone &&
            focusedZone.allowedCategories.length > 0 &&
            visibleCategories.every((cat) => (grouped.get(cat.id)?.length ?? 0) === 0) && (
              <div className="studio-palette-empty">No prefabs allowed in this zone</div>
            )}
          {visibleCategories.map((cat) => {
            const items = grouped.get(cat.id) ?? [];
            const isCollapsed = collapsed[cat.id] ?? false;

            return (
              <div key={cat.id}>
                <StudioPaletteCategoryHeader
                  collapsed={isCollapsed}
                  onClick={() => toggleCategory(cat.id)}
                  icon={<cat.Icon className="studio-palette-category-icon" data-tone={cat.tone} />}
                  label={cat.label}
                  count={items.length}
                />
                {!isCollapsed && (
                  <div className="studio-palette-prefab-grid">
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
    <div className="studio-palette-list">
      <div className="studio-zone-overview">
        <Button
          type="button"
          size="sm"
          onClick={() => setShowPresets((open) => !open)}
          aria-expanded={showPresets}
          className="studio-zone-add-button"
        >
          <Plus data-icon="inline-start" aria-hidden="true" />
          Add Zone
        </Button>

        {sortedZones.length === 0 ? (
          <div className="studio-zone-empty">No zones yet.</div>
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
        <div className="studio-zone-presets">
          {ZONE_PRESET_GROUPS.map((group) => {
            const isCollapsed = collapsed[`zone-${group.archetype}`] ?? false;
            const required = isRequiredArchetype(group.archetype);

            return (
              <div key={group.archetype}>
                <StudioPaletteCategoryHeader
                  collapsed={isCollapsed}
                  onClick={() => onToggleCategory(`zone-${group.archetype}`)}
                  icon={<span className="studio-zone-group-icon">{group.icon}</span>}
                  label={group.label}
                  count={group.presets.length}
                  required={required}
                  ariaLabel={`${isCollapsed ? 'Expand' : 'Collapse'} ${group.label} zone group (${group.presets.length} presets)`}
                />
                {!isCollapsed && (
                  <div className="studio-zone-preset-list">
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
    <div className="studio-zone-row" data-selected={selected ? 'true' : 'false'}>
      <Button type="button" variant="ghost" onClick={onSelect} className="studio-zone-row-main">
        <svg className="studio-zone-swatch" viewBox="0 0 20 20" aria-hidden="true">
          <rect width="20" height="20" rx="4" fill={`${zone.floorColor}`} />
          <rect
            x="1"
            y="1"
            width="18"
            height="18"
            rx="3"
            fill="none"
            stroke={`${zone.accentColor}`}
            strokeWidth="2"
          />
        </svg>
        <span className="studio-zone-row-copy">
          <span data-slot="label">{zone.label}</span>
          <span data-slot="meta">
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
        className="studio-zone-edit-button"
      >
        <Pencil data-icon="inline-start" aria-hidden="true" />
        Edit
      </Button>
    </div>
  );
}
