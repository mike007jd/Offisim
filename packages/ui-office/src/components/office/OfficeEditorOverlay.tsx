/**
 * OfficeEditorOverlay — "Offisim Studio"
 *
 * Standalone full-screen office editor, inspired by Roblox Studio / Unity.
 * Left: PrefabPalette (28 prefabs, 6 categories)
 * Center: 2D SVG canvas (zone floor plan + placed prefabs)
 * Right: Properties panel (position, rotation, delete for selected prefab)
 * Bottom: Status bar
 */

import { getAllBuiltinPrefabs } from '@aics/renderer';
import type { PrefabDefinition, PrefabInstanceRow, SemanticCategory } from '@aics/shared-types';
import { ArrowLeft, Grid3X3, Minus, Plus, RotateCcw, Save, Trash2, X } from 'lucide-react';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { usePrefabInstances } from '../../hooks/usePrefabInstances.js';
import { ZONES } from '../../lib/zone-config.js';
import { useAicsRuntime } from '../../runtime/aics-runtime-context.js';
import { useCompany } from '../company/CompanyContext.js';

// ── Props ───────────────────────────────────────────────────────────

export interface OfficeEditorOverlayProps {
  open: boolean;
  onClose: () => void;
}

// ── Types ───────────────────────────────────────────────────────────

// Keep these exported for legacy compatibility
export interface ZoneLayoutProps {
  accentColor: string;
  workstationCount: number;
  displayName?: string;
  enabled?: boolean;
}
export type ZoneLayoutMap = Record<string, ZoneLayoutProps>;

interface PlacedItem {
  instanceId: string;
  prefabId: string;
  name: string;
  x: number;
  y: number;
  rotation: number;
  zoneId: string;
}

// ── SVG Layout Constants ────────────────────────────────────────────

const SVG_W = 800;
const SVG_H = 600;
const SCALE = 18; // px per 3D unit (fits 40x30 office into 720x540 with padding)
const OX = SVG_W / 2; // origin x (center of SVG)
const OY = SVG_H / 2 - 20; // origin y (slightly above center)

/** Convert 3D world coords (cx, cz) to SVG (sx, sy) */
function toSVG(cx: number, cz: number): { sx: number; sy: number } {
  return { sx: OX + cx * SCALE, sy: OY + cz * SCALE };
}

/** Zone SVG rect from zone-config */
function zoneRect(z: (typeof ZONES)[number]) {
  const { sx, sy } = toSVG(z.cx, z.cz);
  const w = z.w * SCALE;
  const h = z.d * SCALE;
  return { x: sx - w / 2, y: sy - h / 2, w, h };
}

// ── Prefab Category Metadata ────────────────────────────────────────

const CATEGORIES: { id: SemanticCategory; label: string; icon: string }[] = [
  { id: 'workspace', label: '工作台', icon: '💼' },
  { id: 'compute', label: '计算设备', icon: '🖥️' },
  { id: 'knowledge', label: '知识库', icon: '📚' },
  { id: 'collaboration', label: '协作', icon: '🤝' },
  { id: 'infrastructure', label: '基础设施', icon: '🔌' },
  { id: 'decorative', label: '装饰', icon: '🌿' },
];

// ── Prefab Icon Mapping ─────────────────────────────────────────────

function prefabIcon(category: SemanticCategory): string {
  const icons: Record<SemanticCategory, string> = {
    workspace: '⬜',
    compute: '🟦',
    knowledge: '🟫',
    collaboration: '🟪',
    infrastructure: '🟩',
    decorative: '🌿',
  };
  return icons[category] ?? '⬜';
}

function prefabColor(category: SemanticCategory): string {
  const colors: Record<SemanticCategory, string> = {
    workspace: '#3b82f6',
    compute: '#06b6d4',
    knowledge: '#10b981',
    collaboration: '#a855f7',
    infrastructure: '#f59e0b',
    decorative: '#84cc16',
  };
  return colors[category] ?? '#64748b';
}

// ── Component ───────────────────────────────────────────────────────

