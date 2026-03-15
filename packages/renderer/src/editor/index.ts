// ── Office Editor Module ────────────────────────────────────────────
// 2D spatial editor for office layout design.

export { OfficeEditorController } from './office-editor-controller.js';
export { EditorGrid, GRID_SIZE } from './editor-grid.js';
export { SelectionHandler } from './selection-handler.js';
export type { ResizeCorner } from './selection-handler.js';
export { ZoneTool } from './zone-tool.js';
export { DeskTool } from './desk-tool.js';
export { RoomTool, DEFAULT_ROOM_SIZES, ROOM_LABELS } from './room-tool.js';
export {
  THEME_PALETTES,
  ZONE_TYPE_COLORS,
  DEPT_COLORS,
} from './types.js';
export type {
  EditorTool,
  RoomType,
  OfficeTheme,
  EditorZone,
  EditorDesk,
  EditorRoom,
  OfficeTemplate,
  EditorSelection,
  EditorStateSnapshot,
} from './types.js';
