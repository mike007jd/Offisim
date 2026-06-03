/**
 * InstallService — orchestrates the full install lifecycle.
 *
 * Each state change: validateTransition -> persist -> emit event.
 * All dependencies are injected via constructor (no @offisim/core imports).
 */

import type { InstallState } from '@offisim/shared-types';
import { createInstallPlan } from './install-planner.js';
import { materialize } from './materializer.js';
import type { MaterializeResult } from './materializer.js';
import { isTerminalState, validateTransition } from './state-machine.js';
import type {
  BindingConfirmation,
  InstallEventEmitter,
  InstallImportOptions,
  InstallPlan,
  InstallProvenance,
  InstallRepositories,
  InstallTransactionRow,
  InstalledPackageRow,
  RuntimeEnvironment,
} from './types.js';

// ---------------------------------------------------------------------------
// Error
// ---------------------------------------------------------------------------

export class InstallServiceError extends Error {
  readonly code: string;

  constructor(code: string, message: string) {
    super(message);
    this.name = 'InstallServiceError';
    this.code = code;
  }
}

// ---------------------------------------------------------------------------
// Dependencies
// ---------------------------------------------------------------------------

export interface InstallServiceDeps {
  readonly repos: InstallRepositories;
  readonly events: InstallEventEmitter;
  readonly companyId: string;
  readonly environment: RuntimeEnvironment;
  /**
   * Optional DB transaction wrapper from the Drizzle runtime.
   * When provided, materialize() wraps all writes in a single SQLite transaction.
   */
  readonly transact?: <T>(fn: () => T) => T;
  readonly asyncTransact?: <T>(fn: (txRepos?: InstallRepositories) => Promise<T>) => Promise<T>;
}

// ---------------------------------------------------------------------------
// Result types
// ---------------------------------------------------------------------------

export interface ImportResult {
  readonly installTxnId: string;
  readonly plan?: InstallPlan;
  readonly error?: string;
}

// ---------------------------------------------------------------------------
// In-memory plan cache
// ---------------------------------------------------------------------------

// ---------------------------------------------------------------------------
// InstallService
// ---------------------------------------------------------------------------

export class InstallService {
  private readonly repos: InstallRepositories;
  private readonly events: InstallEventEmitter;
  private readonly companyId: string;
  private readonly environment: RuntimeEnvironment;
  private readonly transact: (<T>(fn: () => T) => T) | undefined;
  private readonly asyncTransact:
    | (<T>(fn: (txRepos?: InstallRepositories) => Promise<T>) => Promise<T>)
    | undefined;
  private readonly planCache = new Map<string, InstallPlan>();
  private readonly materializeLocks = new Map<string, Promise<void>>();

  constructor(deps: InstallServiceDeps) {
    this.repos = deps.repos;
    this.events = deps.events;
    this.companyId = deps.companyId;
    this.environment = deps.environment;
    this.transact = deps.transact;
    this.asyncTransact = deps.asyncTransact;
  }

  // -------------------------------------------------------------------------
  // importFile
  // -------------------------------------------------------------------------

