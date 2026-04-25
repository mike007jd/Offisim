/**
 * StudioPalette -- Left sidebar showing all prefabs in an icon grid view.
 *
 * Inspired by game engine asset browsers (Godot, Unity).
 * Categories as collapsible sections, prefabs as icon cards.
 */

import { getAllBuiltinPrefabs } from '@offisim/renderer';
import type { PrefabDefinition, SemanticCategory } from '@offisim/shared-types';
import type { ZonePreset } from '@offisim/shared-types';
import { ZONE_PRESET_GROUPS, isRequiredArchetype } from '@offisim/shared-types';
import { BookOpen, Cpu, Leaf, Lock, Monitor, Server, Users } from 'lucide-react';
import { useCallback, useEffect, useMemo, useState } from 'react';
import { PrefabThumbnail } from './PrefabThumbnail.js';
import { useStudioStore } from './StudioState.js';
import {
  FONT,
  LAYOUT,
  SP,
  STUDIO_COLORS,
  panelStyle,
  sectionHeaderStyle,
} from './studio-tokens.js';

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

const CATEGORY_COLOR_MAP: Record<SemanticCategory, string> = {
  workspace: STUDIO_COLORS.catWorkspace,
  compute: STUDIO_COLORS.catCompute,
  knowledge: STUDIO_COLORS.catKnowledge,
  collaboration: STUDIO_COLORS.catCollaboration,
  infrastructure: STUDIO_COLORS.catInfrastructure,
  decorative: STUDIO_COLORS.catDecorative,
};

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

  const [activeTab, setActiveTab] = useState<'assets' | 'zones'>('assets');
  const [collapsed, setCollapsed] = useState<Record<string, boolean>>({});

  // Auto-switch to assets tab when entering Edit Zone mode
  useEffect(() => {
    if (isEditingZone) setActiveTab('assets');
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

      {/* Tab bar — Zones tab disabled in Edit Zone mode */}
      <div
        style={{
          display: 'flex',
          borderBottom: `1px solid ${STUDIO_COLORS.border}`,
          flexShrink: 0,
        }}
      >
        {(['assets', 'zones'] as const).map((tab) => {
          const isActive = activeTab === tab;
          const isZonesDisabled = isEditingZone && tab === 'zones';
          return (
            <button
              key={tab}
              type="button"
              onClick={() => {
                if (isZonesDisabled) return;
                setActiveTab(tab);
              }}
              disabled={isZonesDisabled}
              title={isZonesDisabled ? 'Available outside zone edit' : undefined}
              style={{
                flex: 1,
                padding: `${SP.sm}px ${SP.md}px`,
                background: 'transparent',
                border: 'none',
                borderBottom: isActive
                  ? `2px solid ${STUDIO_COLORS.accent}`
                  : '2px solid transparent',
                cursor: isZonesDisabled ? 'not-allowed' : 'pointer',
                fontSize: FONT.sm,
                fontWeight: isActive ? FONT.semibold : FONT.normal,
                color: isZonesDisabled
                  ? STUDIO_COLORS.textDisabled
                  : isActive
                    ? STUDIO_COLORS.textPrimary
                    : STUDIO_COLORS.textTertiary,
                opacity: isZonesDisabled ? 0.55 : 1,
                fontFamily: FONT.family,
                letterSpacing: 0.3,
                transition: 'color 0.12s, border-color 0.12s',
                textTransform: 'capitalize' as const,
              }}
            >
              {tab === 'assets' ? 'Assets' : 'Zones'}
            </button>
          );
        })}
      </div>

      {/* Tab content */}
      {activeTab === 'assets' ? (
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
                {/* Category header */}
                <button
                  type="button"
                  onClick={() => toggleCategory(cat.id)}
                  aria-label={`${isCollapsed ? 'Expand' : 'Collapse'} ${cat.label} category (${items.length} items)`}
                  style={{
                    display: 'flex',
                    alignItems: 'center',
                    gap: SP.sm,
                    width: '100%',
                    padding: `${SP.sm}px ${SP.md}px`,
                    background: 'transparent',
                    border: 'none',
                    cursor: 'pointer',
                    textAlign: 'left',
                    fontSize: FONT.base,
                    fontWeight: FONT.bold,
                    color: STUDIO_COLORS.textSecondary,
                    fontFamily: FONT.family,
                  }}
                >
                  <span
                    style={{
                      fontSize: FONT.xs,
                      color: STUDIO_COLORS.textTertiary,
                      transition: 'transform 0.15s',
                      transform: isCollapsed ? 'rotate(-90deg)' : 'rotate(0deg)',
                      display: 'inline-block',
                    }}
                  >
                    &#9660;
                  </span>
                  <cat.Icon size={12} style={{ color: catColor }} />
                  <span>{cat.label}</span>
                  <span
                    style={{
                      marginLeft: 'auto',
                      fontSize: FONT.xs,
                      color: STUDIO_COLORS.textTertiary,
                      fontWeight: FONT.medium,
                    }}
                  >
                    {items.length}
                  </span>
                </button>

                {/* Grid of prefab cards */}
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
                        <PrefabCard
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
        <div style={LIST_STYLE}>
          {ZONE_PRESET_GROUPS.map((group) => {
            const isCollapsed = collapsed[`zone-${group.archetype}`] ?? false;
            const required = isRequiredArchetype(group.archetype);

            return (
              <div key={group.archetype}>
                {/* Group header */}
                <button
                  type="button"
                  onClick={() => toggleCategory(`zone-${group.archetype}`)}
                  aria-label={`${isCollapsed ? 'Expand' : 'Collapse'} ${group.label} zone group (${group.presets.length} presets)`}
                  style={{
                    display: 'flex',
                    alignItems: 'center',
                    gap: SP.sm,
                    width: '100%',
                    padding: `${SP.sm}px ${SP.md}px`,
                    background: 'transparent',
                    border: 'none',
                    cursor: 'pointer',
                    textAlign: 'left',
                    fontSize: FONT.base,
                    fontWeight: FONT.bold,
                    color: STUDIO_COLORS.textSecondary,
                    fontFamily: FONT.family,
                  }}
                >
                  <span
                    style={{
                      fontSize: FONT.xs,
                      color: STUDIO_COLORS.textTertiary,
                      transition: 'transform 0.15s',
                      transform: isCollapsed ? 'rotate(-90deg)' : 'rotate(0deg)',
                      display: 'inline-block',
                    }}
                  >
                    &#9660;
                  </span>
                  <span style={{ fontSize: FONT.base }}>{group.icon}</span>
                  <span>{group.label}</span>
                  {required && (
                    <span
                      style={{
                        fontSize: FONT.xs,
                        fontWeight: FONT.semibold,
                        color: STUDIO_COLORS.warning,
                        background: STUDIO_COLORS.warningMuted,
                        borderRadius: 10,
                        padding: `1px ${SP.xs}px`,
                        letterSpacing: 0.3,
                      }}
                    >
                      REQUIRED
                    </span>
                  )}
                  <span
                    style={{
                      marginLeft: 'auto',
                      fontSize: FONT.xs,
                      color: STUDIO_COLORS.textTertiary,
                      fontWeight: FONT.medium,
                    }}
                  >
                    {group.presets.length}
                  </span>
                </button>

                {/* Zone preset cards */}
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
                      <ZonePresetCard key={preset.id} preset={preset} isRequired={required} />
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

// -- Prefab card (icon grid item) ---------------------------------------------

function PrefabCard({
  definition,
  isActive,
  onSelect,
}: {
  definition: PrefabDefinition;
  isActive: boolean;
  onSelect: () => void;
}) {
  const [hovered, setHovered] = useState(false);
  const color = CATEGORY_COLOR_MAP[definition.category] ?? STUDIO_COLORS.textSecondary;

  return (
    <button
      type="button"
      onClick={onSelect}
      onMouseEnter={() => setHovered(true)}
      onMouseLeave={() => setHovered(false)}
      aria-label={`Place ${definition.name} (${definition.gridSize[0]}x${definition.gridSize[1]})`}
      title={`${definition.name} (${definition.gridSize[0]}x${definition.gridSize[1]})`}
      style={{
        display: 'flex',
        flexDirection: 'column',
        alignItems: 'center',
        justifyContent: 'center',
        gap: 2,
        padding: `${SP.sm}px ${SP.xs}px ${SP.xs}px`,
        borderRadius: LAYOUT.cardRadius,
        background: isActive
          ? STUDIO_COLORS.accentMuted
          : hovered
            ? STUDIO_COLORS.surface2
            : STUDIO_COLORS.surface1,
        border: isActive
          ? `1px solid ${STUDIO_COLORS.borderActive}`
          : `1px solid ${STUDIO_COLORS.borderSubtle}`,
        cursor: 'pointer',
        fontFamily: FONT.family,
        transition: 'all 0.12s',
      }}
    >
      <PrefabThumbnail
        prefabId={definition.prefabId}
        size={32}
        color={isActive ? STUDIO_COLORS.accentText : color}
      />
      <span
        style={{
          fontSize: 8,
          fontWeight: FONT.medium,
          color: isActive ? STUDIO_COLORS.accentText : STUDIO_COLORS.textTertiary,
          textAlign: 'center',
          lineHeight: 1.15,
          overflow: 'hidden',
          display: '-webkit-box',
          WebkitLineClamp: 2,
          WebkitBoxOrient: 'vertical' as const,
          wordBreak: 'break-word' as const,
          width: '100%',
        }}
      >
        {definition.name}
      </span>
    </button>
  );
}

// -- Zone preset card ---------------------------------------------------------

function ZonePresetCard({
  preset,
  isRequired,
}: {
  preset: ZonePreset;
  isRequired: boolean;
}) {
  const [hovered, setHovered] = useState(false);

  const handleClick = () => {
    useStudioStore.getState().startZonePlacement(preset);
  };

  const sizeLabel = `${preset.w}x${preset.d}`;
  const itemsLabel = `${preset.prefabs.length} items`;
  const desksLabel = preset.deskSlots > 0 ? `${preset.deskSlots} desks` : null;

  return (
    <button
      type="button"
      onClick={handleClick}
      onMouseEnter={() => setHovered(true)}
      onMouseLeave={() => setHovered(false)}
      aria-label={`Place ${preset.label} zone (${sizeLabel})`}
      title={preset.description}
      style={{
        display: 'flex',
        alignItems: 'center',
        gap: SP.sm,
        padding: `${SP.sm}px ${SP.xs}px`,
        borderRadius: LAYOUT.cardRadius,
        background: hovered ? STUDIO_COLORS.surface2 : STUDIO_COLORS.surface1,
        border: `1px solid ${STUDIO_COLORS.borderSubtle}`,
        cursor: 'pointer',
        fontFamily: FONT.family,
        textAlign: 'left',
        transition: 'all 0.12s',
        width: '100%',
      }}
    >
      {/* Color swatch with optional lock overlay */}
      <div
        style={{
          position: 'relative',
          flexShrink: 0,
          width: 28,
          height: 28,
          borderRadius: 4,
          background: preset.accentColor,
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          overflow: 'hidden',
        }}
      >
        {/* Inner proportional size indicator */}
        <div
          style={{
            width: Math.min(20, Math.round((preset.w / Math.max(preset.w, preset.d)) * 20)),
            height: Math.min(20, Math.round((preset.d / Math.max(preset.w, preset.d)) * 20)),
            borderRadius: 2,
            background: 'rgba(255,255,255,0.25)',
          }}
        />
        {/* Lock icon overlay for required archetypes */}
        {isRequired && (
          <div
            style={{
              position: 'absolute',
              bottom: 1,
              right: 1,
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
            }}
          >
            <Lock size={8} style={{ color: 'rgba(255,255,255,0.85)' }} />
          </div>
        )}
      </div>

      {/* Text info */}
      <div
        style={{
          flex: 1,
          minWidth: 0,
          display: 'flex',
          flexDirection: 'column',
          gap: 2,
        }}
      >
        <span
          style={{
            fontSize: FONT.base,
            fontWeight: FONT.medium,
            color: STUDIO_COLORS.textSecondary,
            overflow: 'hidden',
            textOverflow: 'ellipsis',
            whiteSpace: 'nowrap',
          }}
        >
          {preset.label}
        </span>
        <span
          style={{
            fontSize: FONT.xs,
            color: STUDIO_COLORS.textTertiary,
            display: 'flex',
            gap: SP.xs,
            flexWrap: 'wrap' as const,
          }}
        >
          <span>{sizeLabel}</span>
          <span style={{ color: STUDIO_COLORS.textDisabled }}>·</span>
          <span>{itemsLabel}</span>
          {desksLabel && (
            <>
              <span style={{ color: STUDIO_COLORS.textDisabled }}>·</span>
              <span>{desksLabel}</span>
            </>
          )}
        </span>
      </div>
    </button>
  );
}
