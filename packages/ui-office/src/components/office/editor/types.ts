import type {
  ActivityType,
  RoleSlug,
  SemanticCategory,
  ZoneArchetype,
  ZoneKind,
} from '@offisim/shared-types';

/** A zone placed on the editor canvas. */
export interface EditorZone {
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
export interface PlacedItem {
  instanceId: string;
  prefabId: string;
  name: string;
  x: number;
  y: number;
  rotation: number;
  zoneId: string;
}

/** Drag state for zone repositioning. */
export interface DragState {
  zoneId: string;
  startMouseX: number;
  startMouseY: number;
  startCx: number;
  startCz: number;
  startItemPositions: Map<string, { x: number; y: number }>;
}

// ── SVG Layout Constants ────────────────────────────────────────────

export const SVG_W = 800;
export const SVG_H = 600;
export const SCALE = 18;
export const OX = SVG_W / 2;
export const OY = SVG_H / 2 - 20;

// ── Coordinate conversion ───────────────────────────────────────────

export function toSVG(cx: number, cz: number): { sx: number; sy: number } {
  return { sx: OX + cx * SCALE, sy: OY + cz * SCALE };
}

export function fromSVG(sx: number, sy: number): { wx: number; wz: number } {
  return { wx: (sx - OX) / SCALE, wz: (sy - OY) / SCALE };
}

export function editorZoneRect(z: EditorZone) {
  const { sx, sy } = toSVG(z.cx, z.cz);
  const w = z.w * SCALE;
  const h = z.d * SCALE;
  return { x: sx - w / 2, y: sy - h / 2, w, h };
}

export function prefabColor(category: SemanticCategory): string {
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