  /**
   * Import a .offisimpkg archive and run the pre-install pipeline.
   *
   * 1. Create install transaction (state: 'created')
   * 2. Run createInstallPlan (extract -> integrity -> compatibility -> bindings)
   * 3. Transition through states at each pipeline stage
   * 4. End in 'awaiting_confirmation' on success or 'failed' on error
   *
   * @param archiveBytes - Raw bytes of the .offisimpkg ZIP archive.
   * @returns ImportResult with txnId and either plan or error.
   */
  async importFile(
    archiveBytes: Uint8Array,
    options: InstallImportOptions = {},
  ): Promise<ImportResult> {
    // 1. Create transaction row
    const installTxnId = globalThis.crypto.randomUUID();
    const now = new Date().toISOString();
    const idempotencyKey = this.resolveIdempotencyKey(options);
    if (idempotencyKey) {
      const existing = await this.repos.installTransactions.findByIdempotencyKey(
        this.companyId,
        idempotencyKey,
      );
      if (existing && !this.allowsNewAttemptForIdempotency(existing.state)) {
        const cachedPlan = this.planCache.get(existing.install_txn_id);
        if (cachedPlan && !isTerminalState(existing.state)) {
          return { installTxnId: existing.install_txn_id, plan: cachedPlan };
        }
        if (existing.state === 'materializing') {
          await this.transitionToFailed(
            existing.install_txn_id,
            'materializing',
            'stale_materializing',
            'Install transaction was materializing without an in-memory plan and was marked failed so the registry install can be retried.',
          );
        } else {
          return {
            installTxnId: existing.install_txn_id,
            error:
              existing.error_detail ??
              `Install request already exists in state '${existing.state}' for idempotency key '${idempotencyKey}'.`,
          };
        }
      }
    }

    const txnRow: Omit<InstallTransactionRow, 'finished_at'> = {
      install_txn_id: installTxnId,
      company_id: this.companyId,
      source_type: options.sourceType ?? 'file',
      source_ref: options.sourceRef ?? null,
      target_package_id: options.targetPackageId ?? null,
      target_version: options.targetVersion ?? null,
      idempotency_key: idempotencyKey,
      state: 'created',
      error_code: null,
      error_detail: null,
      descriptor_json: options.descriptor ? JSON.stringify(options.descriptor) : null,
      actor_type: 'user',
      started_at: now,
    };

    await this.repos.installTransactions.create(txnRow);

    // 2. Run the install planner
    const expectedArtifactSha256 = options.expectedArtifactSha256?.trim() || undefined;
    const planResult = await createInstallPlan(
      archiveBytes,
      this.environment,
      expectedArtifactSha256,
    );

    if (!planResult.ok) {
      // Map the stage to the state we should transition through before failing
      const failStage = planResult.stage as InstallState;
      // Transition to the stage state if valid, then to failed
      await this.tryTransitionAndFail(
        installTxnId,
        'created',
        failStage,
        planResult.errorCode ?? 'plan_failed',
        planResult.error,
      );

      return { installTxnId, error: planResult.error };
    }

    // 3. Transition through the pipeline stages
    const plan = planResult.plan;

    // created -> manifest_loaded
    await this.transition(installTxnId, 'created', 'manifest_loaded');

    // manifest_loaded -> integrity_checked
    await this.transition(installTxnId, 'manifest_loaded', 'integrity_checked');

    // integrity_checked -> compatibility_checked
    await this.transition(installTxnId, 'integrity_checked', 'compatibility_checked');

    // compatibility_checked -> dependency_planned
    await this.transition(installTxnId, 'compatibility_checked', 'dependency_planned');

    // 4. Determine next state based on confirmation needs
    if (plan.needsConfirmation) {
      // dependency_planned -> awaiting_confirmation
      await this.transition(
        installTxnId,
        'dependency_planned',
        'awaiting_confirmation',
        plan.manifest.package.id,
      );
    } else if (plan.bindings.length > 0) {
      // dependency_planned -> awaiting_bindings (skip confirmation)
      await this.transition(
        installTxnId,
        'dependency_planned',
        'awaiting_bindings',
        plan.manifest.package.id,
      );
    } else {
      // No confirmation needed, no bindings -> ready_to_install
      await this.transition(
        installTxnId,
        'dependency_planned',
        'ready_to_install',
        plan.manifest.package.id,
      );
    }

    // Cache the plan for confirmBindings
    this.planCache.set(installTxnId, plan);

    return { installTxnId, plan };
  }

  private allowsNewAttemptForIdempotency(state: InstallState): boolean {
    return state === 'failed' || state === 'rolled_back' || state === 'cancelled';
  }

  private resolveIdempotencyKey(options: InstallImportOptions): string | null {
    const explicit = options.idempotencyKey?.trim();
    if (explicit) return explicit.slice(0, 256);
    if (options.sourceType === 'registry') {
      const packageVersionId = options.descriptor?.package_version_id?.trim();
      if (packageVersionId) return `registry:${packageVersionId}`.slice(0, 256);
      if (options.sourceRef && options.targetPackageId && options.targetVersion) {
        return ['registry', options.sourceRef, options.targetPackageId, options.targetVersion]
          .join(':')
          .slice(0, 256);
      }
    }
    return null;
  }

  // -------------------------------------------------------------------------
  // confirmBindings
  // -------------------------------------------------------------------------

