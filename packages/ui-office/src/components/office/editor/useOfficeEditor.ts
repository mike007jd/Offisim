import { getAllBuiltinPrefabs } from '@aics/renderer';
import type { PrefabDefinition, ZoneArchetype, ZonePreset } from '@aics/shared-types';
import { isRequiredArchetype, computeOverlapMap, findOverlaps } from '@aics/shared-types';
import { dehydrateZone } from '@aics/core/browser';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useCompanyZones } from '../../../hooks/useCompanyZones.js';
import { usePrefabInstances } from '../../../hooks/usePrefabInstances.js';
import { useAicsRuntime } from '../../../runtime/aics-runtime-context.js';
import { useCompany } from '../../company/CompanyContext.js';
import type { EditorZone, PlacedItem, DragState } from './types.js';
import { SVG_W, SVG_H, SCALE, fromSVG, spawnFromPreset } from './types.js';

export interface UseOfficeEditorReturn {
  editorZones: EditorZone[];
  localItems: PlacedItem[];
  selectedZoneId: string | null;
  selectedZone: EditorZone | null;
  placingPreset: ZonePreset | null;
  ghostPos: { x: number; y: number } | null;
  drag: DragState | null;
  saving: boolean;
  dirty: boolean;
  collapsed: Record<string, boolean>;
  showCustomForm: boolean;
  customLabel: string;
  customArchetype: ZoneArchetype;
  allPrefabsMap: Map<string, PrefabDefinition>;
  itemsByZone: Map<string, PlacedItem[]>;
  overlapMap: Map<string, string[]>;
  ghostOverlaps: string[];
  zoom: number;
  panX: number;
  panY: number;
  viewBox: string;
  svgRef: React.RefObject<SVGSVGElement | null>;
  setCollapsed: React.Dispatch<React.SetStateAction<Record<string, boolean>>>;
  setShowCustomForm: React.Dispatch<React.SetStateAction<boolean>>;
  setCustomLabel: React.Dispatch<React.SetStateAction<string>>;
  setCustomArchetype: React.Dispatch<React.SetStateAction<ZoneArchetype>>;
  setPlacingPreset: React.Dispatch<React.SetStateAction<ZonePreset | null>>;
  setSelectedZoneId: React.Dispatch<React.SetStateAction<string | null>>;
  handlePresetClick: (preset: ZonePreset) => void;
  handleCanvasPointerDown: (e: React.PointerEvent<SVGSVGElement>) => void;
  handleCanvasMouseMove: (e: React.MouseEvent<SVGSVGElement>) => void;
  handleCanvasPointerUp: () => void;
  handleCanvasMouseLeave: () => void;
  handleZonePointerDown: (zoneId: string, e: React.PointerEvent) => void;
  handleDeleteZone: () => void;
  handleMoveZone: (dx: number, dz: number) => void;
  handleLabelChange: (label: string) => void;
  handleCreateCustom: () => void;
  handleResetAll: () => void;
  handleSave: () => Promise<void>;
  handleWheel: (e: React.WheelEvent) => void;
  handleZoomIn: () => void;
  handleZoomOut: () => void;
  handleZoomFit: () => void;
  handleSwapVariant: (preset: ZonePreset) => void;
  selectedZoneRequired: boolean;
  warning: string | null;
}

