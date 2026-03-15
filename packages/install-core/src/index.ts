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

// ---------------------------------------------------------------------------
// Install service (D.1)
// ---------------------------------------------------------------------------
export { InstallService, InstallServiceError } from './install-service.js';
export type { InstallServiceDeps, ImportResult, SkillImportResult } from './install-service.js';

// ---------------------------------------------------------------------------
// Materializer (D.2)
// ---------------------------------------------------------------------------
export { materialize } from './materializer.js';
export type { MaterializeResult } from './materializer.js';

// ---------------------------------------------------------------------------
// Rollback (D.3)
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
// OpenClaw skill integration
// ---------------------------------------------------------------------------
export { parseSkill, SkillParseError } from './openclaw/index.js';
export { validateSkill } from './openclaw/index.js';
export { skillToManifest } from './openclaw/index.js';
export type {
  ParsedSkill,
  SkillRequirements,
  SkillMetadata,
  SkillValidationResult,
  SkillValidationWarning,
} from './openclaw/index.js';
