// @aics/renderer — PixiJS 8 + GSAP 3 office scene renderer
export { SceneManager } from './core/scene-manager.js';
export type {
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
  LAYOUT,
  MOTION_TIER_A,
  MOTION_TIER_B,
  MOTION_TIER_C,
  getMotionForTier,
  AVATAR,
  FURNITURE,
  STATE_BADGE,
  EMPLOYEE_STATE_SIGNALS,
  SIGNAL_PRIORITY_ORDER,
  resolveCompetingSignals,
} from './tokens/index.js';
export type {
  MotionBucket,
  PerformanceTier,
  MotionTokens,
  SceneSignalType,
  SignalPriority,
  StateSignal,
} from './tokens/index.js';

// Entity types — normal employees (human avatar) + OpenClaw agents (lobster)
export { EmployeeEntity } from './entities/employee-entity.js';
export { LobsterEntity } from './entities/lobster-entity.js';
export { RouteLineEntity } from './entities/route-line-entity.js';
export { drawPixelGrid, idToHue } from './pixel/draw-pixel-grid.js';
export { PX, PIXEL_PALETTE } from './pixel/pixel-palette.js';

// Animations
export { AmbientSystem } from './animations/ambient-system.js';

// Interaction
export { InteractionController } from './interaction/interaction-controller.js';
export type { DragResult } from './interaction/interaction-controller.js';

// Layers
export { DEFAULT_WORKSTATION_IDS, FloorLayer } from './layers/floor-layer.js';
export type { DeskPosition, WorkstationBounds } from './layers/floor-layer.js';

// Layout config
export { type LayoutConfig, type WorkstationConfig, LAYOUT_PRESETS, getPreset } from './types/layout-config.js';
