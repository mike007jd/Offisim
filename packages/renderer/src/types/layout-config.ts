export interface WorkstationConfig {
  workstationId: string;
  label: string;
  roomType: 'office' | 'meeting' | 'server_room' | 'library';
}

export interface LayoutConfig {
  gridCols: number;
  gridRows: number;
  workstations: WorkstationConfig[];
}

export const LAYOUT_PRESETS: Record<string, LayoutConfig> = {
  '2x2': {
    gridCols: 2,
    gridRows: 2,
    workstations: [
      { workstationId: 'ws-1', label: 'Workstation 1', roomType: 'office' },
      { workstationId: 'ws-2', label: 'Workstation 2', roomType: 'office' },
      { workstationId: 'ws-3', label: 'Workstation 3', roomType: 'office' },
      { workstationId: 'ws-4', label: 'Workstation 4', roomType: 'office' },
    ],
  },
  '2x3': {
    gridCols: 2,
    gridRows: 3,
    workstations: [
      { workstationId: 'ws-1', label: 'Workstation 1', roomType: 'office' },
      { workstationId: 'ws-2', label: 'Workstation 2', roomType: 'office' },
      { workstationId: 'ws-3', label: 'Workstation 3', roomType: 'office' },
      { workstationId: 'ws-4', label: 'Workstation 4', roomType: 'office' },
      { workstationId: 'ws-5', label: 'Workstation 5', roomType: 'meeting' },
      { workstationId: 'ws-6', label: 'Workstation 6', roomType: 'office' },
    ],
  },
  '3x3': {
    gridCols: 3,
    gridRows: 3,
    workstations: [
      { workstationId: 'ws-1', label: 'Workstation 1', roomType: 'office' },
      { workstationId: 'ws-2', label: 'Workstation 2', roomType: 'office' },
      { workstationId: 'ws-3', label: 'Workstation 3', roomType: 'office' },
      { workstationId: 'ws-4', label: 'Workstation 4', roomType: 'office' },
      { workstationId: 'ws-5', label: 'Workstation 5', roomType: 'meeting' },
      { workstationId: 'ws-6', label: 'Workstation 6', roomType: 'office' },
      { workstationId: 'ws-7', label: 'Workstation 7', roomType: 'server_room' },
      { workstationId: 'ws-8', label: 'Workstation 8', roomType: 'library' },
      { workstationId: 'ws-9', label: 'Workstation 9', roomType: 'office' },
    ],
  },
};

export function getPreset(name: string): LayoutConfig {
  return LAYOUT_PRESETS[name] ?? LAYOUT_PRESETS['2x2']!;
}
