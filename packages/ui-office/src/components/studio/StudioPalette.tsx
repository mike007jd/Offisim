/**
 * StudioPalette -- Left sidebar showing all prefabs in an icon grid view.
 *
 * Inspired by game engine asset browsers (Godot, Unity).
 * Categories as collapsible sections, prefabs as icon cards.
 */

import { getAllBuiltinPrefabs } from '@offisim/renderer';
import type { PrefabDefinition, SemanticCategory, Zone } from '@offisim/shared-types';
import { ZONE_PRESET_GROUPS, isRequiredArchetype } from '@offisim/shared-types';
import { BookOpen, Cpu, Leaf, Monitor, Pencil, Plus, Server, Users } from 'lucide-react';
import { useCallback, useEffect, useMemo, useState } from 'react';
import { StudioPaletteCategoryHeader } from './StudioPaletteCategoryHeader.js';
import { StudioPalettePrefabCard } from './StudioPalettePrefabCard.js';
import { StudioPaletteZonePresetCard } from './StudioPaletteZonePresetCard.js';
import { useStudioStore } from './StudioState.js';
import {
  FONT,
  LAYOUT,
  SP,
  STUDIO_COLORS,
  panelStyle,
  sectionHeaderStyle,
} from './studio-style-helpers.js';

// -- Category metadata --------------------------------------------------------

interface CategoryMeta {
  id: SemanticCategory;
  label: string;
  Icon: React.ComponentType<{ size?: number; className?: string; style?: React.CSSProperties }>;
  colorKey: keyof typeof STUDIO_COLORS;
}

const CATEGORIES: CategoryMeta[] = [
  { id: 'workspace', label: 'Workspace', Icon: Monitor, colorKey: 'catWorkspace' },
  { id: 'compute', label: 'Compute', Icon: Server, colorKey: 'catCompute' },
  { id: 'knowledge', label: 'Knowledge', Icon: BookOpen, colorKey: 'catKnowledge' },
  { id: 'collaboration', label: 'Collaboration', Icon: Users, colorKey: 'catCollaboration' },
  { id: 'infrastructure', label: 'Infrastructure', Icon: Cpu, colorKey: 'catInfrastructure' },
  { id: 'decorative', label: 'Decorative', Icon: Leaf, colorKey: 'catDecorative' },
];

// -- Styles -------------------------------------------------------------------