  /**
   * Confirm bindings and materialize the package.
   *
   * @param installTxnId - The install transaction ID from importFile.
   * @param bindings - User-confirmed binding values.
   */
  async confirmBindings(
    installTxnId: string,
    bindings: BindingConfirmation[],
  ): Promise<MaterializeResult> {
    const plan = this.planCache.get(installTxnId);
    if (plan) {
      return this.withMaterializeLock(plan, () =>
        this.confirmBindingsLocked(installTxnId, bindings, plan),
      );
    }

    const txn = await this.loadTxn(installTxnId);
    if (txn.state === 'installed') {
      const existing = await this.findInstalledPackageExact(
        txn.target_package_id,
        txn.target_version,
      );
      if (existing) {
        return {
          installedPackageId: existing.installed_package_id,
          installedAssetIds: [],
          employeeIds: [],
          skillIds: [],
          skillVaultPaths: [],
          companyTemplateIds: [],
          officeLayoutIds: [],
          prefabInstanceIds: [],
          bindingIds: [],
        };
      }
    }
    if (txn.state === 'materializing') {
      throw new InstallServiceError(
        'install_conflict',
        `Install transaction '${installTxnId}' is already materializing.`,
      );
    }
    // No cached plan: either importFile was never called, or the app restarted
    // mid-install (the plan + downloaded archive live only in memory and are not
    // persisted). The transaction is recoverable — it can be cancelled cleanly
    // from its awaiting_* state (see cancel()) and the install re-initiated.
    throw new InstallServiceError(
      'plan_not_found',
      `Install plan for transaction '${installTxnId}' is unavailable (importFile not called, or the app restarted mid-install). Cancel this transaction and re-run the install.`,
    );
  }

  private async confirmBindingsLocked(
    installTxnId: string,
    bindings: BindingConfirmation[],
    plan: InstallPlan,
  ): Promise<MaterializeResult> {
    const txn = await this.loadTxn(installTxnId);
    const currentState = txn.state;

    const existing = await this.findInstalledPackageExact(
      plan.manifest.package.id,
      plan.manifest.package.version,
    );
    if (existing) {
      if (currentState === 'materializing') {
        await this.transition(
          installTxnId,
          'materializing',
          'installed',
          txn.target_package_id ?? undefined,
        );
        await this.repos.installTransactions.finish(installTxnId, 'installed');
        this.planCache.delete(installTxnId);
        return {
          installedPackageId: existing.installed_package_id,
          installedAssetIds: [],
          employeeIds: [],
          skillIds: [],
          skillVaultPaths: [],
          companyTemplateIds: [],
          officeLayoutIds: [],
          prefabInstanceIds: [],
          bindingIds: [],
        };
      }
      throw new InstallServiceError(
        'already_installed',
        `Package '${plan.manifest.package.id}' version '${plan.manifest.package.version}' is already installed for this company.`,
      );
    }

    // Validate current state allows proceeding
    if (
      currentState !== 'awaiting_confirmation' &&
      currentState !== 'awaiting_bindings' &&
      currentState !== 'ready_to_install' &&
      currentState !== 'materializing'
    ) {
      throw new InstallServiceError(
        'invalid_state',
        `Cannot confirm bindings in state '${currentState}'. Expected 'awaiting_confirmation', 'awaiting_bindings', 'ready_to_install', or 'materializing'.`,
      );
    }

    // Transition through states toward materializing
    let state: InstallState = currentState;

    if (state === 'awaiting_confirmation') {
      if (bindings.length > 0) {
        await this.transition(
          installTxnId,
          state,
          'awaiting_bindings',
          txn.target_package_id ?? undefined,
        );
        state = 'awaiting_bindings';
      } else {
        await this.transition(
          installTxnId,
          state,
          'ready_to_install',
          txn.target_package_id ?? undefined,
        );
        state = 'ready_to_install';
      }
    }

    if (state === 'awaiting_bindings') {
      await this.transition(
        installTxnId,
        state,
        'ready_to_install',
        txn.target_package_id ?? undefined,
      );
      state = 'ready_to_install';
    }

    if (state !== 'materializing') {
      // ready_to_install -> materializing
      await this.transition(
        installTxnId,
        state,
        'materializing',
        txn.target_package_id ?? undefined,
      );
    }

    const provenance = this.extractProvenance(txn);

    // Materialize — pass transact so all writes are atomic in Drizzle environments
    let result: MaterializeResult;
    try {
      result = await materialize(plan, bindings, this.repos, this.companyId, installTxnId, {
        provenance,
        transact: this.transact,
        asyncTransact: this.asyncTransact,
      });
    } catch (err) {
      // Materialization failed — DB writes are already atomic via this.transact
      // (passed to materialize at the call above), so no explicit rollback needed.
      // If materialize ever gains non-DB side effects (e.g. file writes), add
      // compensating cleanup here.
      const errorMsg = err instanceof Error ? err.message : String(err);
      try {
        await this.transitionToFailed(
          installTxnId,
          'materializing',
          'materialize_failed',
          errorMsg,
        );
      } catch {
        // Transition to failed itself failed — we're in a bad state, just throw original
      }
      throw new InstallServiceError('materialize_failed', errorMsg);
    }

    // materializing -> installed
    await this.transition(
      installTxnId,
      'materializing',
      'installed',
      txn.target_package_id ?? undefined,
    );
    await this.repos.installTransactions.finish(installTxnId, 'installed');

    // Clean up cache
    this.planCache.delete(installTxnId);

    // Surface the listing-installed signal for Market UI consumers after all
    // DB and vault writes have finished.
    const installedListingId = provenance?.originListingId;
    if (installedListingId && plan.manifest.package.kind === 'employee') {
      this.events.emitMarketListingInstalled(this.companyId, installedListingId, 'employee', {
        installedPackageId: result.installedPackageId,
        packageId: plan.manifest.package.id,
        version: plan.manifest.package.version,
      });
    }
    if (installedListingId && plan.manifest.package.kind === 'skill') {
      this.events.emitMarketListingInstalled(this.companyId, installedListingId, 'skill', {
        installedPackageId: result.installedPackageId,
        skillId: result.skillIds[0],
        packageId: plan.manifest.package.id,
        version: plan.manifest.package.version,
      });
    }

    // Emit binding state events for confirmed bindings
    const bindingReqs = plan.bindings;
    for (let i = 0; i < result.bindingIds.length; i++) {
      const req = bindingReqs[i];
      if (!req) continue;
      const confirmation = bindings.find((c) => c.bindingKey === req.bindingKey);
      if (confirmation) {
        const bindingId = result.bindingIds[i];
        if (!bindingId) continue;
        this.events.emitBindingState(
          this.companyId,
          bindingId,
          installTxnId,
          confirmation.bindingType,
          confirmation.bindingKey,
          'pending',
          'satisfied',
        );
      }
    }

    return result;
  }

