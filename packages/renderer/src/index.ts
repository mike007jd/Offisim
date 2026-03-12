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
export { STATE_COLORS, MOTION, LAYOUT } from './tokens/index.js';
export type { MotionBucket } from './tokens/index.js';

// Entity types — normal employees (human avatar) + OpenClaw agents (lobster)
export { EmployeeEntity } from './entities/employee-entity.js';
export { LobsterEntity } from './entities/lobster-entity.js';
export { RouteLineEntity } from './entities/route-line-entity.js';
export { drawPixelGrid, idToHue } from './pixel/draw-pixel-grid.js';
export { PX, PIXEL_PALETTE } from './pixel/pixel-palette.js';
