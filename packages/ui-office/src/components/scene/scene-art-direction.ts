import type { Scene3DColors } from '@offisim/ui-core/tokens';
import { ROOM_H, ROOM_W, SCALE } from './office-2d-canvas-geometry.js';

export const OFFICE_ROOM = {
  width: ROOM_W / SCALE,
  depth: ROOM_H / SCALE,
  wallHeight: 5,
  tileSize: 2,
  trimHeight: 0.18,
} as const;

export const OFFICE_CAMERA_PRESET = {
  position: [0, 22, 28] as [number, number, number],
  target: [0, 0, 2] as [number, number, number],
  fov: 45,
  minDistance: 5,
  maxDistance: 45,
} as const;

export const SCENE_LAYER_Y = {
  floor: 0,
  tile: 0.012,
  zoneRug: 0.021,
  zoneBorder: 0.032,
  dragGhost: 0.04,
} as const;

export const ZONE_ART = {
  idleOpacity: 0.1,
  activeOpacity: 0.16,
  dragOpacity: 0.24,
  hoverOpacity: 0.34,
  borderIdleOpacity: 0.34,
  borderDragOpacity: 0.62,
  borderHoverOpacity: 0.9,
} as const;

export const FLOOR_BANDS = [
  {
    id: 'central-runway',
    widthOffset: 2.2,
    depth: 5.2,
    z: 0,
    layerOffset: 0.006,
    colorToken: 'floorTileAlt',
    opacity: 0.34,
    roughness: 0.62,
  },
  {
    id: 'back-service-band',
    widthOffset: 3.4,
    depth: 3.6,
    z: -8.4,
    layerOffset: 0.007,
    colorToken: 'floorTileAlt',
    opacity: 0.22,
    roughness: 0.62,
  },
  {
    id: 'front-threshold',
    widthOffset: 1.5,
    depth: 1.2,
    z: 13.5,
    layerOffset: 0.008,
    colorToken: 'floorBorder',
    opacity: 0.24,
    roughness: 0.68,
  },
] as const satisfies readonly {
  id: string;
  widthOffset: number;
  depth: number;
  z: number;
  layerOffset: number;
  colorToken: keyof Scene3DColors;
  opacity: number;
  roughness: number;
}[];

export const WALL_PANELS = [-13.5, -4.5, 4.5, 13.5].map((x) => ({
  id: `back-panel-${x}`,
  x,
  y: 2.78,
  width: 7.2,
  height: 3.6,
  depth: 0.08,
})) as readonly {
  id: string;
  x: number;
  y: number;
  width: number;
  height: number;
  depth: number;
}[];

export const ROOM_GRID = {
  minorStep: OFFICE_ROOM.tileSize,
  majorStep: 10,
  minorOpacity: 0.18,
  majorOpacity: 0.22,
} as const;

export function getZoneRugOpacity({
  isDragging,
  isHovered,
  isSource,
  activityCount,
}: {
  isDragging: boolean;
  isHovered: boolean;
  isSource: boolean;
  activityCount: number;
}) {
  if (isDragging) {
    if (isSource) return 0.06;
    return isHovered ? ZONE_ART.hoverOpacity : ZONE_ART.dragOpacity;
  }
  return activityCount > 0 ? ZONE_ART.activeOpacity : ZONE_ART.idleOpacity;
}

export function getZoneBorderOpacity({
  isDragging,
  isHovered,
  isSource,
}: {
  isDragging: boolean;
  isHovered: boolean;
  isSource: boolean;
}) {
  if (!isDragging) return ZONE_ART.borderIdleOpacity;
  if (isSource) return 0.24;
  return isHovered ? ZONE_ART.borderHoverOpacity : ZONE_ART.borderDragOpacity;
}

export function createTileLineColor(sc: Scene3DColors, emphasis: 'major' | 'minor') {
  return emphasis === 'major' ? sc.floorBorder : sc.floorGrid;
}
