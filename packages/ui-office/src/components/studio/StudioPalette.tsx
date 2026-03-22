/**
 * StudioPalette -- Left sidebar showing all prefabs in an icon grid view.
 *
 * Inspired by game engine asset browsers (Godot, Unity).
 * Categories as collapsible sections, prefabs as icon cards.
 */

import { useState, useMemo, useCallback } from 'react';
import {
  Monitor,
  Server,
  BookOpen,
  Users,
  Cpu,
  Leaf,
} from 'lucide-react';
import { getAllBuiltinPrefabs } from '@aics/renderer';
import type { PrefabDefinition, SemanticCategory } from '@aics/shared-types';
import { useStudioStore } from './StudioState.js';
import {
  STUDIO_COLORS,
  SP,
  FONT,
  LAYOUT,
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

// Map prefab category to a per-item icon (reuse category icon)
const CATEGORY_ICON_MAP: Record<SemanticCategory, React.ComponentType<{ size?: number; style?: React.CSSProperties }>> = {
  workspace: Monitor,
  compute: Server,
  knowledge: BookOpen,
  collaboration: Users,
  infrastructure: Cpu,
  decorative: Leaf,
};

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

  const [collapsed, setCollapsed] = useState<Record<string, boolean>>({});

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
      <div style={sectionHeaderStyle()}>Assets</div>
      <div style={LIST_STYLE}>
        {CATEGORIES.map((cat) => {
          const items = grouped.get(cat.id) ?? [];
          const isCollapsed = collapsed[cat.id] ?? false;
          const catColor = STUDIO_COLORS[cat.colorKey];

          return (
            <div key={cat.id}>
              {/* Category header */}
              <button
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
                    const isActive =
                      isPlacing && placingPrefab?.prefabId === prefab.prefabId;
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
  const ItemIcon = CATEGORY_ICON_MAP[definition.category] ?? Monitor;
  const color = CATEGORY_COLOR_MAP[definition.category] ?? STUDIO_COLORS.textSecondary;

  return (
    <button
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
        gap: SP.xs,
        padding: `${SP.sm}px ${SP.xs}px`,
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
      <ItemIcon size={20} style={{ color: isActive ? STUDIO_COLORS.accentText : color }} />
      <span
        style={{
          fontSize: FONT.xs,
          fontWeight: FONT.medium,
          color: isActive ? STUDIO_COLORS.accentText : STUDIO_COLORS.textSecondary,
          textAlign: 'center',
          lineHeight: 1.2,
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
