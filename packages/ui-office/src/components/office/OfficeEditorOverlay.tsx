/**
 * OfficeEditorOverlay — "Offisim Studio" (Zone Mode)
 *
 * Full-screen office editor where users place pre-furnished zone presets.
 * Left:   Zone palette (11 presets grouped by archetype + "Create Custom Zone")
 * Center: 2D SVG canvas showing zones with furniture inside
 * Right:  Properties panel for selected zone
 * Bottom: Status bar
 *
 * Zones can be dragged on the canvas. Each zone comes with furniture
 * pre-arranged inside. Users can also create empty custom zones.
 */

import { getAllBuiltinPrefabs } from '@aics/renderer';
import type {
  ActivityType,
  PrefabDefinition,

  RoleSlug,
  SemanticCategory,
  ZoneArchetype,
  ZoneKind,
  ZonePreset,
} from '@aics/shared-types';
import { ZONE_PRESET_GROUPS } from '@aics/shared-types';
import { dehydrateZone } from '@aics/core/browser';
import { ArrowLeft, Grid3X3, Minus, Plus, RotateCcw, Save, Trash2, X } from 'lucide-react';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useCompanyZones } from '../../hooks/useCompanyZones.js';
import { usePrefabInstances } from '../../hooks/usePrefabInstances.js';
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

/** A zone placed on the editor canvas. */
interface EditorZone {
  id: string;
  kind: ZoneKind;
  presetId: string | null;
  label: string;
  archetype: ZoneArchetype | null;
  accentColor: string;
  floorColor: number;
  cx: number;
  cz: number;
  w: number;
  d: number;
  deskSlots: number;
  targetRoles: RoleSlug[];
  allowedCategories: SemanticCategory[];
  activityTypes: ActivityType[];
}

/** A prefab instance placed inside a zone. */
interface PlacedItem {
  instanceId: string;
  prefabId: string;
  name: string;
  x: number;
  y: number;
  rotation: number;
  zoneId: string;
}

/** Drag state for zone repositioning. */
interface DragState {
  zoneId: string;
  startMouseX: number;
  startMouseY: number;
  startCx: number;
  startCz: number;
  startItemPositions: Map<string, { x: number; y: number }>;
}

// ── SVG Layout Constants ────────────────────────────────────────────

const SVG_W = 800;
const SVG_H = 600;
const SCALE = 18;
const OX = SVG_W / 2;
const OY = SVG_H / 2 - 20;

function toSVG(cx: number, cz: number): { sx: number; sy: number } {
  return { sx: OX + cx * SCALE, sy: OY + cz * SCALE };
}

function fromSVG(sx: number, sy: number): { wx: number; wz: number } {
  return { wx: (sx - OX) / SCALE, wz: (sy - OY) / SCALE };
}

function editorZoneRect(z: EditorZone) {
  const { sx, sy } = toSVG(z.cx, z.cz);
  const w = z.w * SCALE;
  const h = z.d * SCALE;
  return { x: sx - w / 2, y: sy - h / 2, w, h };
}

// ── Prefab helpers ──────────────────────────────────────────────────

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

// ── Create zone + items from preset ─────────────────────────────────

function spawnFromPreset(
  preset: ZonePreset,
  cx: number,
  cz: number,
  allPrefabsMap: Map<string, PrefabDefinition>,
): { zone: EditorZone; items: PlacedItem[] } {
  const zoneId = crypto.randomUUID();
  const zone: EditorZone = {
    id: zoneId,
    kind: 'system',
    presetId: preset.id,
    label: preset.label,
    archetype: preset.archetype,
    accentColor: preset.accentColor,
    floorColor: preset.floorColor,
    cx,
    cz,
    w: preset.w,
    d: preset.d,
    deskSlots: preset.deskSlots,
    targetRoles: [...preset.targetRoles],
    allowedCategories: [...preset.allowedCategories],
    activityTypes: [...preset.activityTypes],
  };
  const items: PlacedItem[] = [];
  for (const p of preset.prefabs) {
    const def = allPrefabsMap.get(p.prefabId);
    if (!def) continue;
    items.push({
      instanceId: crypto.randomUUID(),
      prefabId: p.prefabId,
      name: def.name,
      x: Math.round((cx + p.offsetX) * 10) / 10,
      y: Math.round((cz + p.offsetZ) * 10) / 10,
      rotation: p.rotation ?? 0,
      zoneId,
    });
  }
  return { zone, items };
}

// ── Component ───────────────────────────────────────────────────────

