// ── Office Editor Types ─────────────────────────────────────────────
// Data structures for the 2D spatial editor.

import type { ZoneType } from '../tokens/departments.js';

/** Active tool in the editor toolbar. */
export type EditorTool = 'select' | 'draw-zone' | 'place-desk' | 'place-room';

/** Room sub-types that can be placed via the room tool. */
export type RoomType = 'meeting_room' | 'library' | 'rest_area' | 'server_room';

/** Visual theme preset for the office. */
export type OfficeTheme = 'default' | 'dark' | 'warm';

/** Editor-level zone definition (editable). */
export interface EditorZone {
  id: string;
  type: ZoneType | 'server_room';
  label: string;
  labelEn: string;
  x: number;
  y: number;
  width: number;
  height: number;
  floorColor: number;
}

/** Editor-level desk definition. */
export interface EditorDesk {
  id: string;
  zoneId: string;
  x: number;
  y: number;
  /** Optional rack/slot assignments */
  rackId?: string;
  slotIds?: string[];
}

/** Editor-level room definition. */
export interface EditorRoom {
  id: string;
  type: RoomType;
  label: string;
  x: number;
  y: number;
  width: number;
  height: number;
  floorColor: number;
}

/** Complete office layout template. */
export interface OfficeTemplate {
  name: string;
  theme: OfficeTheme;
  zones: EditorZone[];
  desks: EditorDesk[];
  rooms: EditorRoom[];
  /** Canvas dimensions */
  canvasWidth: number;
  canvasHeight: number;
}

/** Selection state — what element is currently selected in the editor. */
export type EditorSelection =
  | { kind: 'none' }
  | { kind: 'zone'; id: string }
  | { kind: 'desk'; id: string }
  | { kind: 'room'; id: string };

/** Events emitted by the editor controller via the EventBus. */
export interface EditorStateSnapshot {
  tool: EditorTool;
  theme: OfficeTheme;
  selection: EditorSelection;
  zones: EditorZone[];
  desks: EditorDesk[];
  rooms: EditorRoom[];
  gridVisible: boolean;
  canvasWidth: number;
  canvasHeight: number;
}

/** Theme color palettes. */
export const THEME_PALETTES: Record<OfficeTheme, {
  background: number;
  gridColor: number;
  gridAlpha: number;
  zoneAlpha: number;
}> = {
  default: { background: 0x111827, gridColor: 0x6b7280, gridAlpha: 0.15, zoneAlpha: 1.0 },
  dark: { background: 0x0a0a0a, gridColor: 0x4b5563, gridAlpha: 0.12, zoneAlpha: 0.9 },
  warm: { background: 0x1c1410, gridColor: 0x92764a, gridAlpha: 0.18, zoneAlpha: 1.0 },
};

/** Default zone colors by type. */
export const ZONE_TYPE_COLORS: Record<string, number> = {
  department: 0x2a3a5c,
  library: 0x2a5c3a,
  rest_area: 0x4a4a3a,
  meeting_room: 0x3a4a5c,
  server_room: 0x3a2a2a,
};

/** Department sub-type colors. */
export const DEPT_COLORS: Record<string, number> = {
  DEV: 0x2a3a5c,
  PROD: 0x3a2a5c,
  ART: 0x6b4530,
  CUSTOM: 0x3a3a5c,
};
