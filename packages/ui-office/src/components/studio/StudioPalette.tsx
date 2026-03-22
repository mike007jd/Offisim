/**
 * StudioPalette -- Left sidebar showing all prefabs grouped by category.
 *
 * Click a prefab to enter placement mode via StudioState.
 * Categories are collapsible with a toggle arrow.
 * Mirrors the existing PrefabPalette style but wired to useStudioStore.
 */

import { useState, useMemo, useCallback } from 'react';
import { getAllBuiltinPrefabs } from '@aics/renderer';
import type { PrefabDefinition, SemanticCategory } from '@aics/shared-types';
import { useStudioStore } from './StudioState.js';

// -- Category metadata --------------------------------------------------------

interface CategoryMeta {
  id: SemanticCategory;
  label: string;
  icon: string;
}

const CATEGORIES: CategoryMeta[] = [
  { id: 'workspace', label: 'Workspace', icon: '\u{1F5A5}' },
  { id: 'compute', label: 'Compute', icon: '\u{1F5A7}' },
  { id: 'knowledge', label: 'Knowledge', icon: '\u{1F4DA}' },
  { id: 'collaboration', label: 'Collaboration', icon: '\u{1F91D}' },
  { id: 'infrastructure', label: 'Infrastructure', icon: '\u26A1' },
  { id: 'decorative', label: 'Decorative', icon: '\u{1F33F}' },
];

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

  // Build catalog grouped by category (stable -- prefabs are static)
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
      <div style={HEADER_STYLE}>Prefabs</div>
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
                <span>{cat.icon}</span>
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

              {/* Items */}
              {!isCollapsed &&
                items.map((prefab) => {
                  const isActive =
                    isPlacing && placingPrefab?.prefabId === prefab.prefabId;
                  return (
                    <PrefabItem
                      key={prefab.prefabId}
                      definition={prefab}
                      isActive={isActive}
                      onSelect={() => startPlacement(prefab)}
                    />
                  );
                })}
            </div>
          );
        })}
      </div>
    </div>
  );
}

// -- Prefab item row ----------------------------------------------------------

function PrefabItem({
  definition,
  isActive,
  onSelect,
}: {
  definition: PrefabDefinition;
  isActive: boolean;
  onSelect: () => void;
}) {
  const [hovered, setHovered] = useState(false);

  const gridLabel = `${definition.gridSize[0]}x${definition.gridSize[1]}`;

  return (
    <button
      onClick={onSelect}
      onMouseEnter={() => setHovered(true)}
      onMouseLeave={() => setHovered(false)}
      style={{
        display: 'flex',
        alignItems: 'center',
        gap: 8,
        width: '100%',
        padding: '5px 12px 5px 28px',
        background: isActive
          ? 'rgba(99, 102, 241, 0.2)'
          : hovered
            ? 'rgba(51, 65, 85, 0.3)'
            : 'transparent',
        border: 'none',
        borderLeft: isActive
          ? '2px solid #6366f1'
          : '2px solid transparent',
        cursor: 'pointer',
        textAlign: 'left',
        fontFamily: 'inherit',
        transition: 'background 0.1s, border-color 0.1s',
      }}
    >
      <div style={{ flex: 1, minWidth: 0 }}>
        <div
          style={{
            fontSize: 11,
            fontWeight: 500,
            color: isActive ? '#a5b4fc' : '#cbd5e1',
            whiteSpace: 'nowrap',
            overflow: 'hidden',
            textOverflow: 'ellipsis',
          }}
        >
          {definition.name}
        </div>
      </div>
      <span
        style={{
          fontSize: 9,
          fontFamily: 'monospace',
          color: '#64748b',
          flexShrink: 0,
        }}
      >
        {gridLabel}
      </span>
    </button>
  );
}