export function OfficeEditorOverlay({ open, onClose }: OfficeEditorOverlayProps) {
  const { repos, eventBus } = useAicsRuntime();
  const { activeCompanyId } = useCompany();
  const { instances: dbInstances, refresh } = usePrefabInstances();
  const svgRef = useRef<SVGSVGElement>(null);

  // ── State ──
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [placingPrefab, setPlacingPrefab] = useState<PrefabDefinition | null>(null);
  const [ghostPos, setGhostPos] = useState<{ x: number; y: number } | null>(null);
  const [saving, setSaving] = useState(false);
  const [collapsed, setCollapsed] = useState<Record<string, boolean>>({});

  // ── Local placed items (derived from DB instances) ──
  const [localItems, setLocalItems] = useState<PlacedItem[]>([]);
  const [dirty, setDirty] = useState(false);

  // Sync from DB when overlay opens or DB changes
  useEffect(() => {
    if (!open) return;
    const items: PlacedItem[] = dbInstances.map(({ instance, definition }) => ({
      instanceId: instance.instance_id,
      prefabId: instance.prefab_id,
      name: definition.name,
      x: instance.position_x,
      y: instance.position_y,
      rotation: instance.rotation,
      zoneId: instance.zone_id,
    }));
    setLocalItems(items);
    setDirty(false);
    setSelectedId(null);
  }, [open, dbInstances]);

  // ── Prefab catalog ──
  const grouped = useMemo(() => {
    const all = getAllBuiltinPrefabs();
    const map = new Map<SemanticCategory, PrefabDefinition[]>();
    for (const cat of CATEGORIES) map.set(cat.id, []);
    for (const prefab of all) map.get(prefab.category)?.push(prefab);
    return map;
  }, []);

  const allPrefabsMap = useMemo(() => {
    const map = new Map<string, PrefabDefinition>();
    for (const p of getAllBuiltinPrefabs()) map.set(p.prefabId, p);
    return map;
  }, []);

  // ── Selected item ──
  const selectedItem = localItems.find((it) => it.instanceId === selectedId) ?? null;

  // ── Handlers ──

  const handlePaletteClick = useCallback((def: PrefabDefinition) => {
    setPlacingPrefab((prev) => (prev?.prefabId === def.prefabId ? null : def));
    setSelectedId(null);
  }, []);

  const handleCanvasClick = useCallback(
    (e: React.PointerEvent<SVGSVGElement>) => {
      if (!placingPrefab || !svgRef.current) return;
      const rect = svgRef.current.getBoundingClientRect();
      const scaleX = SVG_W / rect.width;
      const scaleY = SVG_H / rect.height;
      const svgX = (e.clientX - rect.left) * scaleX;
      const svgY = (e.clientY - rect.top) * scaleY;
      // Convert SVG coords back to 3D world coords
      const worldX = (svgX - OX) / SCALE;
      const worldZ = (svgY - OY) / SCALE;
      // Find which zone this falls in
      let zoneId = 'dev';
      for (const z of ZONES) {
        const r = zoneRect(z);
        if (svgX >= r.x && svgX <= r.x + r.w && svgY >= r.y && svgY <= r.y + r.h) {
          zoneId = z.id;
          break;
        }
      }
      const newItem: PlacedItem = {
        instanceId: `studio-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`,
        prefabId: placingPrefab.prefabId,
        name: placingPrefab.name,
        x: Math.round(worldX * 10) / 10,
        y: Math.round(worldZ * 10) / 10,
        rotation: 0,
        zoneId,
      };
      setLocalItems((prev) => [...prev, newItem]);
      setDirty(true);
      // Stay in placement mode for rapid placement
    },
    [placingPrefab],
  );

  const handleCanvasMouseMove = useCallback(
    (e: React.MouseEvent<SVGSVGElement>) => {
      if (!placingPrefab || !svgRef.current) {
        setGhostPos(null);
        return;
      }
      const rect = svgRef.current.getBoundingClientRect();
      const scaleX = SVG_W / rect.width;
      const scaleY = SVG_H / rect.height;
      setGhostPos({
        x: (e.clientX - rect.left) * scaleX,
        y: (e.clientY - rect.top) * scaleY,
      });
    },
    [placingPrefab],
  );

  const handleSelectItem = useCallback((id: string, e: React.MouseEvent) => {
    e.stopPropagation();
    setSelectedId((prev) => (prev === id ? null : id));
    setPlacingPrefab(null);
  }, []);

  const handleDeleteSelected = useCallback(() => {
    if (!selectedId) return;
    setLocalItems((prev) => prev.filter((it) => it.instanceId !== selectedId));
    setSelectedId(null);
    setDirty(true);
  }, [selectedId]);

  const handleRotateSelected = useCallback(
    (delta: number) => {
      if (!selectedId) return;
      setLocalItems((prev) =>
        prev.map((it) =>
          it.instanceId === selectedId
            ? { ...it, rotation: (((it.rotation + delta) % 360) + 360) % 360 }
            : it,
        ),
      );
      setDirty(true);
    },
    [selectedId],
  );

  const handleMoveSelected = useCallback(
    (dx: number, dy: number) => {
      if (!selectedId) return;
      setLocalItems((prev) =>
        prev.map((it) =>
          it.instanceId === selectedId
            ? { ...it, x: Math.round((it.x + dx) * 10) / 10, y: Math.round((it.y + dy) * 10) / 10 }
            : it,
        ),
      );
      setDirty(true);
    },
    [selectedId],
  );

  const handleResetAll = useCallback(() => {
    setLocalItems([]);
    setSelectedId(null);
    setPlacingPrefab(null);
    setDirty(true);
  }, []);

  const handleSave = useCallback(async () => {
    if (!repos?.prefabInstances || !activeCompanyId) return;
    setSaving(true);
    try {
      await repos.prefabInstances.deleteByCompany(activeCompanyId);
      const now = new Date().toISOString();
      for (const item of localItems) {
        const row: PrefabInstanceRow = {
          instance_id: item.instanceId,
          company_id: activeCompanyId,
          prefab_id: item.prefabId,
          zone_id: item.zoneId,
          position_x: item.x,
          position_y: item.y,
          rotation: item.rotation as 0 | 90 | 180 | 270,
          bindings_json: null,
          config_json: null,
          enabled: 1,
          created_at: now,
          updated_at: now,
        };
        await repos.prefabInstances.create(row);
      }
      eventBus.emit({
        type: 'prefab.state.changed',
        entityId: activeCompanyId,
        entityType: 'company',
        companyId: activeCompanyId,
        timestamp: Date.now(),
        payload: { action: 'studio-saved', count: localItems.length },
      });
      setDirty(false);
      refresh();
    } finally {
      setSaving(false);
    }
  }, [repos, localItems, eventBus, refresh, activeCompanyId]);

  // Keyboard shortcuts
  useEffect(() => {
    if (!open) return;
    function handleKey(e: KeyboardEvent) {
      if (e.key === 'Escape') {
        if (placingPrefab) setPlacingPrefab(null);
        else if (selectedId) setSelectedId(null);
        else onClose();
      }
      if (e.key === 'Delete' || e.key === 'Backspace') {
        if (selectedId && !(e.target instanceof HTMLInputElement)) handleDeleteSelected();
      }
      if (e.key === 'r' || e.key === 'R') {
        if (selectedId && !(e.target instanceof HTMLInputElement)) handleRotateSelected(90);
      }
    }
    window.addEventListener('keydown', handleKey);
    return () => window.removeEventListener('keydown', handleKey);
  }, [open, placingPrefab, selectedId, handleDeleteSelected, handleRotateSelected, onClose]);

  if (!open) return null;

  return (
    <div className="fixed inset-0 z-[60] flex flex-col bg-[#020409]">
      {/* ── Top Bar ────────────────────────────────────────────── */}
      <div className="flex h-12 shrink-0 items-center justify-between border-b border-white/[0.06] px-4">
        <div className="flex items-center gap-3">
          <button
            type="button"
            onClick={onClose}
            className="flex items-center gap-1.5 rounded-lg px-2.5 py-1.5 text-white/50 hover:bg-white/[0.05] hover:text-white/80 transition-colors"
          >
            <ArrowLeft className="h-3.5 w-3.5" />
          </button>
          <div className="h-4 w-px bg-white/10" />
          <h1 className="font-mono text-xs font-black uppercase tracking-[0.25em] text-white/90">
            OFFISIM_STUDIO
          </h1>
          {dirty && (
            <span className="ml-2 rounded bg-amber-500/20 px-2 py-0.5 font-mono text-[9px] text-amber-400">
              UNSAVED
            </span>
          )}
        </div>
        <div className="flex items-center gap-2">
          <button
            type="button"
            onClick={handleResetAll}
            className="flex items-center gap-1.5 rounded-lg border border-white/10 px-3 py-1.5 font-mono text-[10px] text-white/50 hover:bg-white/[0.05] hover:text-white/70 transition-colors"
          >
            <RotateCcw className="h-3 w-3" />
            Reset
          </button>
          <button
            type="button"
            onClick={() => {
              void handleSave();
            }}
            disabled={saving || !dirty}
            className="flex items-center gap-1.5 rounded-lg border border-blue-500/40 bg-blue-600/20 px-4 py-1.5 font-mono text-[10px] font-semibold text-blue-300 hover:bg-blue-600/30 transition-colors disabled:opacity-40 disabled:cursor-not-allowed"
          >
            <Save className="h-3 w-3" />
            {saving ? 'Saving...' : 'Save'}
          </button>
        </div>
      </div>

      {/* ── Main Content ───────────────────────────────────────── */}
      <div className="flex flex-1 overflow-hidden">
        {/* ── Left: Prefab Palette ─────────────────────────────── */}
        <div className="w-56 shrink-0 border-r border-white/[0.06] bg-[#060a14] flex flex-col overflow-hidden">
          <div className="px-3 py-2.5 border-b border-white/[0.06]">
            <p className="font-mono text-[10px] font-bold uppercase tracking-[0.2em] text-zinc-500">
              PREFAB_ASSETS
            </p>
          </div>
          <div className="flex-1 overflow-y-auto custom-scrollbar">
            {CATEGORIES.map((cat) => {
              const items = grouped.get(cat.id) ?? [];
              const isCollapsed = collapsed[cat.id] ?? false;
              return (
                <div key={cat.id}>
                  <button
                    type="button"
                    onClick={() => setCollapsed((p) => ({ ...p, [cat.id]: !p[cat.id] }))}
                    className="flex w-full items-center gap-1.5 px-3 py-2 text-left font-mono text-[10px] font-semibold text-zinc-400 hover:bg-white/[0.03] transition-colors"
                  >
                    <span
                      className="text-[8px] transition-transform"
                      style={{ transform: isCollapsed ? 'rotate(-90deg)' : '' }}
                    >
                      ▼
                    </span>
                    <span>{cat.icon}</span>
                    <span className="flex-1">{cat.label}</span>
                    <span className="text-zinc-600">{items.length}</span>
                  </button>
                  {!isCollapsed &&
                    items.map((prefab) => {
                      const isActive = placingPrefab?.prefabId === prefab.prefabId;
                      return (
                        <button
                          key={prefab.prefabId}
                          type="button"
                          onClick={() => handlePaletteClick(prefab)}
                          className={`flex w-full items-center gap-2 px-3 py-1.5 pl-7 text-left transition-colors ${
                            isActive
                              ? 'bg-blue-500/15 text-blue-300 border-l-2 border-blue-500'
                              : 'text-zinc-500 hover:bg-white/[0.03] hover:text-zinc-300 border-l-2 border-transparent'
                          }`}
                        >
                          <span className="text-[10px]">{prefabIcon(prefab.category)}</span>
                          <span className="flex-1 truncate font-mono text-[10px]">
                            {prefab.name}
                          </span>
                          <span className="font-mono text-[8px] text-zinc-600">
                            {prefab.gridSize[0]}x{prefab.gridSize[1]}
                          </span>
                        </button>
                      );
                    })}
                </div>
              );
            })}
          </div>
          {placingPrefab && (
            <div className="border-t border-white/[0.06] px-3 py-2 bg-blue-500/5">
              <p className="font-mono text-[9px] text-blue-400">
                Placing: <strong>{placingPrefab.name}</strong>
              </p>
              <p className="font-mono text-[8px] text-zinc-600 mt-0.5">
                Click on canvas to place · ESC to cancel
              </p>
            </div>
          )}
        </div>

        {/* ── Center: 2D Canvas ────────────────────────────────── */}
        <div
          className="flex-1 flex items-center justify-center overflow-hidden bg-[#020409]"
          style={{ cursor: placingPrefab ? 'crosshair' : 'default' }}
        >
          <svg
            ref={svgRef}
            viewBox={`0 0 ${SVG_W} ${SVG_H}`}
            className="h-full max-h-[calc(100vh-7rem)] w-full max-w-[1000px]"
            onPointerDown={handleCanvasClick}
            onMouseMove={handleCanvasMouseMove}
            onMouseLeave={() => setGhostPos(null)}
          >
            <title>Office editor canvas</title>
            {/* Grid dots */}
            <defs>
              <pattern id="studio-grid" width="18" height="18" patternUnits="userSpaceOnUse">
                <circle cx="0.5" cy="0.5" r="0.4" fill="rgba(255,255,255,0.06)" />
              </pattern>
            </defs>
            <rect width={SVG_W} height={SVG_H} fill="url(#studio-grid)" />

            {/* Zone floor plan */}
            {ZONES.map((z) => {
              const r = zoneRect(z);
              return (
                <g key={z.id}>
                  <rect
                    x={r.x}
                    y={r.y}
                    width={r.w}
                    height={r.h}
                    rx={4}
                    fill={`${z.accent}08`}
                    stroke={`${z.accent}30`}
                    strokeWidth={1}
                  />
                  <rect
                    x={r.x}
                    y={r.y}
                    width={r.w}
                    height={2}
                    fill={z.accent}
                    opacity={0.5}
                    rx={4}
                  />
                  <text
                    x={r.x + r.w / 2}
                    y={r.y + r.h / 2}
                    textAnchor="middle"
                    dominantBaseline="middle"
                    fill={`${z.accent}40`}
                    fontSize="9"
                    fontFamily="monospace"
                    fontWeight="700"
                    letterSpacing="0.15em"
                  >
                    {z.label}
                  </text>
                </g>
              );
            })}

            {/* Placed prefabs */}
            {localItems.map((item) => {
              const def = allPrefabsMap.get(item.prefabId);
              if (!def) return null;
              const { sx, sy } = toSVG(item.x, item.y);
              const isSelected = selectedId === item.instanceId;
              const color = prefabColor(def.category);
              const halfW = (def.gridSize[0] * SCALE) / 2;
              const halfH = (def.gridSize[1] * SCALE) / 2;
              return (
                <g
                  key={item.instanceId}
                  transform={`translate(${sx}, ${sy}) rotate(${item.rotation})`}
                  onClick={(e) => handleSelectItem(item.instanceId, e)}
                  tabIndex={0}
                  aria-label={`Select ${def.name}`}
                  onKeyDown={(e) => {
                    if (e.key === 'Enter' || e.key === ' ') {
                      e.preventDefault();
                      handleSelectItem(item.instanceId, e as unknown as React.MouseEvent);
                    }
                  }}
                  style={{ cursor: 'pointer' }}
                >
                  {/* Prefab footprint */}
                  <rect
                    x={-halfW}
                    y={-halfH}
                    width={halfW * 2}
                    height={halfH * 2}
                    rx={3}
                    fill={`${color}20`}
                    stroke={isSelected ? '#3b82f6' : `${color}60`}
                    strokeWidth={isSelected ? 2 : 1}
                  />
                  {/* Direction indicator */}
                  <line
                    x1={0}
                    y1={-halfH}
                    x2={0}
                    y2={-halfH - 4}
                    stroke={color}
                    strokeWidth={2}
                    opacity={0.6}
                  />
                  {/* Label */}
                  <text
                    x={0}
                    y={3}
                    textAnchor="middle"
                    dominantBaseline="middle"
                    fill={color}
                    fontSize="7"
                    fontFamily="monospace"
                    fontWeight="600"
                  >
                    {def.name.split(' ')[0]}
                  </text>
                  {/* Selection handles */}
                  {isSelected && (
                    <>
                      <rect
                        x={-halfW - 1}
                        y={-halfH - 1}
                        width={halfW * 2 + 2}
                        height={halfH * 2 + 2}
                        rx={3}
                        fill="none"
                        stroke="#3b82f6"
                        strokeWidth={1.5}
                        strokeDasharray="3 2"
                      />
                      {[
                        [-halfW, -halfH],
                        [halfW, -halfH],
                        [-halfW, halfH],
                        [halfW, halfH],
                      ].map(([cx, cy]) => (
                        <circle key={`${cx}-${cy}`} cx={cx} cy={cy} r={2.5} fill="#3b82f6" />
                      ))}
                    </>
                  )}
                </g>
              );
            })}

            {/* Ghost preview during placement */}
            {placingPrefab && ghostPos && (
              <g
                transform={`translate(${ghostPos.x}, ${ghostPos.y})`}
                style={{ pointerEvents: 'none' }}
              >
                <rect
                  x={-(placingPrefab.gridSize[0] * SCALE) / 2}
                  y={-(placingPrefab.gridSize[1] * SCALE) / 2}
                  width={placingPrefab.gridSize[0] * SCALE}
                  height={placingPrefab.gridSize[1] * SCALE}
                  rx={3}
                  fill={`${prefabColor(placingPrefab.category)}15`}
                  stroke={prefabColor(placingPrefab.category)}
                  strokeWidth={1.5}
                  strokeDasharray="4 3"
                />
                <text
                  x={0}
                  y={3}
                  textAnchor="middle"
                  dominantBaseline="middle"
                  fill={prefabColor(placingPrefab.category)}
                  fontSize="7"
                  fontFamily="monospace"
                  opacity={0.7}
                >
                  {placingPrefab.name.split(' ')[0]}
                </text>
              </g>
            )}
          </svg>
        </div>

        {/* ── Right: Properties Panel ──────────────────────────── */}
        <div
          className={`shrink-0 border-l border-white/[0.06] bg-[#060a14] flex flex-col transition-all duration-200 overflow-hidden ${
            selectedItem ? 'w-64 opacity-100' : 'w-0 opacity-0 border-l-0'
          }`}
        >
          {selectedItem &&
            (() => {
              const def = allPrefabsMap.get(selectedItem.prefabId);
              return (
                <>
                  <div className="flex items-center justify-between border-b border-white/[0.06] px-4 py-3">
                    <h2 className="font-mono text-[10px] font-bold uppercase tracking-[0.15em] text-zinc-400">
                      PROPERTIES
                    </h2>
                    <button
                      type="button"
                      onClick={() => setSelectedId(null)}
                      className="rounded p-1 text-zinc-600 hover:bg-white/[0.06] hover:text-zinc-400 transition-colors"
                    >
                      <X className="h-3.5 w-3.5" />
                    </button>
                  </div>
                  <div className="flex-1 overflow-y-auto p-4 space-y-4">
                    {/* Name */}
                    <div>
                      <p className="font-mono text-[9px] text-zinc-600 uppercase tracking-wider mb-1">
                        Name
                      </p>
                      <p className="font-mono text-xs text-zinc-200">
                        {def?.name ?? selectedItem.prefabId}
                      </p>
                      {def && (
                        <p className="font-mono text-[9px] text-zinc-600 mt-0.5">
                          {def.category} · {def.gridSize[0]}x{def.gridSize[1]}
                        </p>
                      )}
                    </div>

                    {/* Position */}
                    <div>
                      <p className="font-mono text-[9px] text-zinc-600 uppercase tracking-wider mb-2">
                        Position
                      </p>
                      <div className="grid grid-cols-2 gap-2">
                        <div>
                          <span className="font-mono text-[8px] text-zinc-600">X</span>
                          <div className="flex items-center gap-1 mt-0.5">
                            <button
                              type="button"
                              onClick={() => handleMoveSelected(-1, 0)}
                              className="rounded bg-white/[0.06] p-1 text-zinc-500 hover:bg-white/[0.1] hover:text-zinc-300"
                            >
                              <Minus className="h-2.5 w-2.5" />
                            </button>
                            <span className="flex-1 text-center font-mono text-[10px] text-zinc-300">
                              {selectedItem.x}
                            </span>
                            <button
                              type="button"
                              onClick={() => handleMoveSelected(1, 0)}
                              className="rounded bg-white/[0.06] p-1 text-zinc-500 hover:bg-white/[0.1] hover:text-zinc-300"
                            >
                              <Plus className="h-2.5 w-2.5" />
                            </button>
                          </div>
                        </div>
                        <div>
                          <span className="font-mono text-[8px] text-zinc-600">Y</span>
                          <div className="flex items-center gap-1 mt-0.5">
                            <button
                              type="button"
                              onClick={() => handleMoveSelected(0, -1)}
                              className="rounded bg-white/[0.06] p-1 text-zinc-500 hover:bg-white/[0.1] hover:text-zinc-300"
                            >
                              <Minus className="h-2.5 w-2.5" />
                            </button>
                            <span className="flex-1 text-center font-mono text-[10px] text-zinc-300">
                              {selectedItem.y}
                            </span>
                            <button
                              type="button"
                              onClick={() => handleMoveSelected(0, 1)}
                              className="rounded bg-white/[0.06] p-1 text-zinc-500 hover:bg-white/[0.1] hover:text-zinc-300"
                            >
                              <Plus className="h-2.5 w-2.5" />
                            </button>
                          </div>
                        </div>
                      </div>
                    </div>

                    {/* Rotation */}
                    <div>
                      <p className="font-mono text-[9px] text-zinc-600 uppercase tracking-wider mb-2">
                        Rotation
                      </p>
                      <div className="flex items-center gap-2">
                        <button
                          type="button"
                          onClick={() => handleRotateSelected(-90)}
                          className="rounded border border-white/10 bg-white/[0.04] px-2.5 py-1.5 font-mono text-[10px] text-zinc-400 hover:bg-white/[0.08] hover:text-zinc-200 transition-colors"
                        >
                          -90°
                        </button>
                        <span className="flex-1 text-center font-mono text-xs text-zinc-300">
                          {selectedItem.rotation}°
                        </span>
                        <button
                          type="button"
                          onClick={() => handleRotateSelected(90)}
                          className="rounded border border-white/10 bg-white/[0.04] px-2.5 py-1.5 font-mono text-[10px] text-zinc-400 hover:bg-white/[0.08] hover:text-zinc-200 transition-colors"
                        >
                          +90°
                        </button>
                      </div>
                    </div>

                    {/* Zone */}
                    <div>
                      <p className="font-mono text-[9px] text-zinc-600 uppercase tracking-wider mb-1">
                        Zone
                      </p>
                      <p className="font-mono text-[10px] text-zinc-400">
                        {ZONES.find((z) => z.id === selectedItem.zoneId)?.label ??
                          selectedItem.zoneId}
                      </p>
                    </div>

                    {/* Delete */}
                    <button
                      type="button"
                      onClick={handleDeleteSelected}
                      className="w-full flex items-center justify-center gap-1.5 rounded-lg border border-red-500/30 bg-red-600/10 px-3 py-2 font-mono text-[10px] text-red-400 hover:bg-red-600/20 transition-colors"
                    >
                      <Trash2 className="h-3 w-3" />
                      Delete Prefab
                    </button>
                  </div>

                  {/* Keyboard hints */}
                  <div className="border-t border-white/[0.06] px-4 py-2">
                    <p className="font-mono text-[8px] text-zinc-700">
                      R: Rotate · Del: Delete · Esc: Deselect
                    </p>
                  </div>
                </>
              );
            })()}
        </div>
      </div>

      {/* ── Bottom Status Bar ──────────────────────────────────── */}
      <div className="flex h-8 shrink-0 items-center justify-between border-t border-white/[0.06] px-4">
        <p className="font-mono text-[9px] text-zinc-600">
          {localItems.length} prefabs placed
          {placingPrefab && ` · Placing: ${placingPrefab.name}`}
        </p>
        <p className="font-mono text-[9px] text-zinc-700">
          <Grid3X3 className="inline h-3 w-3 mr-1" />
          Grid: {SCALE}px/unit
        </p>
      </div>
    </div>
  );
}