  private async withMaterializeLock<T>(plan: InstallPlan, fn: () => Promise<T>): Promise<T> {
    const key = [
      this.companyId,
      plan.manifest.package.kind,
      plan.manifest.package.id,
      plan.manifest.package.version,
    ].join('::');
    const previous = this.materializeLocks.get(key) ?? Promise.resolve();
    let release!: () => void;
    const gate = new Promise<void>((resolve) => {
      release = resolve;
    });
    const chained = previous.then(() => gate);
    this.materializeLocks.set(key, chained);
    await previous;
    try {
      return await fn();
    } finally {
      release();
      if (this.materializeLocks.get(key) === chained) {
        this.materializeLocks.delete(key);
      }
    }
  }

  private async findInstalledPackageExact(
    packageId: string | null,
    version: string | null,
  ): Promise<InstalledPackageRow | null> {
    if (!packageId || !version) return null;
    const installed = await this.repos.installedPackages.findByPackageId(this.companyId, packageId);
    return (
      installed.find((row) => row.version === version && row.install_state === 'installed') ?? null
    );
  }

  private extractProvenance(txn: InstallTransactionRow): InstallProvenance | undefined {
    if (txn.source_type !== 'registry') return undefined;

    try {
      const descriptor = txn.descriptor_json ? JSON.parse(txn.descriptor_json) : null;
      const listingId =
        typeof descriptor?.listing_id === 'string'
          ? descriptor.listing_id
          : typeof txn.source_ref === 'string'
            ? txn.source_ref
            : null;
      const packageVersionId =
        typeof descriptor?.package_version_id === 'string' ? descriptor.package_version_id : null;

      if (!listingId || !packageVersionId) return undefined;

      return {
        originListingId: listingId,
        originPackageVersionId: packageVersionId,
      };
    } catch {
      return undefined;
    }
  }

  // -------------------------------------------------------------------------
  // cancel
  // -------------------------------------------------------------------------

