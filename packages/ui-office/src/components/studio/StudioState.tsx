import type { PrefabDefinition, Zone, ZonePreset } from '@offisim/shared-types';
import { isRequiredArchetype, resolveZoneForPosition } from '@offisim/shared-types';
import { create } from 'zustand';

export type StudioTool = 'select' | 'move' | 'rotate' | 'place';

export interface PlacedInstance {
  id: string;
  prefabId: string;
  position: [number, number, number]; // Three.js [x, 0, z]
  rotation: 0 | 90 | 180 | 270;
  zoneId: string;
}

export interface PlotSize {
  name: string;
  width: number; // 3D X axis
  depth: number; // 3D Z axis
}

export const PLOT_SIZES: PlotSize[] = [
  { name: '\u5c0f\u578b\u5de5\u4f5c\u5ba4', width: 20, depth: 15 },
  { name: '\u6807\u51c6\u529e\u516c\u5ba4', width: 40, depth: 30 },
  { name: '\u5927\u578b\u529e\u516c\u697c', width: 60, depth: 45 },
  { name: '\u56ed\u533a', width: 80, depth: 60 },
];

export interface StudioStore {
  // State
  companyId: string | null;
  tool: StudioTool;
  plotSize: PlotSize;
  placingPrefab: PrefabDefinition | null;
  ghostRotation: 0 | 90 | 180 | 270;
  selectedInstanceId: string | null;
  instances: PlacedInstance[];
  zones: Zone[];
  /** Currently focused zone for "container editing". null = overview mode. */
  focusedZoneId: string | null;
  /** Currently selected zone for properties panel (mutually exclusive with selectedInstanceId). */
  selectedZoneId: string | null;
  /** Whether the user is in Edit Zone mode — restricts interaction to focused zone only. */
  isEditingZone: boolean;
  /** Active zone preset during zone placement mode. */
  placingZonePreset: ZonePreset | null;
  dirty: boolean;
  gridSnap: boolean;

  // Actions
  resetForCompany: (companyId: string) => void;
  setTool: (tool: StudioTool) => void;
  setPlotSize: (size: PlotSize) => void;
  startPlacement: (def: PrefabDefinition) => void;
  cancelPlacement: () => void;
  rotateGhost: () => void;
  /** Place instance — zone resolved automatically from position + zones. */
  placeInstance: (position: [number, number, number]) => void;
  selectInstance: (id: string | null) => void;
  deleteSelected: () => void;
  updatePosition: (id: string, position: [number, number, number]) => void;
  updateRotation: (id: string, rotation: 0 | 90 | 180 | 270) => void;
  updateZoneId: (instanceId: string, zoneId: string) => void;
  rotateSelected: () => void;
  toggleGridSnap: () => void;
  setInstances: (instances: PlacedInstance[]) => void;
  setZones: (zones: Zone[]) => void;
  loadZonesFromDb: (zones: Zone[]) => void;
  updateZonePosition: (zoneId: string, cx: number, cz: number) => void;
  updateZoneSize: (zoneId: string, w: number, d: number) => void;
  addZoneFromPreset: (preset: ZonePreset, position: [number, number, number]) => void;
  removeZone: (zoneId: string) => void;
  /** Focus a zone for container editing. Camera should fly to this zone. */
  focusZone: (zoneId: string) => void;
  /** Return to overview mode (all zones visible). */
  unfocusZone: () => void;
  /** Enter Edit Zone mode — focuses zone and restricts interaction to its contents. */
  enterEditZone: (zoneId: string) => void;
  /** Exit Edit Zone mode — returns to overview with all zones interactive. */
  exitEditZone: () => void;
  /** Select a zone for the properties panel. Clears selectedInstanceId. */
  selectZone: (zoneId: string | null) => void;
  /** Enter zone placement mode with the given preset. */
  startZonePlacement: (preset: ZonePreset) => void;
  /** Cancel zone placement mode. */
  cancelZonePlacement: () => void;
  /** Place a zone preset at the given world position, creating zone + prefab instances. */
  placeZoneFromPreset: (
    position: [number, number, number],
    allPrefabsMap: Map<string, PrefabDefinition>,
  ) => void;
  /** Move a zone and all its associated prefab instances by computing a dx/dz delta. */
  moveZone: (zoneId: string, newCx: number, newCz: number) => void;
  /** Delete a zone and its prefabs. Refuses if the zone archetype is required. */
  deleteZone: (zoneId: string) => void;
  /** Replace a zone's furniture with a different preset variant while keeping position. */
  swapZoneVariant: (
    zoneId: string,
    preset: ZonePreset,
    allPrefabsMap: Map<string, PrefabDefinition>,
  ) => void;
  /** Update a zone's display label. */
  updateZoneLabel: (zoneId: string, label: string) => void;
  markClean: () => void;
}