export function useOfficeEditor(open: boolean, onClose: () => void): UseOfficeEditorReturn {
  const { repos, eventBus } = useAicsRuntime();
  const { activeCompanyId } = useCompany();
  const { zones: dbZones, refresh: refreshZones } = useCompanyZones();
  const { instances: dbInstances, refresh: refreshPrefabs } = usePrefabInstances();
  const svgRef = useRef<SVGSVGElement>(null);

  // ── Core state ──
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
  const [warning, setWarning] = useState<string | null>(null);

  // ── Zoom/pan ──
  const [zoom, setZoom] = useState(1);
  const [panX, setPanX] = useState(0);
  const [panY, setPanY] = useState(0);

  const viewBox = `${panX} ${panY} ${SVG_W / zoom} ${SVG_H / zoom}`;

  // ── Refs for stable callbacks (avoid drag-frame re-creation) ──
  const editorZonesRef = useRef(editorZones);
  const localItemsRef = useRef(localItems);
  const zoomRef = useRef(zoom);
  const panXRef = useRef(panX);
  const panYRef = useRef(panY);
  const warningTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    editorZonesRef.current = editorZones;
    localItemsRef.current = localItems;
    zoomRef.current = zoom;
    panXRef.current = panX;
    panYRef.current = panY;
  }, [editorZones, localItems, zoom, panX, panY]);

  // Cleanup warning timer on unmount
  useEffect(() => () => {
    if (warningTimerRef.current) clearTimeout(warningTimerRef.current);
  }, []);

  // ── Prefab catalog ──
  const allPrefabsMap = useMemo(() => {
    const map = new Map<string, PrefabDefinition>();
    for (const p of getAllBuiltinPrefabs()) map.set(p.prefabId, p);
    return map;
  }, []);

  // ── DB sync (initial open only) ──
  const syncedRef = useRef(false);
  useEffect(() => {
    if (!open) { syncedRef.current = false; return; }
    if (syncedRef.current) return;
    syncedRef.current = true;

    const ezones: EditorZone[] = dbZones.map((z) => ({
      id: z.zoneId, kind: z.kind, presetId: null,
      label: z.label, archetype: z.archetype,
      accentColor: z.accentColor, floorColor: z.floorColor,
      cx: z.cx, cz: z.cz, w: z.w, d: z.d,
      deskSlots: z.deskSlots,
      targetRoles: [...z.targetRoles],
      allowedCategories: [...z.allowedCategories],
      activityTypes: [...z.activityTypes],
    }));

    const items: PlacedItem[] = dbInstances.map(({ instance, definition }) => ({
      instanceId: instance.instance_id, prefabId: instance.prefab_id,
      name: definition.name,
      x: instance.position_x, y: instance.position_y,
      rotation: instance.rotation, zoneId: instance.zone_id,
    }));

    setEditorZones(ezones);
    setLocalItems(items);
    setDirty(false);
    setSelectedZoneId(null);
    setPlacingPreset(null);
    setDrag(null);
    setZoom(1);
    setPanX(0);
    setPanY(0);
  }, [open, dbZones, dbInstances]);

  // ── Derived ──
  const selectedZone = useMemo(
    () => editorZones.find((z) => z.id === selectedZoneId) ?? null,
    [editorZones, selectedZoneId],
  );
  const selectedZoneRequired = selectedZone ? isRequiredArchetype(selectedZone.archetype) : false;

  const itemsByZone = useMemo(() => {
    const m = new Map<string, PlacedItem[]>();
    for (const it of localItems) {
      let arr = m.get(it.zoneId);
      if (!arr) { arr = []; m.set(it.zoneId, arr); }
      arr.push(it);
    }
    return m;
  }, [localItems]);

  // Skip overlap recomputation during drag for performance
  const lastOverlapMap = useRef<Map<string, string[]>>(new Map());
  const overlapMap = useMemo(() => {
    if (drag) return lastOverlapMap.current;
    const result = computeOverlapMap(editorZones);
    lastOverlapMap.current = result;
    return result;
  }, [editorZones, drag]);

  const ghostOverlaps = useMemo(() => {
    if (!placingPreset || !ghostPos) return [];
    const { wx, wz } = fromSVG(ghostPos.x, ghostPos.y);
    const candidate = {
      id: '__ghost__',
      cx: Math.round(wx * 2) / 2, cz: Math.round(wz * 2) / 2,
      w: placingPreset.w, d: placingPreset.d,
    };
    return findOverlaps(candidate, editorZonesRef.current).map((z) => z.label);
  }, [placingPreset, ghostPos]);

  // ── SVG coords (stable — reads zoom/pan from refs) ─��
  const svgCoords = useCallback(
    (e: React.MouseEvent): { svgX: number; svgY: number } => {
      if (!svgRef.current) return { svgX: 0, svgY: 0 };
      const rect = svgRef.current.getBoundingClientRect();
      return {
        svgX: panXRef.current + ((e.clientX - rect.left) / rect.width) * (SVG_W / zoomRef.current),
        svgY: panYRef.current + ((e.clientY - rect.top) / rect.height) * (SVG_H / zoomRef.current),
      };
    },
    [],
  );

  // ── Handlers ──

  const handlePresetClick = useCallback((preset: ZonePreset) => {
    setPlacingPreset((prev) => (prev?.id === preset.id ? null : preset));
    setSelectedZoneId(null);
    setShowCustomForm(false);
  }, []);

  const handleCanvasPointerDown = useCallback(
    (e: React.PointerEvent<SVGSVGElement>) => {
      if (drag) return;
      if (!placingPreset) {
        setSelectedZoneId(null);
        return;
      }
      const { svgX, svgY } = svgCoords(e);
      const { wx, wz } = fromSVG(svgX, svgY);
      const { zone, items } = spawnFromPreset(
        placingPreset,
        Math.round(wx * 2) / 2, Math.round(wz * 2) / 2,
        allPrefabsMap,
      );
      setEditorZones((prev) => [...prev, zone]);
      setLocalItems((prev) => [...prev, ...items]);
      setDirty(true);
    },
    [placingPreset, drag, svgCoords, allPrefabsMap],
  );

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
            return { ...it, x: Math.round((start.x + dx) * 10) / 10, y: Math.round((start.y + dz) * 10) / 10 };
          }),
        );
        setDirty(true);
        return;
      }
      if (!placingPreset) { setGhostPos(null); return; }
      const { svgX, svgY } = svgCoords(e);
      setGhostPos({ x: svgX, y: svgY });
    },
    [placingPreset, drag, svgCoords],
  );

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

  const handleCanvasPointerUp = useCallback(() => {
    if (drag) setDrag(null);
  }, [drag]);

  const handleCanvasMouseLeave = useCallback(() => {
    setGhostPos(null);
    if (drag) setDrag(null);
  }, [drag]);

  const showWarning = useCallback((msg: string) => {
    if (warningTimerRef.current) clearTimeout(warningTimerRef.current);
    setWarning(msg);
    warningTimerRef.current = setTimeout(() => setWarning(null), 2500);
  }, []);

  // Uses ref to avoid depending on editorZones (prevents keyboard effect churn during drag)
  const handleDeleteZone = useCallback(() => {
    if (!selectedZoneId) return;
    const zone = editorZonesRef.current.find((z) => z.id === selectedZoneId);
    if (zone && isRequiredArchetype(zone.archetype)) {
      showWarning(`Cannot delete required zone: ${zone.label}`);
      return;
    }
    setEditorZones((prev) => prev.filter((z) => z.id !== selectedZoneId));
    setLocalItems((prev) => prev.filter((it) => it.zoneId !== selectedZoneId));
    setSelectedZoneId(null);
    setDirty(true);
  }, [selectedZoneId, showWarning]);

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
            ? { ...it, x: Math.round((it.x + dx) * 10) / 10, y: Math.round((it.y + dz) * 10) / 10 }
            : it,
        ),
      );
      setDirty(true);
    },
    [selectedZoneId],
  );

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

  const handleSwapVariant = useCallback(
    (preset: ZonePreset) => {
      if (!selectedZoneId) return;
      const zone = editorZonesRef.current.find((z) => z.id === selectedZoneId);
      if (!zone) return;
      setLocalItems((prev) => prev.filter((it) => it.zoneId !== selectedZoneId));
      const newItems: PlacedItem[] = [];
      for (const p of preset.prefabs) {
        const def = allPrefabsMap.get(p.prefabId);
        if (!def) continue;
        newItems.push({
          instanceId: crypto.randomUUID(), prefabId: p.prefabId, name: def.name,
          x: Math.round((zone.cx + p.offsetX) * 10) / 10,
          y: Math.round((zone.cz + p.offsetZ) * 10) / 10,
          rotation: p.rotation ?? 0, zoneId: selectedZoneId,
        });
      }
      setLocalItems((prev) => [...prev, ...newItems]);
      setEditorZones((prev) =>
        prev.map((z) =>
          z.id === selectedZoneId
            ? { ...z, presetId: preset.id, label: preset.label, accentColor: preset.accentColor,
                floorColor: preset.floorColor, w: preset.w, d: preset.d, deskSlots: preset.deskSlots,
                targetRoles: [...preset.targetRoles], allowedCategories: [...preset.allowedCategories],
                activityTypes: [...preset.activityTypes] }
            : z,
        ),
      );
      setDirty(true);
    },
    [selectedZoneId, allPrefabsMap],
  );

  const handleCreateCustom = useCallback(() => {
    const zone: EditorZone = {
      id: crypto.randomUUID(), kind: 'custom', presetId: null,
      label: customLabel, archetype: customArchetype,
      accentColor: '#64748b', floorColor: 0x334155,
      cx: 0, cz: 0, w: 10, d: 8, deskSlots: 0,
      targetRoles: [], allowedCategories: [], activityTypes: [],
    };
    setEditorZones((prev) => [...prev, zone]);
    setDirty(true);
    setShowCustomForm(false);
    setCustomLabel('Custom Zone');
  }, [customLabel, customArchetype]);

  const handleResetAll = useCallback(() => {
    const requiredIds = new Set(
      editorZonesRef.current.filter((z) => isRequiredArchetype(z.archetype)).map((z) => z.id),
    );
    setEditorZones((prev) => prev.filter((z) => requiredIds.has(z.id)));
    setLocalItems((prev) => prev.filter((it) => requiredIds.has(it.zoneId)));
    setSelectedZoneId(null);
    setPlacingPreset(null);
    setDrag(null);
    setDirty(true);
  }, []);

  const handleSave = useCallback(async () => {
    if (!repos || !activeCompanyId) return;
    setSaving(true);
    try {
      await repos.prefabInstances.deleteByCompany(activeCompanyId);
      await repos.zones.deleteByCompany(activeCompanyId);
      const now = new Date().toISOString();
      const zones = editorZonesRef.current;
      const items = localItemsRef.current;

      for (let i = 0; i < zones.length; i++) {
        const ez = zones[i]!;
        const zoneId = `${activeCompanyId}::zone-${crypto.randomUUID()}`;
        const dehydrated = dehydrateZone({
          zoneId, companyId: activeCompanyId, kind: ez.kind, archetype: ez.archetype,
          label: ez.label, accentColor: ez.accentColor, floorColor: ez.floorColor,
          cx: ez.cx, cz: ez.cz, w: ez.w, d: ez.d,
          targetRoles: ez.targetRoles, allowedCategories: ez.allowedCategories,
          activityTypes: ez.activityTypes, deskSlots: ez.deskSlots, sortOrder: i,
        });
        const created = await repos.zones.create(dehydrated);
        const savedZoneId = created.zone_id;
        const zoneItems = items.filter((item) => item.zoneId === ez.id);
        await Promise.all(
          zoneItems.map((item) =>
            repos.prefabInstances.create({
              instance_id: `pi-${savedZoneId}-${item.instanceId}`,
              company_id: activeCompanyId, prefab_id: item.prefabId,
              zone_id: savedZoneId, position_x: item.x, position_y: item.y,
              rotation: item.rotation as 0 | 90 | 180 | 270,
              bindings_json: null, config_json: null,
              enabled: 1, created_at: now, updated_at: now,
            }),
          ),
        );
      }
      eventBus.emit({
        type: 'prefab.state.changed', entityId: activeCompanyId, entityType: 'company',
        companyId: activeCompanyId, timestamp: Date.now(),
        payload: { action: 'studio-saved', count: items.length },
      });
      setDirty(false);
      refreshZones();
      refreshPrefabs();
    } finally {
      setSaving(false);
    }
  }, [repos, activeCompanyId, eventBus, refreshZones, refreshPrefabs]);

  // ── Zoom ──
  const handleWheel = useCallback((e: React.WheelEvent) => {
    e.preventDefault();
    setZoom((prev) => Math.max(0.3, Math.min(4, prev * (e.deltaY > 0 ? 0.9 : 1.1))));
  }, []);
  const handleZoomIn = useCallback(() => setZoom((z) => Math.min(4, z * 1.2)), []);
  const handleZoomOut = useCallback(() => setZoom((z) => Math.max(0.3, z / 1.2)), []);
  const handleZoomFit = useCallback(() => { setZoom(1); setPanX(0); setPanY(0); }, []);

  // ── Keyboard shortcuts ──
  useEffect(() => {
    if (!open) return;
    function handleKey(e: KeyboardEvent) {
      if (e.target instanceof HTMLInputElement || e.target instanceof HTMLSelectElement) return;
      if (e.key === 'Escape') {
        if (placingPreset) setPlacingPreset(null);
        else if (selectedZoneId) setSelectedZoneId(null);
        else onClose();
      }
      if ((e.key === 'Delete' || e.key === 'Backspace') && selectedZoneId) {
        handleDeleteZone();
      }
    }
    window.addEventListener('keydown', handleKey);
    return () => window.removeEventListener('keydown', handleKey);
  }, [open, placingPreset, selectedZoneId, handleDeleteZone, onClose]);

  return {
    editorZones, localItems, selectedZoneId, selectedZone, placingPreset,
    ghostPos, drag, saving, dirty, collapsed, showCustomForm, customLabel, customArchetype,
    allPrefabsMap, itemsByZone, overlapMap, ghostOverlaps,
    zoom, panX, panY, viewBox,
    svgRef,
    setCollapsed, setShowCustomForm, setCustomLabel, setCustomArchetype, setPlacingPreset, setSelectedZoneId,
    handlePresetClick, handleCanvasPointerDown, handleCanvasMouseMove,
    handleCanvasPointerUp, handleCanvasMouseLeave, handleZonePointerDown,
    handleDeleteZone, handleMoveZone, handleLabelChange, handleCreateCustom,
    handleResetAll, handleSave, handleWheel, handleZoomIn, handleZoomOut, handleZoomFit,
    handleSwapVariant, selectedZoneRequired, warning,
  };
}
