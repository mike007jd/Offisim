import { getAllBuiltinPrefabs } from '@offisim/renderer';
import type { PrefabDefinition, ZoneArchetype, ZonePreset } from '@offisim/shared-types';
import { computeOverlapMap, findOverlaps, isRequiredArchetype } from '@offisim/shared-types';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useCompanyZones } from '../../../hooks/useCompanyZones.js';
import { usePrefabInstances } from '../../../hooks/usePrefabInstances.js';
import { saveZonesToDb } from '../../../lib/zone-persistence.js';
import { useOffisimRuntime } from '../../../runtime/offisim-runtime-context.js';
import { useCompany } from '../../company/CompanyContext.js';
import { useStudioStore } from '../../studio/StudioState.js';
import type { DragState, EditorZone, PlacedItem } from './types.js';
import { SCALE, SVG_H, SVG_W, fromSVG } from './types.js';

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
  const { repos, eventBus } = useOffisimRuntime();
  const { activeCompanyId } = useCompany();
  const { zones: dbZones, refresh: refreshZones } = useCompanyZones();
  const { instances: dbInstances, refresh: refreshPrefabs } = usePrefabInstances();
  const svgRef = useRef<SVGSVGElement>(null);

  const studioZones = useStudioStore((s) => s.zones);
  const studioInstances = useStudioStore((s) => s.instances);
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
  const editorZonesRef = useRef<EditorZone[]>([]);
  const localItemsRef = useRef<PlacedItem[]>([]);
  const zoomRef = useRef(zoom);
  const panXRef = useRef(panX);
  const panYRef = useRef(panY);
  const warningTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  // ── Prefab catalog ──
  const allPrefabsMap = useMemo(() => {
    const map = new Map<string, PrefabDefinition>();
    for (const p of getAllBuiltinPrefabs()) map.set(p.prefabId, p);
    return map;
  }, []);

  const editorZones = useMemo<EditorZone[]>(
    () =>
      studioZones.map((zone) => ({
        id: zone.zoneId,
        kind: zone.kind,
        presetId: null,
        label: zone.label,
        archetype: zone.archetype,
        accentColor: zone.accentColor,
        floorColor: zone.floorColor,
        cx: zone.cx,
        cz: zone.cz,
        w: zone.w,
        d: zone.d,
        deskSlots: zone.deskSlots,
        targetRoles: [...zone.targetRoles],
        allowedCategories: [...zone.allowedCategories],
        activityTypes: [...zone.activityTypes],
      })),
    [studioZones],
  );

  const localItems = useMemo<PlacedItem[]>(
    () =>
      studioInstances.map((instance) => ({
        instanceId: instance.id,
        prefabId: instance.prefabId,
        name: allPrefabsMap.get(instance.prefabId)?.name ?? instance.prefabId,
        x: instance.position[0],
        y: instance.position[2],
        rotation: instance.rotation,
        zoneId: instance.zoneId,
      })),
    [studioInstances, allPrefabsMap],
  );

  useEffect(() => {
    editorZonesRef.current = editorZones;
    localItemsRef.current = localItems;
    zoomRef.current = zoom;
    panXRef.current = panX;
    panYRef.current = panY;
  }, [editorZones, localItems, zoom, panX, panY]);

  // Cleanup warning timer on unmount
  useEffect(
    () => () => {
      if (warningTimerRef.current) clearTimeout(warningTimerRef.current);
    },
    [],
  );

  // ── DB sync (initial open only) ──
  const syncedRef = useRef(false);
  useEffect(() => {
    if (!open) {
      syncedRef.current = false;
      return;
    }
    if (syncedRef.current) return;
    syncedRef.current = true;
    useStudioStore.getState().resetForCompany(activeCompanyId ?? '');
    useStudioStore.getState().loadZonesFromDb(dbZones);
    useStudioStore.getState().setInstances(
      dbInstances.map(({ instance }) => ({
        id: instance.instance_id,
        prefabId: instance.prefab_id,
        position: [instance.position_x, 0, instance.position_y] as [number, number, number],
        rotation: instance.rotation,
        zoneId: instance.zone_id,
      })),
    );
    setDirty(false);
    setSelectedZoneId(null);
    setPlacingPreset(null);
    setDrag(null);
    setZoom(1);
    setPanX(0);
    setPanY(0);
  }, [open, activeCompanyId, dbZones, dbInstances]);

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
      if (!arr) {
        arr = [];
        m.set(it.zoneId, arr);
      }
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
      cx: Math.round(wx * 2) / 2,
      cz: Math.round(wz * 2) / 2,
      w: placingPreset.w,
      d: placingPreset.d,
    };
    return findOverlaps(candidate, editorZonesRef.current).map((z) => z.label);
  }, [placingPreset, ghostPos]);

  // ── SVG coords (stable — reads zoom/pan from refs) ─��
  const svgCoords = useCallback((e: React.MouseEvent): { svgX: number; svgY: number } => {
    if (!svgRef.current) return { svgX: 0, svgY: 0 };
    const rect = svgRef.current.getBoundingClientRect();
    return {
      svgX: panXRef.current + ((e.clientX - rect.left) / rect.width) * (SVG_W / zoomRef.current),
      svgY: panYRef.current + ((e.clientY - rect.top) / rect.height) * (SVG_H / zoomRef.current),
    };
  }, []);

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
      const snappedPosition = [Math.round(wx * 2) / 2, 0, Math.round(wz * 2) / 2] as [
        number,
        number,
        number,
      ];
      useStudioStore.getState().addZoneFromPreset(placingPreset, snappedPosition);
      setDirty(true);
    },
    [placingPreset, drag, svgCoords],
  );

  const handleCanvasMouseMove = useCallback(
    (e: React.MouseEvent<SVGSVGElement>) => {
      if (drag) {
        const { svgX, svgY } = svgCoords(e);
        const newCx = Math.round((drag.startCx + (svgX - drag.startMouseX) / SCALE) * 2) / 2;
        const newCz = Math.round((drag.startCz + (svgY - drag.startMouseY) / SCALE) * 2) / 2;
        useStudioStore.getState().updateZonePosition(drag.zoneId, newCx, newCz);
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

  const handleZonePointerDown = useCallback(
    (zoneId: string, e: React.PointerEvent) => {
      if (placingPreset) return;
      e.stopPropagation();
      const { svgX, svgY } = svgCoords(e);
      const zone = editorZonesRef.current.find((z) => z.id === zoneId);
      if (!zone) return;
      setSelectedZoneId(zoneId);
      setDrag({
        zoneId,
        startMouseX: svgX,
        startMouseY: svgY,
        startCx: zone.cx,
        startCz: zone.cz,
        startItemPositions: new Map(),
      });
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
    useStudioStore.getState().removeZone(selectedZoneId);
    setSelectedZoneId(null);
    setDirty(true);
  }, [selectedZoneId, showWarning]);

  const handleMoveZone = useCallback(
    (dx: number, dz: number) => {
      if (!selectedZoneId) return;
      const zone = editorZonesRef.current.find((candidate) => candidate.id === selectedZoneId);
      if (!zone) return;
      useStudioStore
        .getState()
        .updateZonePosition(
          selectedZoneId,
          Math.round((zone.cx + dx) * 2) / 2,
          Math.round((zone.cz + dz) * 2) / 2,
        );
      setDirty(true);
    },
    [selectedZoneId],
  );

  const handleLabelChange = useCallback(
    (label: string) => {
      if (!selectedZoneId) return;
      useStudioStore.getState().updateZoneLabel(selectedZoneId, label);
      setDirty(true);
    },
    [selectedZoneId],
  );

  const handleSwapVariant = useCallback(
    (preset: ZonePreset) => {
      if (!selectedZoneId) return;
      useStudioStore.getState().swapZoneVariant(selectedZoneId, preset, allPrefabsMap);
      setDirty(true);
    },
    [selectedZoneId, allPrefabsMap],
  );

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
    useStudioStore.setState((state) => ({
      zones: [
        ...state.zones,
        {
          zoneId: zone.id,
          companyId: activeCompanyId ?? '',
          kind: zone.kind,
          archetype: zone.archetype,
          label: zone.label,
          accentColor: zone.accentColor,
          floorColor: zone.floorColor,
          cx: zone.cx,
          cz: zone.cz,
          w: zone.w,
          d: zone.d,
          deskSlots: zone.deskSlots,
          targetRoles: zone.targetRoles,
          allowedCategories: zone.allowedCategories,
          activityTypes: zone.activityTypes,
          sortOrder: state.zones.length,
        },
      ],
      dirty: true,
    }));
    setDirty(true);
    setShowCustomForm(false);
    setCustomLabel('Custom Zone');
  }, [customLabel, customArchetype, activeCompanyId]);

  const handleResetAll = useCallback(() => {
    const requiredIds = new Set(
      editorZonesRef.current.filter((z) => isRequiredArchetype(z.archetype)).map((z) => z.id),
    );
    useStudioStore.setState((state) => ({
      zones: state.zones.filter((zone) => requiredIds.has(zone.zoneId)),
      instances: state.instances.filter((instance) => requiredIds.has(instance.zoneId)),
      dirty: true,
    }));
    setSelectedZoneId(null);
    setPlacingPreset(null);
    setDrag(null);
    setDirty(true);
  }, []);

  const handleSave = useCallback(async () => {
    if (!repos || !activeCompanyId) return;
    setSaving(true);
    try {
      const state = useStudioStore.getState();
      await saveZonesToDb(
        { prefabInstances: repos.prefabInstances, zones: repos.zones },
        activeCompanyId,
        state.zones,
        state.instances,
        eventBus,
      );
      useStudioStore.getState().markClean();
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
  const handleZoomFit = useCallback(() => {
    setZoom(1);
    setPanX(0);
    setPanY(0);
  }, []);

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
    editorZones,
    localItems,
    selectedZoneId,
    selectedZone,
    placingPreset,
    ghostPos,
    drag,
    saving,
    dirty,
    collapsed,
    showCustomForm,
    customLabel,
    customArchetype,
    allPrefabsMap,
    itemsByZone,
    overlapMap,
    ghostOverlaps,
    zoom,
    panX,
    panY,
    viewBox,
    svgRef,
    setCollapsed,
    setShowCustomForm,
    setCustomLabel,
    setCustomArchetype,
    setPlacingPreset,
    setSelectedZoneId,
    handlePresetClick,
    handleCanvasPointerDown,
    handleCanvasMouseMove,
    handleCanvasPointerUp,
    handleCanvasMouseLeave,
    handleZonePointerDown,
    handleDeleteZone,
    handleMoveZone,
    handleLabelChange,
    handleCreateCustom,
    handleResetAll,
    handleSave,
    handleWheel,
    handleZoomIn,
    handleZoomOut,
    handleZoomFit,
    handleSwapVariant,
    selectedZoneRequired,
    warning,
  };
}
