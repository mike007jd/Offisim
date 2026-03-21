/**
 * PrefabPalette — Left sidebar listing available prefabs by category.
 *
 * Game-style floating panel with collapsible category sections.
 * Clicking a prefab enters placement mode. Uses the builtin catalog
 * from @aics/renderer for the prefab definitions.
 */

import { useState, useMemo, useCallback } from 'react';
import { getAllBuiltinPrefabs } from '@aics/renderer';
import type { PrefabDefinition, SemanticCategory } from '@aics/shared-types';
import { useEditor } from './EditorMode.js';

// ── Category metadata ────────────────────────────────────────────

interface CategoryMeta {
  id: SemanticCategory;
  label: string;
  icon: string;
}

const CATEGORIES: CategoryMeta[] = [
  { id: 'workspace', label: 'Workspace', icon: '\u{1f4e6}' },
  { id: 'compute', label: 'Compute', icon: '\u{1f5a5}\ufe0f' },
  { id: 'knowledge', label: 'Knowledge', icon: '\u{1f4da}' },
  { id: 'collaboration', label: 'Collaboration', icon: '\u{1f91d}' },
  { id: 'infrastructure', label: 'Infrastructure', icon: '\u{1f50c}' },
  { id: 'decorative', label: 'Decorative', icon: '\u{1f33f}' },
];

// ── Styles ───────────────────────────────────────────────────────

const PANEL_STYLE: React.CSSProperties = {
  position: 'absolute',
  left: 12,
  top: 52,
  bottom: 12,
  width: 220,
  background: 'rgba(15, 23, 42, 0.92)',
  backdropFilter: 'blur(12px)',
  border: '1px solid rgba(51, 65, 85, 0.5)',
  borderRadius: 12,
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
  color: 'var(--text-secondary-val)',
  borderBottom: '1px solid rgba(51, 65, 85, 0.4)',
  flexShrink: 0,
};

const LIST_STYLE: React.CSSProperties = {
  flex: 1,
  overflowY: 'auto',
  padding: '4px 0',
};

// ── Component ────────────────────────────────────────────────────

export function PrefabPalette() {
  const { startPlacement, placingPrefab, activeTool } = useEditor();
  const [collapsed, setCollapsed] = useState<Record<string, boolean>>({});

  // Build catalog grouped by category
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

  const isPlacing = activeTool === 'place';

  return (
    <div style={PANEL_STYLE}>
      <div style={HEADER_STYLE}>
        Prefabs
      </div>
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
                  color: 'var(--text-secondary-val)',
                  fontFamily: 'inherit',
                }}
              >
                <span style={{
                  fontSize: 9,
                  color: 'var(--text-muted-val)',
                  transition: 'transform 0.15s',
                  transform: isCollapsed ? 'rotate(-90deg)' : 'rotate(0deg)',
                  display: 'inline-block',
                }}>
                  &#9660;
                </span>
                <span>{cat.icon}</span>
                <span>{cat.label}</span>
                <span style={{
                  marginLeft: 'auto',
                  fontSize: 9,
                  color: 'var(--text-muted-val)',
                  fontWeight: 500,
                }}>
                  {items.length}
                </span>
              </button>

              {/* Items */}
              {!isCollapsed && items.map((prefab) => {
                const isActive = isPlacing && placingPrefab?.prefabId === prefab.prefabId;
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

// ── Prefab item row ──────────────────────────────────────────────

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
          ? 'rgba(59, 130, 246, 0.2)'
          : hovered
            ? 'rgba(51, 65, 85, 0.3)'
            : 'transparent',
        border: 'none',
        borderLeft: isActive ? '2px solid #3b82f6' : '2px solid transparent',
        cursor: 'pointer',
        textAlign: 'left',
        fontFamily: 'inherit',
        transition: 'background 0.1s, border-color 0.1s',
      }}
    >
      <div style={{ flex: 1, minWidth: 0 }}>
        <div style={{
          fontSize: 11,
          fontWeight: 500,
          color: isActive ? '#93c5fd' : 'var(--surface-mid)',
          whiteSpace: 'nowrap',
          overflow: 'hidden',
          textOverflow: 'ellipsis',
        }}>
          {definition.name}
        </div>
      </div>
      <span style={{
        fontSize: 9,
        fontFamily: 'monospace',
        color: 'var(--text-muted-val)',
        flexShrink: 0,
      }}>
        {gridLabel}
      </span>
    </button>
  );
}
