// @aics/renderer — PixiJS 8 + GSAP 3 office scene renderer

// Illustration system (SVG-based character assembly)
export * from './illustration/index.js';
export { SceneManager } from './core/scene-manager.js';
export type {
  BubbleInfo,
  SceneEventBus,
  SceneManagerOptions,
  SceneEntity,
  SceneEntityType,
  EmployeeSeed,
  NodeVisualMapping,
} from './core/types.js';
export { LAYER_NAMES } from './core/types.js';
export type { LayerName, SceneLayers } from './core/types.js';
export {
  STATE_COLORS,
  MOTION,
  MOTION_TIER_A,
  MOTION_TIER_B,
  MOTION_TIER_C,
  getMotionForTier,
  EMPLOYEE_STATE_SIGNALS,
  SIGNAL_PRIORITY_ORDER,
  resolveCompetingSignals,
  RD_COMPANY_DEPARTMENTS,
  RD_COMPANY_ZONES,
  resolveEmployeeDepartment,
} from './tokens/index.js';
export type {
  MotionBucket,
  PerformanceTier,
  MotionTokens,
  SceneSignalType,
  SignalPriority,
  StateSignal,
  DepartmentConfig,
  ZoneConfig,
  ZoneType,
} from './tokens/index.js';

// Puppet system — modular paper-doll characters
export { EmployeePuppet } from './puppet/employee-puppet.js';
export { LobsterPuppet } from './puppet/lobster-puppet.js';
export { BasePuppet } from './puppet/base-puppet.js';
export type { CharacterConfig, PuppetAnimState, HairStyle, BodyType, GenderPresentation } from './puppet/types.js';
export { DEFAULT_CHARACTER_CONFIGS, PUPPET } from './puppet/types.js';

// Layout engine
export { computeFloorPlan, computeRestAreaSeats } from './layout/zone-layout-engine.js';
export type { OfficeFloorPlan, ZoneBounds, DeskPosition, FloorPlanOptions } from './layout/zone-layout-engine.js';

// Entities
export { RouteLineEntity } from './entities/route-line-entity.js';
export { MeetingRoomEntity } from './entities/meeting-room-entity.js';
export { LibraryZoneEntity } from './entities/library-zone-entity.js';
export { InstallGhostEntity } from './entities/install-ghost-entity.js';
export type { InstallGhostConfig } from './entities/install-ghost-entity.js';
export { ServerRoomEntity } from './entities/server-room-entity.js';
export type { ServerStatus } from './entities/server-room-entity.js';

// Animations
export { AmbientSystem } from './animations/ambient-system.js';

// Systems
export { AttentionSystem } from './systems/attention-system.js';
export type { AttentionEvent } from './systems/attention-system.js';

// Interaction
export { InteractionController } from './interaction/interaction-controller.js';
export type { DragResult } from './interaction/interaction-controller.js';
export { CameraController } from './interaction/camera-controller.js';
export type { CameraControllerOptions } from './interaction/camera-controller.js';

// Layers
export { FloorLayer } from './layers/floor-layer.js';
export type { WorkstationBounds } from './layers/floor-layer.js';

// Editor — 2D spatial office layout editor
export {
  OfficeEditorController,
  EditorGrid,
  GRID_SIZE,
  SelectionHandler,
  ZoneTool,
  DeskTool,
  RoomTool,
  DEFAULT_ROOM_SIZES,
  ROOM_LABELS,
  THEME_PALETTES,
  ZONE_TYPE_COLORS,
  DEPT_COLORS,
} from './editor/index.js';
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
  ResizeCorner,
} from './editor/index.js';

// Shapes
export {
  drawDesk,
  drawChair,
  drawMonitor,
  drawBookshelf,
  drawReadingTable,
  drawSofa,
  drawCoffeeTable,
  drawPlant,
  drawVendingMachine,
  drawServerRack,
} from './shapes/furniture.js';
