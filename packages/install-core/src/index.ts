// @aics/install-core — Phase 6 install system

// ---------------------------------------------------------------------------
// Type re-exports from types.ts
// ---------------------------------------------------------------------------
export type {
  TransitionMap,
  TransitionResult,
  ExtractedPackage,
  IntegrityResult,
  RuntimeEnvironment,
  CompatibilityError,
  CompatibilityResult,
  BindingRequirement,
  InstallPlan,
  PlanResult,
  BindingConfirmation,
  InstallTransactionRow,
  InstalledPackageRow,
  InstalledAssetRow,
  AssetBindingRow,
  NewEmployee,
  InstallRepositories,
  InstallEventEmitter,
} from './types.js';

// ---------------------------------------------------------------------------
// State machine
// ---------------------------------------------------------------------------
export {
  TRANSITIONS,
  validateTransition,
  isTerminalState,
  isErrorState,
} from './state-machine.js';

// ---------------------------------------------------------------------------
// Manifest loader
// ---------------------------------------------------------------------------
export { extractPackage } from './manifest-loader.js';

// ---------------------------------------------------------------------------
// Integrity checker
// ---------------------------------------------------------------------------
export { checkIntegrity } from './integrity-checker.js';

// ---------------------------------------------------------------------------
// Compatibility checker
// ---------------------------------------------------------------------------
export {
  checkCompatibility,
  parseVersionRange,
  compareVersions,
} from './compatibility-checker.js';

// ---------------------------------------------------------------------------
// Binding resolver
// ---------------------------------------------------------------------------
export { resolveBindings } from './binding-resolver.js';

// ---------------------------------------------------------------------------
// Install planner
// ---------------------------------------------------------------------------
export { createInstallPlan } from './install-planner.js';