  /**
   * Cancel an in-progress install transaction.
   *
   * @param installTxnId - The install transaction ID.
   */
  async cancel(installTxnId: string): Promise<void> {
    const txn = await this.loadTxn(installTxnId);

    if (isTerminalState(txn.state)) {
      throw new InstallServiceError(
        'already_terminal',
        `Transaction '${installTxnId}' is already in terminal state '${txn.state}'`,
      );
    }

    // Prefer a clean 'cancelled' transition where the state machine allows it
    // (awaiting_confirmation / awaiting_bindings / ready_to_install). Only call
    // finish() AFTER the transition succeeds, so we never mark a transaction
    // finished while its state is still non-terminal.
    if (validateTransition(txn.state, 'cancelled').valid) {
      await this.transition(
        installTxnId,
        txn.state,
        'cancelled',
        txn.target_package_id ?? undefined,
      );
      await this.repos.installTransactions.finish(installTxnId, 'cancelled');
      this.planCache.delete(installTxnId);
      return;
    }

    // Mid-pipeline states can't go straight to 'cancelled' — fail them instead,
    // and only finish if the transition to 'failed' actually applied.
    const failed = await this.transitionToFailed(
      installTxnId,
      txn.state,
      'cancelled_by_user',
      'Installation cancelled by user',
    );
    if (failed) {
      await this.repos.installTransactions.finish(installTxnId, 'failed');
      this.planCache.delete(installTxnId);
      return;
    }

    throw new InstallServiceError(
      'cannot_cancel',
      `Cannot cancel transaction in non-terminal state '${txn.state}' (no valid cancelled/failed transition)`,
    );
  }

  // -------------------------------------------------------------------------
  // Internal helpers
  // -------------------------------------------------------------------------

  /** Load and validate a transaction exists. */
  private async loadTxn(installTxnId: string): Promise<InstallTransactionRow> {
    const txn = await this.repos.installTransactions.findById(installTxnId);
    if (!txn) {
      throw new InstallServiceError(
        'txn_not_found',
        `Install transaction '${installTxnId}' not found`,
      );
    }
    return txn;
  }

  /** Validate and execute a state transition, persisting and emitting. */
  private async transition(
    txnId: string,
    from: InstallState,
    to: InstallState,
    packageId?: string,
  ): Promise<void> {
    const result = validateTransition(from, to);
    if (!result.valid) {
      throw new InstallServiceError(
        'invalid_transition',
        `Invalid transition ${from} -> ${to}: ${result.reason}`,
      );
    }

    await this.repos.installTransactions.updateState(txnId, to);
    this.events.emitInstallState(this.companyId, txnId, from, to, packageId);
  }

  /**
   * Transition to 'failed' state with error details. Returns `true` if the
   * transition was valid and applied, `false` if `from` has no path to
   * 'failed' (the caller must decide how to finalize in that case — it must NOT
   * mark the transaction finished on a `false` result, or the row would be
   * finished while its state machine state is still non-terminal).
   */
  private async transitionToFailed(
    txnId: string,
    from: InstallState,
    errorCode: string,
    errorDetail: string,
  ): Promise<boolean> {
    const result = validateTransition(from, 'failed');
    if (!result.valid) {
      console.warn(`[install-service] Cannot transition ${from} -> failed: ${result.reason}`);
      return false;
    }

    await this.repos.installTransactions.updateState(txnId, 'failed', errorCode, errorDetail);
    this.events.emitInstallState(this.companyId, txnId, from, 'failed', undefined, errorCode);
    return true;
  }

  /**
   * Handle failure during planning: if the failure stage is a valid state
   * to transition to from 'created', do so before transitioning to 'failed'.
   */
  private async tryTransitionAndFail(
    txnId: string,
    currentState: InstallState,
    failStage: InstallState,
    errorCode: string,
    errorDetail: string,
  ): Promise<void> {
    // The planner reports the stage where it failed. The stage name may map
    // to a state we can transition to (e.g. 'manifest_loaded' meaning the
    // load itself failed). We try the direct path.
    const directResult = validateTransition(currentState, failStage);
    if (directResult.valid) {
      // Transition to the stage, then to failed from there
      await this.repos.installTransactions.updateState(txnId, failStage);
      this.events.emitInstallState(this.companyId, txnId, currentState, failStage);

      const failResult = validateTransition(failStage, 'failed');
      if (failResult.valid) {
        await this.repos.installTransactions.updateState(txnId, 'failed', errorCode, errorDetail);
        this.events.emitInstallState(
          this.companyId,
          txnId,
          failStage,
          'failed',
          undefined,
          errorCode,
        );
      }
    } else {
      // Can't go through the stage — just fail from current state
      await this.transitionToFailed(txnId, currentState, errorCode, errorDetail);
    }

    await this.repos.installTransactions.finish(txnId, 'failed');
  }

  // -------------------------------------------------------------------------
  // Lifecycle
  // -------------------------------------------------------------------------

  /**
   * Dispose this service instance — clears the shared plan cache to prevent
   * memory leaks from abandoned install transactions.
   * Should be called when the owning runtime is disposed.
   */
  dispose(): void {
    this.planCache.clear();
  }
}