const LIST_STYLE: React.CSSProperties = {
  flex: 1,
  overflowY: 'auto',
  padding: `${SP.xs}px 0`,
};

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
    <div style={panelStyle('left')}>
      {/* Header */}
      <div style={sectionHeaderStyle()}>
        {isEditingZone && focusedZone
          ? `${focusedZone.label} — Allowed Assets`
          : activeTab === 'assets'
            ? 'Assets'
            : 'Zones'}
      </div>

      {/* Tab content */}
      {isEditingZone && activeTab === 'assets' ? (
        <div style={LIST_STYLE}>
          {isEditingZone &&
            focusedZone &&
            focusedZone.allowedCategories.length > 0 &&
            visibleCategories.every((cat) => (grouped.get(cat.id)?.length ?? 0) === 0) && (
              <div
                style={{
                  padding: `${SP.lg}px ${SP.md}px`,
                  fontSize: FONT.sm,
                  color: STUDIO_COLORS.textTertiary,
                  textAlign: 'center',
                  fontFamily: FONT.family,
                }}
              >
                No prefabs allowed in this zone
              </div>
            )}
          {visibleCategories.map((cat) => {
            const items = grouped.get(cat.id) ?? [];
            const isCollapsed = collapsed[cat.id] ?? false;
            const catColor = STUDIO_COLORS[cat.colorKey];

            return (
              <div key={cat.id}>
                <StudioPaletteCategoryHeader
                  collapsed={isCollapsed}
                  onClick={() => toggleCategory(cat.id)}
                  icon={<cat.Icon size={12} style={{ color: catColor }} />}
                  label={cat.label}
                  count={items.length}
                />
                {!isCollapsed && (
                  <div
                    style={{
                      display: 'grid',
                      gridTemplateColumns: 'repeat(2, 1fr)',
                      gap: SP.xs,
                      padding: `${SP.xs / 2}px ${SP.sm}px ${SP.sm}px`,
                    }}
                  >
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

  const sortedZones = useMemo(
    () => [...zones].sort((a, b) => a.sortOrder - b.sortOrder),
    [zones],
  );
  const instanceCounts = useMemo(() => {
    const counts = new Map<string, number>();
    for (const instance of instances) {
      counts.set(instance.zoneId, (counts.get(instance.zoneId) ?? 0) + 1);
    }
    return counts;
  }, [instances]);

  return (
    <div style={LIST_STYLE}>
      <div style={{ display: 'flex', flexDirection: 'column', gap: SP.sm, padding: SP.sm }}>
        <button
          type="button"
          onClick={() => setShowPresets((open) => !open)}
          aria-expanded={showPresets}
          style={{
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            gap: SP.xs,
            minHeight: 32,
            borderRadius: LAYOUT.cardRadius,
            border: `1px solid ${STUDIO_COLORS.borderActive}`,
            background: STUDIO_COLORS.accentMuted,
            color: STUDIO_COLORS.accentText,
            fontSize: FONT.sm,
            fontWeight: FONT.bold,
            fontFamily: FONT.family,
            cursor: 'pointer',
          }}
        >
          <Plus size={14} />
          Add Zone
        </button>

        {sortedZones.length === 0 ? (
          <div
            style={{
              border: `1px dashed ${STUDIO_COLORS.borderSubtle}`,
              borderRadius: LAYOUT.cardRadius,
              padding: SP.md,
              color: STUDIO_COLORS.textTertiary,
              fontSize: FONT.sm,
              textAlign: 'center',
              fontFamily: FONT.family,
            }}
          >
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
        <div style={{ borderTop: `1px solid ${STUDIO_COLORS.borderSubtle}`, paddingTop: SP.xs }}>
          {ZONE_PRESET_GROUPS.map((group) => {
            const isCollapsed = collapsed[`zone-${group.archetype}`] ?? false;
            const required = isRequiredArchetype(group.archetype);

            return (
              <div key={group.archetype}>
                <StudioPaletteCategoryHeader
                  collapsed={isCollapsed}
                  onClick={() => onToggleCategory(`zone-${group.archetype}`)}
                  icon={<span style={{ fontSize: FONT.base }}>{group.icon}</span>}
                  label={group.label}
                  count={group.presets.length}
                  required={required}
                  ariaLabel={`${isCollapsed ? 'Expand' : 'Collapse'} ${group.label} zone group (${group.presets.length} presets)`}
                />
                {!isCollapsed && (
                  <div
                    style={{
                      display: 'flex',
                      flexDirection: 'column',
                      gap: SP.xs,
                      padding: `${SP.xs / 2}px ${SP.sm}px ${SP.sm}px`,
                    }}
                  >
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
      style={{
        display: 'flex',
        alignItems: 'center',
        gap: SP.sm,
        minHeight: 44,
        borderRadius: LAYOUT.cardRadius,
        border: `1px solid ${selected ? STUDIO_COLORS.borderActive : STUDIO_COLORS.borderSubtle}`,
        background: selected ? STUDIO_COLORS.accentMuted : STUDIO_COLORS.surface1,
        padding: `${SP.xs}px ${SP.sm}px`,
        fontFamily: FONT.family,
      }}
    >
      <button
        type="button"
        onClick={onSelect}
        style={{
          display: 'flex',
          alignItems: 'center',
          gap: SP.sm,
          minWidth: 0,
          flex: 1,
          border: 'none',
          background: 'transparent',
          padding: 0,
          textAlign: 'left',
          cursor: 'pointer',
          fontFamily: FONT.family,
        }}
      >
        <span
          style={{
            width: 18,
            height: 18,
            flexShrink: 0,
            borderRadius: 5,
            border: `2px solid ${zone.accentColor}`,
            background: zone.floorColor,
          }}
        />
        <span style={{ minWidth: 0, flex: 1 }}>
          <span
            style={{
              display: 'block',
              overflow: 'hidden',
              textOverflow: 'ellipsis',
              whiteSpace: 'nowrap',
              color: selected ? STUDIO_COLORS.accentText : STUDIO_COLORS.textPrimary,
              fontSize: FONT.sm,
              fontWeight: FONT.bold,
            }}
          >
            {zone.label}
          </span>
          <span
            style={{
              display: 'block',
              marginTop: 2,
              color: STUDIO_COLORS.textTertiary,
              fontSize: FONT.xs,
            }}
          >
            {zone.w}x{zone.d} · {itemCount} items · {zone.deskSlots} desks
          </span>
        </span>
      </button>
      <button
        type="button"
        onClick={onEdit}
        aria-label={`Edit ${zone.label}`}
        style={{
          display: 'inline-flex',
          alignItems: 'center',
          gap: 4,
          borderRadius: 999,
          border: `1px solid ${STUDIO_COLORS.borderSubtle}`,
          background: STUDIO_COLORS.surface2,
          color: STUDIO_COLORS.textSecondary,
          padding: `4px ${SP.sm}px`,
          fontSize: FONT.xs,
          fontWeight: FONT.bold,
          fontFamily: FONT.family,
          cursor: 'pointer',
        }}
      >
        <Pencil size={11} />
        Edit
      </button>
    </div>
  );
}
