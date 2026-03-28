// @offisim/renderer — pure logic: prefab catalog, state machines, layout engine, tokens
// No rendering engine dependency (PixiJS removed; 3D = Three.js, 2D = SVG).

// Tokens — colors, motion buckets, state-feedback matrix, departments/zones
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

// Layout engine — pure algorithm
export { computeFloorPlan, computeRestAreaSeats } from './layout/zone-layout-engine.js';
export type {
  OfficeFloorPlan,
  ZoneBounds,
  DeskPosition,
  FloorPlanOptions,
} from './layout/zone-layout-engine.js';

// Prefab system — catalog, state machines, event router, default layouts
export * from './prefab/index.js';