/** Prefix for temporary Studio placement IDs (replaced with real UUIDs on save) */
export const STUDIO_TEMP_PREFIX = 'sp-';

const DEFAULT_PLOT_SIZE: PlotSize = {
  name: '标准办公室',
  width: 40,
  depth: 30,
};

function generateId(): string {
  return `${STUDIO_TEMP_PREFIX}${crypto.randomUUID()}`;
}

export const useStudioStore = create<StudioStore>((set, get) => ({
  companyId: null,
  tool: 'select',
  plotSize: DEFAULT_PLOT_SIZE,
  placingPrefab: null,
  ghostRotation: 0,
  selectedInstanceId: null,
  instances: [],
  zones: [],
  focusedZoneId: null,
  selectedZoneId: null,
  isEditingZone: false,
  placingZonePreset: null,
  dirty: false,
  gridSnap: true,

  resetForCompany: (companyId) => {
    if (get().companyId === companyId) return;
    set({
      companyId,
      tool: 'select',
      plotSize: DEFAULT_PLOT_SIZE,
      placingPrefab: null,
      ghostRotation: 0,
      selectedInstanceId: null,
      instances: [],
      zones: [],
      focusedZoneId: null,
      selectedZoneId: null,
      isEditingZone: false,
      placingZonePreset: null,
      dirty: false,
      gridSnap: true,
    });
  },

  setTool: (tool) => {
    const current = get();
    const placingPrefab = tool !== 'place' ? null : current.placingPrefab;
    if (current.tool === tool && current.placingPrefab === placingPrefab) return;
    set({ tool, placingPrefab });
  },
  setPlotSize: (plotSize) => set({ plotSize, dirty: true }),

  startPlacement: (def) =>
    set({ tool: 'place', placingPrefab: def, ghostRotation: 0, selectedInstanceId: null }),
  cancelPlacement: () => set({ tool: 'select', placingPrefab: null, ghostRotation: 0 }),

  rotateGhost: () => {
    const ROTATIONS: Array<0 | 90 | 180 | 270> = [0, 90, 180, 270];
    const idx = ROTATIONS.indexOf(get().ghostRotation);
    const nextRotation = ROTATIONS[(idx + 1) % ROTATIONS.length];
    set({ ghostRotation: nextRotation ?? 0 });
  },

  placeInstance: (position) => {
    const { placingPrefab, ghostRotation, instances, zones } = get();
    if (!placingPrefab) return;
    const match = resolveZoneForPosition(position[0], position[2], placingPrefab.category, zones);
    const instance: PlacedInstance = {
      id: generateId(),
      prefabId: placingPrefab.prefabId,
      position,
      rotation: ghostRotation,
      zoneId: match.zoneId,
    };
    set({ instances: [...instances, instance], dirty: true });
  },

  selectInstance: (id) => set({ selectedInstanceId: id }),
  deleteSelected: () => {
    const { selectedInstanceId, instances } = get();
    if (!selectedInstanceId) return;
    set({
      instances: instances.filter((i) => i.id !== selectedInstanceId),
      selectedInstanceId: null,
      dirty: true,
    });
  },

  updatePosition: (id, position) =>
    set((s) => {
      const inst = s.instances.find((i) => i.id === id);
      // Skip if position unchanged — avoids new array allocation every drag frame (PERF-3)
      if (
        inst &&
        inst.position[0] === position[0] &&
        inst.position[1] === position[1] &&
        inst.position[2] === position[2]
      )
        return s;
      return {
        instances: s.instances.map((i) => (i.id === id ? { ...i, position } : i)),
        dirty: true,
      };
    }),

  updateRotation: (id, rotation) =>
    set((s) => {
      const inst = s.instances.find((i) => i.id === id);
      // Skip if rotation unchanged — avoids new array allocation (PERF-3)
      if (inst && inst.rotation === rotation) return s;
      return {
        instances: s.instances.map((i) => (i.id === id ? { ...i, rotation } : i)),
        dirty: true,
      };
    }),

  rotateSelected: () => {
    const { selectedInstanceId, instances } = get();
    if (!selectedInstanceId) return;
    const ROTATIONS: Array<0 | 90 | 180 | 270> = [0, 90, 180, 270];
    set({
      instances: instances.map((i) => {
        if (i.id !== selectedInstanceId) return i;
        const idx = ROTATIONS.indexOf(i.rotation);
        const nextRotation = ROTATIONS[(idx + 1) % ROTATIONS.length];
        if (nextRotation === undefined) return i;
        return {
          ...i,
          rotation: nextRotation,
        };
      }),
      dirty: true,
    });
  },

  updateZoneId: (id, zoneId) =>
    set((s) => {
      const inst = s.instances.find((i) => i.id === id);
      if (inst && inst.zoneId === zoneId) return s;
      return {
        instances: s.instances.map((i) => (i.id === id ? { ...i, zoneId } : i)),
        dirty: true,
      };
    }),

  toggleGridSnap: () => set((s) => ({ gridSnap: !s.gridSnap })),
  setInstances: (instances) => set({ instances, dirty: false }),
  setZones: (zones) => set({ zones }),
  loadZonesFromDb: (zones) =>
    set({
      zones,
      dirty: false,
      focusedZoneId: null,
      selectedZoneId: null,
      selectedInstanceId: null,
      isEditingZone: false,
    }),
  updateZonePosition: (zoneId, newCx, newCz) => {
    const { zones, instances } = get();
    const zone = zones.find((z) => z.zoneId === zoneId);
    if (!zone) return;
    if (zone.cx === newCx && zone.cz === newCz) return;
    const dx = newCx - zone.cx;
    const dz = newCz - zone.cz;
    set({
      zones: zones.map((z) => (z.zoneId === zoneId ? { ...z, cx: newCx, cz: newCz } : z)),
      instances: instances.map((i) =>
        i.zoneId === zoneId
          ? {
              ...i,
              position: [i.position[0] + dx, i.position[1], i.position[2] + dz] as [
                number,
                number,
                number,
              ],
            }
          : i,
      ),
      dirty: true,
    });
  },
  updateZoneSize: (zoneId, w, d) =>
    set((s) => ({
      zones: s.zones.map((z) => (z.zoneId === zoneId ? { ...z, w, d } : z)),
      dirty: true,
    })),
  addZoneFromPreset: (preset, position) => {
    const { instances, zones } = get();
    const [x, , z] = position;
    const zoneId = crypto.randomUUID();
    const newZone: Zone = {
      zoneId,
      companyId: get().companyId ?? '',
      kind: 'system',
      archetype: preset.archetype,
      label: preset.label,
      accentColor: preset.accentColor,
      floorColor: preset.floorColor,
      cx: x,
      cz: z,
      w: preset.w,
      d: preset.d,
      targetRoles: preset.targetRoles,
      allowedCategories: preset.allowedCategories,
      activityTypes: preset.activityTypes,
      deskSlots: preset.deskSlots,
      sortOrder: zones.length,
    };
    const newInstances: PlacedInstance[] = preset.prefabs.map((prefab) => ({
      id: generateId(),
      prefabId: prefab.prefabId,
      position: [x + prefab.offsetX, 0, z + prefab.offsetZ] as [number, number, number],
      rotation: prefab.rotation ?? 0,
      zoneId,
    }));
    set({ zones: [...zones, newZone], instances: [...instances, ...newInstances], dirty: true });
  },
  focusZone: (zoneId) =>
    set({ focusedZoneId: zoneId, selectedZoneId: zoneId, selectedInstanceId: null }),
  unfocusZone: () =>
    set({
      focusedZoneId: null,
      selectedZoneId: null,
      selectedInstanceId: null,
      isEditingZone: false,
    }),

  enterEditZone: (zoneId) =>
    set({
      focusedZoneId: zoneId,
      selectedZoneId: zoneId,
      selectedInstanceId: null,
      isEditingZone: true,
      tool: 'select',
      placingPrefab: null,
      placingZonePreset: null,
    }),
  exitEditZone: () =>
    set({
      focusedZoneId: null,
      selectedZoneId: null,
      selectedInstanceId: null,
      isEditingZone: false,
    }),

  selectZone: (zoneId) => set({ selectedZoneId: zoneId, selectedInstanceId: null }),

  startZonePlacement: (preset) =>
    set({
      tool: 'place',
      placingZonePreset: preset,
      placingPrefab: null,
      ghostRotation: 0,
      selectedInstanceId: null,
      selectedZoneId: null,
    }),

  cancelZonePlacement: () => set({ tool: 'select', placingZonePreset: null }),

  placeZoneFromPreset: (position, allPrefabsMap) => {
    const { placingZonePreset } = get();
    if (!placingZonePreset) return;
    void allPrefabsMap;
    get().addZoneFromPreset(placingZonePreset, position);
  },

  moveZone: (zoneId, newCx, newCz) => get().updateZonePosition(zoneId, newCx, newCz),

  removeZone: (zoneId) => {
    const { zones, instances } = get();
    const zone = zones.find((z) => z.zoneId === zoneId);
    if (!zone) return;
    if (isRequiredArchetype(zone.archetype)) return;
    set({
      zones: zones.filter((z) => z.zoneId !== zoneId),
      instances: instances.filter((i) => i.zoneId !== zoneId),
      selectedZoneId: null,
      dirty: true,
    });
  },
  deleteZone: (zoneId) => get().removeZone(zoneId),

  swapZoneVariant: (zoneId, preset, allPrefabsMap) => {
    const { zones, instances } = get();
    const zone = zones.find((z) => z.zoneId === zoneId);
    if (!zone) return;
    const { cx, cz } = zone;
    const newInstances: PlacedInstance[] = preset.prefabs
      .filter((p) => allPrefabsMap.has(p.prefabId))
      .map((p) => ({
        id: generateId(),
        prefabId: p.prefabId,
        position: [cx + p.offsetX, 0, cz + p.offsetZ] as [number, number, number],
        rotation: p.rotation ?? 0,
        zoneId,
      }));
    set({
      zones: zones.map((z) =>
        z.zoneId === zoneId
          ? {
              ...z,
              archetype: preset.archetype,
              label: preset.label,
              accentColor: preset.accentColor,
              floorColor: preset.floorColor,
              w: preset.w,
              d: preset.d,
              deskSlots: preset.deskSlots,
              targetRoles: preset.targetRoles,
              allowedCategories: preset.allowedCategories,
              activityTypes: preset.activityTypes,
            }
          : z,
      ),
      instances: [...instances.filter((i) => i.zoneId !== zoneId), ...newInstances],
      dirty: true,
    });
  },

  updateZoneLabel: (zoneId, label) =>
    set((s) => ({
      zones: s.zones.map((z) => (z.zoneId === zoneId ? { ...z, label } : z)),
      dirty: true,
    })),

  markClean: () => set({ dirty: false }),
}));
