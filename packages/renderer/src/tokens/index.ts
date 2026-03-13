export { STATE_COLORS, SCENE_COLORS } from './colors.js';
export {
  MOTION,
  MOTION_REDUCED,
  MOTION_TIER_A,
  MOTION_TIER_B,
  MOTION_TIER_C,
  getMotionForTier,
  type MotionBucket,
  type PerformanceTier,
  type MotionTokens,
} from './motion.js';
export {
  EMPLOYEE_STATE_SIGNALS,
  SIGNAL_PRIORITY_ORDER,
  resolveCompetingSignals,
  type SceneSignalType,
  type SignalPriority,
  type StateSignal,
} from './state-feedback-matrix.js';
export {
  RD_COMPANY_DEPARTMENTS,
  RD_COMPANY_ZONES,
  resolveEmployeeDepartment,
  type DepartmentConfig,
  type ZoneConfig,
  type ZoneType,
} from './departments.js';
