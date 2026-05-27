// @offisim/install-core — Phase 6 install system

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
  InstallImportDescriptor,
  InstallImportOptions,
  InstallProvenance,
  InstallTransactionRow,
  InstalledPackageRow,
  InstalledAssetRow,
  AssetBindingRow,
  NewEmployee,
  NewSkill,
  InstallVaultFileSystem,
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

// ---------------------------------------------------------------------------
// Install service (D.1)
// ---------------------------------------------------------------------------
export { InstallService, InstallServiceError } from './install-service.js';
export type { InstallServiceDeps, ImportResult } from './install-service.js';

// ---------------------------------------------------------------------------
// Materializer (D.2)
// ---------------------------------------------------------------------------
export { materialize } from './materializer.js';
export type { MaterializeResult } from './materializer.js';

// ---------------------------------------------------------------------------
// Rollback (reverse materialization on failure)
// ---------------------------------------------------------------------------
export { rollback } from './rollback.js';

// ---------------------------------------------------------------------------
// Upgrade differ (PRD 3.5)
// ---------------------------------------------------------------------------
export { computeUpgradeDiff } from './upgrade-differ.js';
export type {
  DiffSeverity,
  DiffCategory,
  DiffEntry,
  UpgradeDiff,
} from './upgrade-differ.js';

// ---------------------------------------------------------------------------
// File importer (D.4)
// ---------------------------------------------------------------------------
export { readPackageFile, FileImportError } from './file-importer.js';

// ---------------------------------------------------------------------------
// Package builder (Market publish artifacts)
// ---------------------------------------------------------------------------
export { artifactBytesToBase64, buildPackageArtifact } from './package-builder.js';
export type { BuildPackageArtifactInput, BuiltPackageArtifact } from './package-builder.js';
