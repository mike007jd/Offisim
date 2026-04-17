import { getAllBuiltinPrefabs } from '@offisim/renderer';
import type { PrefabDefinition, ZoneArchetype, ZonePreset } from '@offisim/shared-types';
import { isRequiredArchetype } from '@offisim/shared-types';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useCompanyZones } from '../../../../hooks/useCompanyZones.js';
import { usePrefabInstances } from '../../../../hooks/usePrefabInstances.js';
import { saveZonesToDb } from '../../../../lib/zone-persistence.js';
import { useOffisimRuntime } from '../../../../runtime/offisim-runtime-context.js';
import { useCompany } from '../../../company/CompanyContext.js';
import { useStudioStore } from '../../../studio/StudioState.js';
import type { EditorZone, PlacedItem } from '../types.js';

export interface UseZoneEditorStateParams {
  open: boolean;
  onClose: () => void;
}

export interface UseZoneEditorStateReturn {
  editorZones: EditorZone[];
  localItems: PlacedItem[];
  selectedZoneId: string | null;
  selectedZone: EditorZone | null;
  selectedZoneRequired: boolean;
  placingPreset: ZonePreset | null;
  saving: boolean;
  dirty: boolean;
  collapsed: Record<string, boolean>;
  showCustomForm: boolean;
  customLabel: string;
  customArchetype: ZoneArchetype;
  warning: string | null;
  allPrefabsMap: Map<string, PrefabDefinition>;
  itemsByZone: Map<string, PlacedItem[]>;
  setCollapsed: React.Dispatch<React.SetStateAction<Record<string, boolean>>>;
  setShowCustomForm: React.Dispatch<React.SetStateAction<boolean>>;
  setCustomLabel: React.Dispatch<React.SetStateAction<string>>;
  setCustomArchetype: React.Dispatch<React.SetStateAction<ZoneArchetype>>;
  setPlacingPreset: React.Dispatch<React.SetStateAction<ZonePreset | null>>;
  setSelectedZoneId: React.Dispatch<React.SetStateAction<string | null>>;
  setDirty: React.Dispatch<React.SetStateAction<boolean>>;
  handlePresetClick: (preset: ZonePreset) => void;
  handleDeleteZone: () => void;
  handleMoveZone: (dx: number, dz: number) => void;
  handleLabelChange: (label: string) => void;
  handleSwapVariant: (preset: ZonePreset) => void;
  handleCreateCustom: () => void;
  handleResetAll: () => void;
  handleSave: () => Promise<void>;
}

export function useZoneEditorState({
  open,
  onClose,
}: UseZoneEditorStateParams): UseZoneEditorStateReturn {
  const { repos, eventBus } = useOffisimRuntime();
  const { activeCompanyId } = useCompany();
  const { zones: dbZones, refresh: refreshZones } = useCompanyZones();
  const { instances: dbInstances, refresh: refreshPrefabs } = usePrefabInstances();

  const studioZones = useStudioStore((s) => s.zones);
  const studioInstances = useStudioStore((s) => s.instances);
  const [selectedZoneId, setSelectedZoneId] = useState<string | null>(null);
  const [placingPreset, setPlacingPreset] = useState<ZonePreset | null>(null);
  const [saving, setSaving] = useState(false);
  const [dirty, setDirty] = useState(false);
  const [collapsed, setCollapsed] = useState<Record<string, boolean>>({});
  const [showCustomForm, setShowCustomForm] = useState(false);
  const [customLabel, setCustomLabel] = useState('Custom Zone');
  const [customArchetype, setCustomArchetype] = useState<ZoneArchetype>('workspace');
  const [warning, setWarning] = useState<string | null>(null);

  const editorZonesRef = useRef<EditorZone[]>([]);
  const warningTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

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
  }, [editorZones]);

  useEffect(
    () => () => {
      if (warningTimerRef.current) clearTimeout(warningTimerRef.current);
    },
    [],
  );

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
  }, [open, activeCompanyId, dbZones, dbInstances]);

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

  const showWarning = useCallback((msg: string) => {
    if (warningTimerRef.current) clearTimeout(warningTimerRef.current);
    setWarning(msg);
    warningTimerRef.current = setTimeout(() => setWarning(null), 2500);
  }, []);

  const handlePresetClick = useCallback((preset: ZonePreset) => {
    setPlacingPreset((prev) => (prev?.id === preset.id ? null : preset));
    setSelectedZoneId(null);
    setShowCustomForm(false);
  }, []);

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
    selectedZoneRequired,
    placingPreset,
    saving,
    dirty,
    collapsed,
    showCustomForm,
    customLabel,
    customArchetype,
    warning,
    allPrefabsMap,
    itemsByZone,
    setCollapsed,
    setShowCustomForm,
    setCustomLabel,
    setCustomArchetype,
    setPlacingPreset,
    setSelectedZoneId,
    setDirty,
    handlePresetClick,
    handleDeleteZone,
    handleMoveZone,
    handleLabelChange,
    handleSwapVariant,
    handleCreateCustom,
    handleResetAll,
    handleSave,
  };
}
