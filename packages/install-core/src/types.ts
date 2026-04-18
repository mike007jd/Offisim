/**
 * install-core type contracts and DI interfaces.
 *
 * This file is the single source of truth for the install system's type layer.
 * It MUST NOT import from @offisim/core to avoid circular dependencies.
 * Consumers in @offisim/core implement these interfaces via adapters.
 *
 * Source contracts:
 * - offisim_install_state_machine.md (state machine, transitions)
 * - offisim_local_runtime_schema.sql (DB row shapes)
 * - manifest-1.0.0.json (manifest types from @offisim/asset-schema)
 */

import type { AssetKind, PackageManifest, SupportedEnvironment } from '@offisim/asset-schema';
import type {
  BindingStatus,
  BindingType,
  InstallSourceType,
  InstallState,
} from '@offisim/shared-types';

// ---------------------------------------------------------------------------
// State Machine
// ---------------------------------------------------------------------------

/** Map of (fromState → Set of valid toStates). */
export type TransitionMap = ReadonlyMap<InstallState, ReadonlySet<InstallState>>;

/** Result of a transition validation. */
export interface TransitionResult {
  readonly valid: boolean;
  readonly from: InstallState;
  readonly to: InstallState;
  readonly reason?: string;
}

// ---------------------------------------------------------------------------
// Manifest Loader
// ---------------------------------------------------------------------------

/** Result of extracting and parsing a .offisimpkg ZIP archive. */
export interface ExtractedPackage {
  readonly manifest: PackageManifest;
  /** All files in the archive keyed by relative path. */
  readonly files: ReadonlyMap<string, Uint8Array>;
  /** SHA-256 hex hash of the entire archive. */
  readonly packageHash: string;
  /** SHA-256 hex hash of the manifest.json bytes. */
  readonly manifestHash: string;
}

// ---------------------------------------------------------------------------
// Integrity Checker
// ---------------------------------------------------------------------------

export interface IntegrityResult {
  readonly valid: boolean;
  readonly packageHashMatch: boolean;
  readonly fileHashErrors: readonly string[];
}

// ---------------------------------------------------------------------------
// Compatibility Checker
// ---------------------------------------------------------------------------

/** Describes the current runtime environment for compatibility checks. */
export interface RuntimeEnvironment {
  /** Semantic version of the Offisim runtime (e.g. "1.0.0"). */
  readonly runtimeVersion: string;
  /** Current environment type. */
  readonly environment: SupportedEnvironment;
  /** Current schema version string (e.g. "2026-03"). */
  readonly schemaVersion: string;
}

export interface CompatibilityError {
  readonly code: 'runtime_range' | 'environment' | 'schema_version';
  readonly message: string;
}

export interface CompatibilityResult {
  readonly compatible: boolean;
  readonly errors: readonly CompatibilityError[];
}

// ---------------------------------------------------------------------------
// Binding Resolver
// ---------------------------------------------------------------------------

/** A single binding requirement extracted from the manifest. */
export interface BindingRequirement {
  readonly assetId: string;
  readonly assetKind: AssetKind;
  readonly bindingType: BindingType;
  readonly bindingKey: string;
  readonly required: boolean;
  readonly hint?: string;
  readonly providerHints?: readonly string[];
}

// ---------------------------------------------------------------------------
// Install Planner
// ---------------------------------------------------------------------------

/** Full install plan produced after all pre-install checks pass. */
export interface InstallPlan {
  readonly manifest: PackageManifest;
  readonly compatibility: CompatibilityResult;
  readonly bindings: readonly BindingRequirement[];
  readonly needsConfirmation: boolean;
  readonly confirmationReasons: readonly string[];
  readonly packageHash: string;
  readonly manifestHash: string;
}

/** Result of the planning phase. */
export type PlanResult =
  | { readonly ok: true; readonly plan: InstallPlan }
  | {
      readonly ok: false;
      readonly stage: string;
      readonly error: string;
      readonly errorCode?: string;
    };

// ---------------------------------------------------------------------------
// User Input
// ---------------------------------------------------------------------------

/** User-submitted binding value. */
export interface BindingConfirmation {
  readonly bindingKey: string;
  readonly bindingType: BindingType;
  readonly valueJson: string;
}

export interface InstallImportDescriptor {
  readonly listing_id?: string;
  readonly package_version_id?: string;
}

export interface InstallImportOptions {
  readonly sourceType?: InstallSourceType;
  readonly sourceRef?: string | null;
  readonly targetPackageId?: string | null;
  readonly targetVersion?: string | null;
  readonly descriptor?: InstallImportDescriptor | null;
}

export interface InstallProvenance {
  readonly originListingId: string;
  readonly originPackageVersionId: string;
}

// ---------------------------------------------------------------------------
// DB Row Types (mirrors offisim_local_runtime_schema.sql)
// ---------------------------------------------------------------------------

