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

// -- Category metadata --------------------------------------------------------

interface CategoryMeta {
  id: SemanticCategory;
  label: string;
  Icon: React.ComponentType<{ size?: number; className?: string; style?: React.CSSProperties }>;
  color: string;
}

const CATEGORIES: CategoryMeta[] = [
  { id: 'workspace', label: 'Workspace', Icon: Monitor, color: '#60a5fa' },
  { id: 'compute', label: 'Compute', Icon: Server, color: '#f97316' },
  { id: 'knowledge', label: 'Knowledge', Icon: BookOpen, color: '#a78bfa' },
  { id: 'collaboration', label: 'Collaboration', Icon: Users, color: '#34d399' },
  { id: 'infrastructure', label: 'Infrastructure', Icon: Cpu, color: '#facc15' },
  { id: 'decorative', label: 'Decorative', Icon: Leaf, color: '#4ade80' },
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

const CATEGORY_COLOR_MAP: Record<SemanticCategory, string> = Object.fromEntries(
  CATEGORIES.map((c) => [c.id, c.color]),
) as Record<SemanticCategory, string>;

// -- Styles -------------------------------------------------------------------

const PANEL_STYLE: React.CSSProperties = {
  position: 'absolute',
  left: 0,
  top: 48,
  bottom: 48,
  width: 220,
  background: 'rgba(15, 15, 26, 0.95)',
  borderRight: '1px solid #333',
  display: 'flex',
  flexDirection: 'column',
  overflow: 'hidden',
  fontFamily: 'Inter, system-ui, sans-serif',
  zIndex: 20,
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

const LIST_STYLE: React.CSSProperties = {
  flex: 1,
  overflowY: 'auto',
  padding: '4px 0',
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
    <div style={PANEL_STYLE}>
      <div style={HEADER_STYLE}>Assets</div>
      <div style={LIST_STYLE}>
        {CATEGORIES.map((cat) => {
          const items = grouped.get(cat.id) ?? [];
          const isCollapsed = collapsed[cat.id] ?? false;

          return (
            <div key={cat.id}>
              {/* Category header */}
              <button
                onClick={() => toggleCategory(cat.id)}
                style={{
                  display: 'flex',
                  alignItems: 'center',
                  gap: 6,
                  width: '100%',
                  padding: '6px 12px',
                  background: 'transparent',
                  border: 'none',
                  cursor: 'pointer',
                  textAlign: 'left',
                  fontSize: 11,
                  fontWeight: 700,
                  color: '#94a3b8',
                  fontFamily: 'inherit',
                }}
              >
                <span
                  style={{
                    fontSize: 9,
                    color: '#64748b',
                    transition: 'transform 0.15s',
                    transform: isCollapsed ? 'rotate(-90deg)' : 'rotate(0deg)',
                    display: 'inline-block',
                  }}
                >
                  &#9660;
                </span>
                <cat.Icon size={12} />
                <span>{cat.label}</span>
                <span
                  style={{
                    marginLeft: 'auto',
                    fontSize: 9,
                    color: '#64748b',
                    fontWeight: 500,
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
                    gap: 4,
                    padding: '2px 8px 8px',
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
  const color = CATEGORY_COLOR_MAP[definition.category] ?? '#94a3b8';

  return (
    <button
      onClick={onSelect}
      onMouseEnter={() => setHovered(true)}
      onMouseLeave={() => setHovered(false)}
      title={`${definition.name} (${definition.gridSize[0]}x${definition.gridSize[1]})`}
      style={{
        display: 'flex',
        flexDirection: 'column',
        alignItems: 'center',
        justifyContent: 'center',
        gap: 4,
        padding: '8px 4px',
        borderRadius: 6,
        background: isActive
          ? 'rgba(99, 102, 241, 0.25)'
          : hovered
            ? 'rgba(51, 65, 85, 0.4)'
            : 'rgba(30, 30, 50, 0.5)',
        border: isActive
          ? '1px solid rgba(99, 102, 241, 0.5)'
          : '1px solid rgba(51, 65, 85, 0.3)',
        cursor: 'pointer',
        fontFamily: 'inherit',
        transition: 'all 0.12s',
      }}
    >
      <ItemIcon size={20} style={{ color: isActive ? '#a5b4fc' : color }} />
      <span
        style={{
          fontSize: 9,
          fontWeight: 500,
          color: isActive ? '#a5b4fc' : '#94a3b8',
          textAlign: 'center',
          lineHeight: 1.2,
          overflow: 'hidden',
          textOverflow: 'ellipsis',
          whiteSpace: 'nowrap',
          width: '100%',
        }}
      >
        {definition.name}
      </span>
    </button>
  );
}