export function OfficeEditorOverlay({ open, onClose }: OfficeEditorOverlayProps) {
  const { repos, eventBus } = useAicsRuntime();
  const { activeCompanyId } = useCompany();
  const { zones: dbZones, refresh: refreshZones } = useCompanyZones();
  const { instances: dbInstances, refresh: refreshPrefabs } = usePrefabInstances();
  const svgRef = useRef<SVGSVGElement>(null);

  // ── State ──
  const [editorZones, setEditorZones] = useState<EditorZone[]>([]);
  const [localItems, setLocalItems] = useState<PlacedItem[]>([]);
  const [selectedZoneId, setSelectedZoneId] = useState<string | null>(null);
  const [placingPreset, setPlacingPreset] = useState<ZonePreset | null>(null);
  const [ghostPos, setGhostPos] = useState<{ x: number; y: number } | null>(null);
  const [drag, setDrag] = useState<DragState | null>(null);
  const [saving, setSaving] = useState(false);
  const [dirty, setDirty] = useState(false);
  const [collapsed, setCollapsed] = useState<Record<string, boolean>>({});
  const [showCustomForm, setShowCustomForm] = useState(false);
  const [customLabel, setCustomLabel] = useState('Custom Zone');
  const [customArchetype, setCustomArchetype] = useState<ZoneArchetype>('workspace');

  // ── Prefab catalog map ──
  const allPrefabsMap = useMemo(() => {
    const map = new Map<string, PrefabDefinition>();
    for (const p of getAllBuiltinPrefabs()) map.set(p.prefabId, p);
    return map;
  }, []);

  // Only sync from DB on initial open — not on subsequent refreshes (which would overwrite edits)
  const syncedRef = useRef(false);
  useEffect(() => {
    if (!open) { syncedRef.current = false; return; }
    if (syncedRef.current) return;
    syncedRef.current = true;

    const ezones: EditorZone[] = dbZones.map((z) => ({
      id: z.zoneId,
      kind: z.kind,
      presetId: null,
      label: z.label,
      archetype: z.archetype,
      accentColor: z.accentColor,
      floorColor: z.floorColor,
      cx: z.cx,
      cz: z.cz,
      w: z.w,
      d: z.d,
      deskSlots: z.deskSlots,
      targetRoles: [...z.targetRoles],
      allowedCategories: [...z.allowedCategories],
      activityTypes: [...z.activityTypes],
    }));

    // Convert DB prefab instances to PlacedItems
    const items: PlacedItem[] = dbInstances.map(({ instance, definition }) => ({
      instanceId: instance.instance_id,
      prefabId: instance.prefab_id,
      name: definition.name,
      x: instance.position_x,
      y: instance.position_y,
      rotation: instance.rotation,
      zoneId: instance.zone_id,
    }));

    setEditorZones(ezones);
    setLocalItems(items);
    setDirty(false);
    setSelectedZoneId(null);
    setPlacingPreset(null);
    setDrag(null);
  }, [open, dbZones, dbInstances]);

  const selectedZone = useMemo(
    () => editorZones.find((z) => z.id === selectedZoneId) ?? null,
    [editorZones, selectedZoneId],
  );

  // Items grouped by zone — avoids O(zones x items) filter in render loop
  const itemsByZone = useMemo(() => {
    const m = new Map<string, PlacedItem[]>();
    for (const it of localItems) {
      let arr = m.get(it.zoneId);
      if (!arr) { arr = []; m.set(it.zoneId, arr); }
      arr.push(it);
    }
    return m;
  }, [localItems]);

  // ── SVG coord helpers ──
  const svgCoords = useCallback(
    (e: React.MouseEvent): { svgX: number; svgY: number } => {
      if (!svgRef.current) return { svgX: 0, svgY: 0 };
      const rect = svgRef.current.getBoundingClientRect();
      const scaleX = SVG_W / rect.width;
      const scaleY = SVG_H / rect.height;
      return {
        svgX: (e.clientX - rect.left) * scaleX,
        svgY: (e.clientY - rect.top) * scaleY,
      };
    },
    [],
  );

  // ── Zone palette click ──
  const handlePresetClick = useCallback((preset: ZonePreset) => {
    setPlacingPreset((prev) => (prev?.id === preset.id ? null : preset));
    setSelectedZoneId(null);
    setShowCustomForm(false);
  }, []);

  // ── Canvas click — place zone ──
  const handleCanvasClick = useCallback(
    (e: React.PointerEvent<SVGSVGElement>) => {
      // Don't place if dragging
      if (drag) return;

      if (!placingPreset) {
        // Clicking empty space deselects
        setSelectedZoneId(null);
        return;
      }

      const { svgX, svgY } = svgCoords(e);
      const { wx, wz } = fromSVG(svgX, svgY);
      const { zone, items } = spawnFromPreset(
        placingPreset,
        Math.round(wx * 2) / 2,
        Math.round(wz * 2) / 2,
        allPrefabsMap,
      );

      setEditorZones((prev) => [...prev, zone]);
      setLocalItems((prev) => [...prev, ...items]);
      setDirty(true);
    },
    [placingPreset, drag, svgCoords, allPrefabsMap],
  );

  // ── Ghost preview ──
  const handleCanvasMouseMove = useCallback(
    (e: React.MouseEvent<SVGSVGElement>) => {
      if (drag) {
        const { svgX, svgY } = svgCoords(e);
        const newCx = Math.round((drag.startCx + (svgX - drag.startMouseX) / SCALE) * 2) / 2;
        const newCz = Math.round((drag.startCz + (svgY - drag.startMouseY) / SCALE) * 2) / 2;
        const dx = newCx - drag.startCx;
        const dz = newCz - drag.startCz;

        setEditorZones((prev) =>
          prev.map((z) => (z.id === drag.zoneId ? { ...z, cx: newCx, cz: newCz } : z)),
        );
        setLocalItems((prev) =>
          prev.map((it) => {
            if (it.zoneId !== drag.zoneId) return it;
            const start = drag.startItemPositions.get(it.instanceId);
            if (!start) return it;
            return {
              ...it,
              x: Math.round((start.x + dx) * 10) / 10,
              y: Math.round((start.y + dz) * 10) / 10,
            };
          }),
        );
        setDirty(true);
        return;
      }

      if (!placingPreset) {
        setGhostPos(null);
        return;
      }
      const { svgX, svgY } = svgCoords(e);
      setGhostPos({ x: svgX, y: svgY });
    },
    [placingPreset, drag, svgCoords],
  );

  // Refs for stable drag-start callback (avoids re-creating on every zone/item change)
  const editorZonesRef = useRef(editorZones);
  const localItemsRef = useRef(localItems);
  useEffect(() => { editorZonesRef.current = editorZones; }, [editorZones]);
  useEffect(() => { localItemsRef.current = localItems; }, [localItems]);

  const handleZonePointerDown = useCallback(
    (zoneId: string, e: React.PointerEvent) => {
      if (placingPreset) return;
      e.stopPropagation();
      const { svgX, svgY } = svgCoords(e);
      const zone = editorZonesRef.current.find((z) => z.id === zoneId);
      if (!zone) return;
      const startItemPositions = new Map<string, { x: number; y: number }>();
      for (const it of localItemsRef.current) {
        if (it.zoneId === zoneId) startItemPositions.set(it.instanceId, { x: it.x, y: it.y });
      }
      setSelectedZoneId(zoneId);
      setDrag({ zoneId, startMouseX: svgX, startMouseY: svgY, startCx: zone.cx, startCz: zone.cz, startItemPositions });
    },
    [placingPreset, svgCoords],
  );

  // ── Drag end ──
  const handleCanvasPointerUp = useCallback(() => {
    if (drag) {
      setDrag(null);
    }
  }, [drag]);

  // ── Delete selected zone ──
  const handleDeleteZone = useCallback(() => {
    if (!selectedZoneId) return;
    setEditorZones((prev) => prev.filter((z) => z.id !== selectedZoneId));
    setLocalItems((prev) => prev.filter((it) => it.zoneId !== selectedZoneId));
    setSelectedZoneId(null);
    setDirty(true);
  }, [selectedZoneId]);

  // ── Move zone ──
  const handleMoveZone = useCallback(
    (dx: number, dz: number) => {
      if (!selectedZoneId) return;
      setEditorZones((prev) =>
        prev.map((z) =>
          z.id === selectedZoneId
            ? { ...z, cx: Math.round((z.cx + dx) * 2) / 2, cz: Math.round((z.cz + dz) * 2) / 2 }
            : z,
        ),
      );
      setLocalItems((prev) =>
        prev.map((it) =>
          it.zoneId === selectedZoneId
            ? {
                ...it,
                x: Math.round((it.x + dx) * 10) / 10,
                y: Math.round((it.y + dz) * 10) / 10,
              }
            : it,
        ),
      );
      setDirty(true);
    },
    [selectedZoneId],
  );

  // ── Update zone label ──
  const handleLabelChange = useCallback(
    (label: string) => {
      if (!selectedZoneId) return;
      setEditorZones((prev) =>
        prev.map((z) => (z.id === selectedZoneId ? { ...z, label } : z)),
      );
      setDirty(true);
    },
    [selectedZoneId],
  );

  // ── Create custom zone ──
  const handleCreateCustom = useCallback(() => {
    const zone: EditorZone = {
      id: crypto.randomUUID(),
      kind: 'custom',
      presetId: null,
      label: customLabel,
      archetype: customArchetype,
      accentColor: '#64748b',
      floorColor: 0x334155,
      cx: 0,
      cz: 0,
      w: 10,
      d: 8,
      deskSlots: 0,
      targetRoles: [],
      allowedCategories: [],
      activityTypes: [],
    };
    setEditorZones((prev) => [...prev, zone]);
    setDirty(true);
    setShowCustomForm(false);
    setCustomLabel('Custom Zone');
  }, [customLabel, customArchetype]);

  // ── Reset all ──
  const handleResetAll = useCallback(() => {
    setEditorZones([]);
    setLocalItems([]);
    setSelectedZoneId(null);
    setPlacingPreset(null);
    setDrag(null);
    setDirty(true);
  }, []);

  // ── Save ──
  const handleSave = useCallback(async () => {
    if (!repos || !activeCompanyId) return;
    setSaving(true);
    try {
      // Delete existing zones and prefab instances
      await repos.prefabInstances.deleteByCompany(activeCompanyId);
      await repos.zones.deleteByCompany(activeCompanyId);

      const now = new Date().toISOString();

      for (let i = 0; i < editorZones.length; i++) {
        const ez = editorZones[i]!;
        const zoneId = `${activeCompanyId}::zone-${crypto.randomUUID()}`;
        const dehydrated = dehydrateZone({
          zoneId,
          companyId: activeCompanyId,
          kind: ez.kind,
          archetype: ez.archetype,
          label: ez.label,
          accentColor: ez.accentColor,
          floorColor: ez.floorColor,
          cx: ez.cx,
          cz: ez.cz,
          w: ez.w,
          d: ez.d,
          targetRoles: ez.targetRoles,
          allowedCategories: ez.allowedCategories,
          activityTypes: ez.activityTypes,
          deskSlots: ez.deskSlots,
          sortOrder: i,
        });
        const created = await repos.zones.create(dehydrated);
        const savedZoneId = created.zone_id;

        const zoneItems = localItems.filter((item) => item.zoneId === ez.id);
        await Promise.all(
          zoneItems.map((item) =>
            repos.prefabInstances.create({
              instance_id: `pi-${savedZoneId}-${item.instanceId}`,
              company_id: activeCompanyId,
              prefab_id: item.prefabId,
              zone_id: savedZoneId,
              position_x: item.x,
              position_y: item.y,
              rotation: item.rotation as 0 | 90 | 180 | 270,
              bindings_json: null,
              config_json: null,
              enabled: 1,
              created_at: now,
              updated_at: now,
            }),
          ),
        );
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
      refreshZones();
      refreshPrefabs();
    } finally {
      setSaving(false);
    }
  }, [repos, activeCompanyId, editorZones, localItems, eventBus, refreshZones, refreshPrefabs]);

  // ── Keyboard shortcuts ──
  useEffect(() => {
    if (!open) return;
    function handleKey(e: KeyboardEvent) {
      if (e.target instanceof HTMLInputElement) return;
      if (e.key === 'Escape') {
        if (placingPreset) setPlacingPreset(null);
        else if (selectedZoneId) setSelectedZoneId(null);
        else onClose();
      }
      if (e.key === 'Delete' || e.key === 'Backspace') {
        if (selectedZoneId) handleDeleteZone();
      }
    }
    window.addEventListener('keydown', handleKey);
    return () => window.removeEventListener('keydown', handleKey);
  }, [open, placingPreset, selectedZoneId, handleDeleteZone, onClose]);

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
          <span className="rounded bg-white/[0.06] px-2 py-0.5 font-mono text-[9px] text-zinc-500">
            ZONE MODE
          </span>
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
        {/* ── Left: Zone Palette ──────────────────────────────── */}
        <div className="w-56 shrink-0 border-r border-white/[0.06] bg-[#060a14] flex flex-col overflow-hidden">
          <div className="px-3 py-2.5 border-b border-white/[0.06]">
            <p className="font-mono text-[10px] font-bold uppercase tracking-[0.2em] text-zinc-500">
              ZONE_PRESETS
            </p>
          </div>
          <div className="flex-1 overflow-y-auto custom-scrollbar">
            {ZONE_PRESET_GROUPS.map((group) => {
              const isCollapsed = collapsed[group.archetype] ?? false;
              return (
                <div key={group.archetype}>
                  <button
                    type="button"
                    onClick={() =>
                      setCollapsed((p) => ({ ...p, [group.archetype]: !p[group.archetype] }))
                    }
                    className="flex w-full items-center gap-1.5 px-3 py-2 text-left font-mono text-[10px] font-semibold text-zinc-400 hover:bg-white/[0.03] transition-colors"
                  >
                    <span
                      className="text-[8px] transition-transform"
                      style={{ transform: isCollapsed ? 'rotate(-90deg)' : '' }}
                    >
                      ▼
                    </span>
                    <span>{group.icon}</span>
                    <span className="flex-1">{group.label}</span>
                    <span className="text-zinc-600">{group.presets.length}</span>
                  </button>
                  {!isCollapsed &&
                    group.presets.map((preset) => {
                      const isActive = placingPreset?.id === preset.id;
                      return (
                        <button
                          key={preset.id}
                          type="button"
                          onClick={() => handlePresetClick(preset)}
                          className={`flex w-full items-center gap-2 px-3 py-2 pl-7 text-left transition-colors ${
                            isActive
                              ? 'bg-blue-500/15 text-blue-300 border-l-2 border-blue-500'
                              : 'text-zinc-500 hover:bg-white/[0.03] hover:text-zinc-300 border-l-2 border-transparent'
                          }`}
                        >
                          <span
                            className="h-2.5 w-2.5 rounded-sm shrink-0"
                            style={{ backgroundColor: preset.accentColor }}
                          />
                          <div className="flex-1 min-w-0">
                            <span className="block truncate font-mono text-[10px]">
                              {preset.label}
                            </span>
                            <span className="block font-mono text-[8px] text-zinc-600">
                              {preset.w}x{preset.d} · {preset.prefabs.length} items
                            </span>
                          </div>
                        </button>
                      );
                    })}
                </div>
              );
            })}

            {/* Create Custom Zone */}
            <div className="border-t border-white/[0.06] mt-1 pt-1">
              <button
                type="button"
                onClick={() => {
                  setShowCustomForm((v) => !v);
                  setPlacingPreset(null);
                }}
                className="flex w-full items-center gap-2 px-3 py-2 text-left font-mono text-[10px] text-zinc-400 hover:bg-white/[0.03] hover:text-zinc-200 transition-colors"
              >
                <Plus className="h-3 w-3" />
                <span>Create Custom Zone</span>
              </button>
              {showCustomForm && (
                <div className="px-3 pb-2 space-y-2">
                  <input
                    type="text"
                    value={customLabel}
                    onChange={(e) => setCustomLabel(e.target.value)}
                    placeholder="Zone name..."
                    className="w-full rounded border border-white/10 bg-white/[0.04] px-2 py-1 font-mono text-[10px] text-zinc-200 outline-none focus:border-blue-500/50"
                  />
                  <select
                    value={customArchetype}
                    onChange={(e) => setCustomArchetype(e.target.value as ZoneArchetype)}
                    className="w-full rounded border border-white/10 bg-white/[0.04] px-2 py-1 font-mono text-[10px] text-zinc-200 outline-none focus:border-blue-500/50"
                  >
                    <option value="workspace">Workspace</option>
                    <option value="meeting">Meeting</option>
                    <option value="library">Library</option>
                    <option value="rest">Rest Area</option>
                    <option value="server">Server</option>
                  </select>
                  <button
                    type="button"
                    onClick={handleCreateCustom}
                    className="w-full rounded border border-blue-500/30 bg-blue-600/15 py-1.5 font-mono text-[10px] text-blue-300 hover:bg-blue-600/25 transition-colors"
                  >
                    Add to Canvas
                  </button>
                </div>
              )}
            </div>
          </div>

          {/* Placement hint */}
          {placingPreset && (
            <div className="border-t border-white/[0.06] px-3 py-2 bg-blue-500/5">
              <p className="font-mono text-[9px] text-blue-400">
                Placing: <strong>{placingPreset.label}</strong>
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
          style={{ cursor: placingPreset ? 'crosshair' : drag ? 'grabbing' : 'default' }}
        >
          <svg
            ref={svgRef}
            viewBox={`0 0 ${SVG_W} ${SVG_H}`}
            className="h-full max-h-[calc(100vh-7rem)] w-full max-w-[1000px]"
            onPointerDown={handleCanvasClick}
            onMouseMove={handleCanvasMouseMove}
            onPointerUp={handleCanvasPointerUp}
            onMouseLeave={() => {
              setGhostPos(null);
              if (drag) setDrag(null);
            }}
          >
            <title>Office editor canvas</title>
            {/* Grid dots */}
            <defs>
              <pattern id="studio-grid" width="18" height="18" patternUnits="userSpaceOnUse">
                <circle cx="0.5" cy="0.5" r="0.4" fill="rgba(255,255,255,0.06)" />
              </pattern>
            </defs>
            <rect width={SVG_W} height={SVG_H} fill="url(#studio-grid)" />

            {/* Zones with furniture inside */}
            {editorZones.map((z) => {
              const r = editorZoneRect(z);
              const isSelected = selectedZoneId === z.id;
              const isDragging = drag?.zoneId === z.id;
              const zoneItems = itemsByZone.get(z.id) ?? [];

              return (
                <g key={z.id}>
                  {/* Zone background */}
                  <rect
                    x={r.x}
                    y={r.y}
                    width={r.w}
                    height={r.h}
                    rx={4}
                    fill={`${z.accentColor}12`}
                    stroke={
                      isSelected
                        ? z.accentColor
                        : `${z.accentColor}30`
                    }
                    strokeWidth={isSelected ? 2 : 1}
                    strokeDasharray={isDragging ? '4 2' : undefined}
                    style={{ cursor: placingPreset ? 'crosshair' : 'grab' }}
                    onPointerDown={(e) => handleZonePointerDown(z.id, e)}
                  />
                  {/* Top accent bar */}
                  <rect
                    x={r.x}
                    y={r.y}
                    width={r.w}
                    height={2.5}
                    fill={z.accentColor}
                    opacity={isSelected ? 0.8 : 0.5}
                    rx={4}
                    style={{ pointerEvents: 'none' }}
                  />
                  {/* Zone label */}
                  <text
                    x={r.x + 6}
                    y={r.y + 12}
                    fill={z.accentColor}
                    fontSize="8"
                    fontFamily="monospace"
                    fontWeight="700"
                    letterSpacing="0.1em"
                    opacity={0.7}
                    style={{ pointerEvents: 'none' }}
                  >
                    {z.label.toUpperCase()}
                  </text>
                  {/* Zone size hint */}
                  <text
                    x={r.x + r.w - 6}
                    y={r.y + 12}
                    textAnchor="end"
                    fill={`${z.accentColor}40`}
                    fontSize="7"
                    fontFamily="monospace"
                    style={{ pointerEvents: 'none' }}
                  >
                    {z.w}x{z.d}
                  </text>

                  {/* Furniture inside zone */}
                  {zoneItems.map((item) => {
                    const def = allPrefabsMap.get(item.prefabId);
                    if (!def) return null;
                    const { sx, sy } = toSVG(item.x, item.y);
                    const color = prefabColor(def.category);
                    const halfW = (def.gridSize[0] * SCALE) / 2;
                    const halfH = (def.gridSize[1] * SCALE) / 2;
                    return (
                      <g
                        key={item.instanceId}
                        transform={`translate(${sx}, ${sy}) rotate(${item.rotation})`}
                        style={{ pointerEvents: 'none' }}
                      >
                        <rect
                          x={-halfW}
                          y={-halfH}
                          width={halfW * 2}
                          height={halfH * 2}
                          rx={2}
                          fill={`${color}18`}
                          stroke={`${color}50`}
                          strokeWidth={0.8}
                        />
                        <line
                          x1={0}
                          y1={-halfH}
                          x2={0}
                          y2={-halfH - 3}
                          stroke={color}
                          strokeWidth={1.5}
                          opacity={0.4}
                        />
                        <text
                          x={0}
                          y={2}
                          textAnchor="middle"
                          dominantBaseline="middle"
                          fill={color}
                          fontSize="6"
                          fontFamily="monospace"
                          fontWeight="500"
                          opacity={0.7}
                        >
                          {def.name.split(' ')[0]}
                        </text>
                      </g>
                    );
                  })}

                  {/* Selection handles */}
                  {isSelected && (
                    <>
                      <rect
                        x={r.x - 1}
                        y={r.y - 1}
                        width={r.w + 2}
                        height={r.h + 2}
                        rx={5}
                        fill="none"
                        stroke={z.accentColor}
                        strokeWidth={1.5}
                        strokeDasharray="4 3"
                        style={{ pointerEvents: 'none' }}
                      />
                      {/* Drag handle indicator */}
                      <g
                        transform={`translate(${r.x + r.w / 2}, ${r.y + r.h + 8})`}
                        style={{ pointerEvents: 'none' }}
                      >
                        <rect
                          x={-16}
                          y={-5}
                          width={32}
                          height={10}
                          rx={5}
                          fill={z.accentColor}
                          opacity={0.2}
                        />
                        <text
                          x={0}
                          y={1}
                          textAnchor="middle"
                          dominantBaseline="middle"
                          fill={z.accentColor}
                          fontSize="6"
                          fontFamily="monospace"
                          fontWeight="600"
                          opacity={0.6}
                        >
                          DRAG
                        </text>
                      </g>
                      {/* Corner handles */}
                      {[
                        [r.x, r.y],
                        [r.x + r.w, r.y],
                        [r.x, r.y + r.h],
                        [r.x + r.w, r.y + r.h],
                      ].map(([cx, cy]) => (
                        <circle
                          key={`${cx}-${cy}`}
                          cx={cx}
                          cy={cy}
                          r={3}
                          fill={z.accentColor}
                          opacity={0.6}
                          style={{ pointerEvents: 'none' }}
                        />
                      ))}
                    </>
                  )}
                </g>
              );
            })}

            {/* Ghost preview for zone placement */}
            {placingPreset && ghostPos && (
              <g
                transform={`translate(${ghostPos.x}, ${ghostPos.y})`}
                style={{ pointerEvents: 'none' }}
              >
                <rect
                  x={-(placingPreset.w * SCALE) / 2}
                  y={-(placingPreset.d * SCALE) / 2}
                  width={placingPreset.w * SCALE}
                  height={placingPreset.d * SCALE}
                  rx={4}
                  fill={`${placingPreset.accentColor}10`}
                  stroke={placingPreset.accentColor}
                  strokeWidth={1.5}
                  strokeDasharray="6 4"
                />
                {/* Ghost label */}
                <text
                  x={0}
                  y={0}
                  textAnchor="middle"
                  dominantBaseline="middle"
                  fill={placingPreset.accentColor}
                  fontSize="9"
                  fontFamily="monospace"
                  fontWeight="700"
                  opacity={0.5}
                >
                  {placingPreset.label.toUpperCase()}
                </text>
                {/* Ghost size */}
                <text
                  x={0}
                  y={12}
                  textAnchor="middle"
                  dominantBaseline="middle"
                  fill={placingPreset.accentColor}
                  fontSize="7"
                  fontFamily="monospace"
                  opacity={0.4}
                >
                  {placingPreset.w}x{placingPreset.d} · {placingPreset.prefabs.length} items
                </text>
              </g>
            )}
          </svg>
        </div>

        {/* ── Right: Zone Properties Panel ────────────────────── */}
        <div
          className={`shrink-0 border-l border-white/[0.06] bg-[#060a14] flex flex-col transition-all duration-200 overflow-hidden ${
            selectedZone ? 'w-64 opacity-100' : 'w-0 opacity-0 border-l-0'
          }`}
        >
          {selectedZone && (
            <>
              <div className="flex items-center justify-between border-b border-white/[0.06] px-4 py-3">
                <h2 className="font-mono text-[10px] font-bold uppercase tracking-[0.15em] text-zinc-400">
                  ZONE PROPERTIES
                </h2>
                <button
                  type="button"
                  onClick={() => setSelectedZoneId(null)}
                  className="rounded p-1 text-zinc-600 hover:bg-white/[0.06] hover:text-zinc-400 transition-colors"
                >
                  <X className="h-3.5 w-3.5" />
                </button>
              </div>
              <div className="flex-1 overflow-y-auto p-4 space-y-4">
                {/* Label */}
                <div>
                  <p className="font-mono text-[9px] text-zinc-600 uppercase tracking-wider mb-1">
                    Name
                  </p>
                  <input
                    type="text"
                    value={selectedZone.label}
                    onChange={(e) => handleLabelChange(e.target.value)}
                    className="w-full rounded border border-white/10 bg-white/[0.04] px-2 py-1.5 font-mono text-xs text-zinc-200 outline-none focus:border-blue-500/50"
                  />
                </div>

                {/* Archetype */}
                <div>
                  <p className="font-mono text-[9px] text-zinc-600 uppercase tracking-wider mb-1">
                    Archetype
                  </p>
                  <div className="flex items-center gap-2">
                    <span
                      className="h-3 w-3 rounded-sm"
                      style={{ backgroundColor: selectedZone.accentColor }}
                    />
                    <span className="font-mono text-xs text-zinc-300 capitalize">
                      {selectedZone.archetype ?? 'none'}
                    </span>
                  </div>
                </div>

                {/* Size */}
                <div>
                  <p className="font-mono text-[9px] text-zinc-600 uppercase tracking-wider mb-1">
                    Size
                  </p>
                  <p className="font-mono text-xs text-zinc-300">
                    {selectedZone.w} x {selectedZone.d} units
                  </p>
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
                          onClick={() => handleMoveZone(-1, 0)}
                          className="rounded bg-white/[0.06] p-1 text-zinc-500 hover:bg-white/[0.1] hover:text-zinc-300"
                        >
                          <Minus className="h-2.5 w-2.5" />
                        </button>
                        <span className="flex-1 text-center font-mono text-[10px] text-zinc-300">
                          {selectedZone.cx}
                        </span>
                        <button
                          type="button"
                          onClick={() => handleMoveZone(1, 0)}
                          className="rounded bg-white/[0.06] p-1 text-zinc-500 hover:bg-white/[0.1] hover:text-zinc-300"
                        >
                          <Plus className="h-2.5 w-2.5" />
                        </button>
                      </div>
                    </div>
                    <div>
                      <span className="font-mono text-[8px] text-zinc-600">Z</span>
                      <div className="flex items-center gap-1 mt-0.5">
                        <button
                          type="button"
                          onClick={() => handleMoveZone(0, -1)}
                          className="rounded bg-white/[0.06] p-1 text-zinc-500 hover:bg-white/[0.1] hover:text-zinc-300"
                        >
                          <Minus className="h-2.5 w-2.5" />
                        </button>
                        <span className="flex-1 text-center font-mono text-[10px] text-zinc-300">
                          {selectedZone.cz}
                        </span>
                        <button
                          type="button"
                          onClick={() => handleMoveZone(0, 1)}
                          className="rounded bg-white/[0.06] p-1 text-zinc-500 hover:bg-white/[0.1] hover:text-zinc-300"
                        >
                          <Plus className="h-2.5 w-2.5" />
                        </button>
                      </div>
                    </div>
                  </div>
                </div>

                {/* Furniture count */}
                <div>
                  <p className="font-mono text-[9px] text-zinc-600 uppercase tracking-wider mb-1">
                    Furniture
                  </p>
                  <p className="font-mono text-xs text-zinc-300">
                    {itemsByZone.get(selectedZone.id)?.length ?? 0} items
                  </p>
                  {selectedZone.deskSlots > 0 && (
                    <p className="font-mono text-[9px] text-zinc-500 mt-0.5">
                      {selectedZone.deskSlots} desk slots
                    </p>
                  )}
                </div>

                {/* Delete */}
                <button
                  type="button"
                  onClick={handleDeleteZone}
                  className="w-full flex items-center justify-center gap-1.5 rounded-lg border border-red-500/30 bg-red-600/10 px-3 py-2 font-mono text-[10px] text-red-400 hover:bg-red-600/20 transition-colors"
                >
                  <Trash2 className="h-3 w-3" />
                  Delete Zone
                </button>
              </div>

              {/* Keyboard hints */}
              <div className="border-t border-white/[0.06] px-4 py-2">
                <p className="font-mono text-[8px] text-zinc-700">
                  Drag to move · Del: Delete · Esc: Deselect
                </p>
              </div>
            </>
          )}
        </div>
      </div>

      {/* ── Bottom Status Bar ──────────────────────────────────── */}
      <div className="flex h-8 shrink-0 items-center justify-between border-t border-white/[0.06] px-4">
        <p className="font-mono text-[9px] text-zinc-600">
          {editorZones.length} zones · {localItems.length} items
          {placingPreset && ` · Placing: ${placingPreset.label}`}
          {drag && ' · Dragging...'}
        </p>
        <p className="font-mono text-[9px] text-zinc-700">
          <Grid3X3 className="inline h-3 w-3 mr-1" />
          Grid: {SCALE}px/unit
        </p>
      </div>
    </div>
  );
}