export interface InstallTransactionRow {
  readonly install_txn_id: string;
  readonly company_id: string;
  readonly source_type: InstallSourceType;
  readonly source_ref: string | null;
  readonly target_package_id: string | null;
  readonly target_version: string | null;
  readonly state: InstallState;
  readonly error_code: string | null;
  readonly error_detail: string | null;
  readonly descriptor_json: string | null;
  readonly actor_type: string;
  readonly started_at: string;
  readonly finished_at: string | null;
}

export interface InstalledPackageRow {
  readonly installed_package_id: string;
  readonly company_id: string;
  readonly package_id: string;
  readonly package_kind: AssetKind;
  readonly version: string;
  readonly source_type: InstallSourceType;
  readonly source_ref: string | null;
  readonly manifest_hash: string;
  readonly package_hash: string;
  readonly install_state: InstallState;
  readonly enabled: number;
  readonly origin_listing_id: string | null;
  readonly origin_package_version_id: string | null;
  readonly installed_at: string;
  readonly updated_at: string;
}

export interface InstalledAssetRow {
  readonly installed_asset_id: string;
  readonly installed_package_id: string;
  readonly asset_id: string;
  readonly asset_kind: AssetKind;
  readonly local_instance_id: string | null;
  readonly entrypoint: string | null;
  readonly enabled: number;
  readonly override_json: string | null;
  readonly created_at: string;
  readonly updated_at: string;
}

export interface AssetBindingRow {
  readonly binding_id: string;
  readonly installed_asset_id: string | null;
  readonly install_txn_id: string | null;
  readonly binding_type: BindingType;
  readonly binding_key: string;
  readonly binding_value_json: string | null;
  readonly status: BindingStatus;
  readonly created_at: string;
  readonly updated_at: string;
}

// ---------------------------------------------------------------------------
// New Employee (for materialization)
// ---------------------------------------------------------------------------

/** Data needed to create a new employee (from install or UI editor). */
export interface NewEmployee {
  /** Optional pre-generated ID. When provided, the repo MUST use it instead of generating its own. */
  readonly employee_id?: string;
  readonly company_id: string;
  readonly name: string;
  readonly role_slug: string;
  /** Null for UI-created employees, non-null for installed assets. */
  readonly source_asset_id: string | null;
  /** Null for UI-created employees, non-null for installed packages. */
  readonly source_package_id: string | null;
  readonly persona_json?: string;
  readonly config_json?: string;
  /** When true, dispatch routes to A2A transport instead of LLM adapter. */
  readonly is_external?: boolean;
  readonly a2a_url?: string | null;
  readonly a2a_token?: string | null;
  readonly a2a_agent_id?: string | null;
  readonly brand_key?: string | null;
  readonly agent_card_json?: string | null;
}

// ---------------------------------------------------------------------------
// Dependency Injection Interfaces (avoids @offisim/core import)
// ---------------------------------------------------------------------------

/**
 * Repository facades that install-core needs.
 * @offisim/core provides memory and drizzle implementations.
 * apps/web bridges them via an adapter in OffisimRuntimeProvider.
 */
export interface InstallRepositories {
  readonly installTransactions: {
    create(txn: Omit<InstallTransactionRow, 'finished_at'>): Promise<InstallTransactionRow>;
    findById(id: string): Promise<InstallTransactionRow | null>;
    updateState(
      id: string,
      state: InstallState,
      errorCode?: string,
      errorDetail?: string,
    ): Promise<void>;
    finish(id: string, state: InstallState): Promise<void>;
  };
  readonly installedPackages: {
    create(pkg: InstalledPackageRow): Promise<InstalledPackageRow>;
    findByPackageId(companyId: string, packageId: string): Promise<InstalledPackageRow[]>;
    /** Delete an installed package by ID. Used during rollback. */
    delete(id: string): Promise<void>;
  };
  readonly installedAssets: {
    create(asset: InstalledAssetRow): Promise<InstalledAssetRow>;
    /** Delete an installed asset by ID. Used during rollback. */
    delete(id: string): Promise<void>;
  };
  readonly assetBindings: {
    create(binding: AssetBindingRow): Promise<AssetBindingRow>;
    findByTransaction(txnId: string): Promise<AssetBindingRow[]>;
    updateStatus(id: string, status: BindingStatus, valueJson?: string): Promise<void>;
    /** Delete a binding by ID. Used during rollback. */
    delete(id: string): Promise<void>;
  };
  readonly employees: {
    create(emp: NewEmployee): Promise<{ employee_id: string }>;
    /** Delete an employee by ID. Used during rollback. */
    delete(id: string): Promise<void>;
  };
}

/**
 * Event emission facade for install state changes.
 * @offisim/core's EventBus provides the concrete implementation.
 */
export interface InstallEventEmitter {
  emitInstallState(
    companyId: string,
    txnId: string,
    prev: InstallState,
    next: InstallState,
    packageId?: string,
    errorCode?: string,
  ): void;
  emitBindingState(
    companyId: string,
    bindingId: string,
    txnId: string,
    type: BindingType,
    key: string,
    prev: BindingStatus,
    next: BindingStatus,
  ): void;
}
