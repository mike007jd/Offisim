import { create } from 'zustand';
import type { PrefabDefinition } from '@aics/shared-types';

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
  width: number;  // 3D X axis
  depth: number;  // 3D Z axis
}

export const PLOT_SIZES: PlotSize[] = [
  { name: '\u5c0f\u578b\u5de5\u4f5c\u5ba4', width: 20, depth: 15 },
  { name: '\u6807\u51c6\u529e\u516c\u5ba4', width: 40, depth: 30 },
  { name: '\u5927\u578b\u529e\u516c\u697c', width: 60, depth: 45 },
  { name: '\u56ed\u533a', width: 80, depth: 60 },
];

export interface StudioStore {
  // State
  tool: StudioTool;
  plotSize: PlotSize;
  placingPrefab: PrefabDefinition | null;
  selectedInstanceId: string | null;
  instances: PlacedInstance[];
  dirty: boolean;
  gridSnap: boolean;

  // Actions
  setTool: (tool: StudioTool) => void;
  setPlotSize: (size: PlotSize) => void;
  startPlacement: (def: PrefabDefinition) => void;
  cancelPlacement: () => void;
  placeInstance: (position: [number, number, number], zoneId: string) => void;
  selectInstance: (id: string | null) => void;
  deleteSelected: () => void;
  updatePosition: (id: string, position: [number, number, number]) => void;
  updateRotation: (id: string, rotation: 0 | 90 | 180 | 270) => void;
  rotateSelected: () => void;
  toggleGridSnap: () => void;
  setInstances: (instances: PlacedInstance[]) => void;
  markClean: () => void;
}

let _nextId = 0;
function generateId(): string {
  return `studio-${Date.now()}-${_nextId++}`;
}

export const useStudioStore = create<StudioStore>((set, get) => ({
  tool: 'select',
  plotSize: PLOT_SIZES[1]!, // 标准办公室
  placingPrefab: null,
  selectedInstanceId: null,
  instances: [],
  dirty: false,
  gridSnap: true,

  setTool: (tool) => set({ tool, placingPrefab: tool !== 'place' ? null : get().placingPrefab }),
  setPlotSize: (plotSize) => set({ plotSize, dirty: true }),

  startPlacement: (def) => set({ tool: 'place', placingPrefab: def, selectedInstanceId: null }),
  cancelPlacement: () => set({ tool: 'select', placingPrefab: null }),

  placeInstance: (position, zoneId) => {
    const { placingPrefab, instances } = get();
    if (!placingPrefab) return;
    const instance: PlacedInstance = {
      id: generateId(),
      prefabId: placingPrefab.prefabId,
      position,
      rotation: 0,
      zoneId,
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

  updatePosition: (id, position) => set((s) => ({
    instances: s.instances.map((i) => (i.id === id ? { ...i, position } : i)),
    dirty: true,
  })),

  updateRotation: (id, rotation) => set((s) => ({
    instances: s.instances.map((i) => (i.id === id ? { ...i, rotation } : i)),
    dirty: true,
  })),

  rotateSelected: () => {
    const { selectedInstanceId, instances } = get();
    if (!selectedInstanceId) return;
    const ROTATIONS: Array<0 | 90 | 180 | 270> = [0, 90, 180, 270];
    set({
      instances: instances.map((i) => {
        if (i.id !== selectedInstanceId) return i;
        const idx = ROTATIONS.indexOf(i.rotation);
        return { ...i, rotation: ROTATIONS[(idx + 1) % 4]! };
      }),
      dirty: true,
    });
  },

  toggleGridSnap: () => set((s) => ({ gridSnap: !s.gridSnap })),
  setInstances: (instances) => set({ instances, dirty: false }),
  markClean: () => set({ dirty: false }),
}));
