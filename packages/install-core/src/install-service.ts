/**
 * InstallService — orchestrates the full install lifecycle.
 *
 * Each state change: validateTransition -> persist -> emit event.
 * All dependencies are injected via constructor (no @aics/core imports).
 */

import type { InstallState } from '@aics/shared-types';
import type {
  InstallRepositories,
  InstallEventEmitter,
  RuntimeEnvironment,
  InstallPlan,
  BindingConfirmation,
  InstallTransactionRow,
} from './types.js';
import { validateTransition, isTerminalState } from './state-machine.js';
import { createInstallPlan } from './install-planner.js';
import { materialize } from './materializer.js';
import type { MaterializeResult } from './materializer.js';
// TODO: wire rollback() into catch block once materialize supports partial results
// import { rollback } from './rollback.js';

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

/**
 * After importFile produces a plan, we cache it in memory keyed by txnId.
 * confirmBindings needs the plan to materialize, and storing it in the DB
 * would require serializing the full plan (overkill for MVP).
 */
const planCache = new Map<string, InstallPlan>();

// ---------------------------------------------------------------------------
// InstallService
// ---------------------------------------------------------------------------

export class InstallService {
  private readonly repos: InstallRepositories;
  private readonly events: InstallEventEmitter;
  private readonly companyId: string;
  private readonly environment: RuntimeEnvironment;

  constructor(deps: InstallServiceDeps) {
    this.repos = deps.repos;
    this.events = deps.events;
    this.companyId = deps.companyId;
    this.environment = deps.environment;
  }

  // -------------------------------------------------------------------------
  // importFile
  // -------------------------------------------------------------------------

  /**
   * Import a .aicspkg archive and run the pre-install pipeline.
   *
   * 1. Create install transaction (state: 'created')
   * 2. Run createInstallPlan (extract -> integrity -> compatibility -> bindings)
   * 3. Transition through states at each pipeline stage
   * 4. End in 'awaiting_confirmation' on success or 'failed' on error
   *
   * @param archiveBytes - Raw bytes of the .aicspkg ZIP archive.
   * @returns ImportResult with txnId and either plan or error.
   */
  async importFile(archiveBytes: Uint8Array): Promise<ImportResult> {
    // 1. Create transaction row
    const installTxnId = globalThis.crypto.randomUUID();
    const now = new Date().toISOString();

    const txnRow: Omit<InstallTransactionRow, 'finished_at'> = {
      install_txn_id: installTxnId,
      company_id: this.companyId,
      source_type: 'file',
      source_ref: null,
      target_package_id: null,
      target_version: null,
      state: 'created',
      error_code: null,
      error_detail: null,
      descriptor_json: null,
      actor_type: 'user',
      started_at: now,
    };

    await this.repos.installTransactions.create(txnRow);

    // 2. Run the install planner
    const planResult = await createInstallPlan(archiveBytes, this.environment);

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
    planCache.set(installTxnId, plan);

    return { installTxnId, plan };
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
  ): Promise<void> {
    const txn = await this.loadTxn(installTxnId);
    const currentState = txn.state;

    // Validate current state allows proceeding
    if (
      currentState !== 'awaiting_confirmation' &&
      currentState !== 'awaiting_bindings' &&
      currentState !== 'ready_to_install'
    ) {
      throw new InstallServiceError(
        'invalid_state',
        `Cannot confirm bindings in state '${currentState}'. Expected 'awaiting_confirmation', 'awaiting_bindings', or 'ready_to_install'.`,
      );
    }

    // Retrieve cached plan
    const plan = planCache.get(installTxnId);
    if (!plan) {
      throw new InstallServiceError(
        'plan_not_found',
        `Install plan for transaction '${installTxnId}' not found in cache. Was importFile called?`,
      );
    }

    // Transition through states toward materializing
    let state: InstallState = currentState;

    if (state === 'awaiting_confirmation') {
      if (bindings.length > 0) {
        await this.transition(installTxnId, state, 'awaiting_bindings', txn.target_package_id ?? undefined);
        state = 'awaiting_bindings';
      } else {
        await this.transition(installTxnId, state, 'ready_to_install', txn.target_package_id ?? undefined);
        state = 'ready_to_install';
      }
    }

    if (state === 'awaiting_bindings') {
      await this.transition(installTxnId, state, 'ready_to_install', txn.target_package_id ?? undefined);
      state = 'ready_to_install';
    }

    // ready_to_install -> materializing
    await this.transition(installTxnId, state, 'materializing', txn.target_package_id ?? undefined);

    // Materialize
    let result: MaterializeResult;
    try {
      result = await materialize(plan, bindings, this.repos, this.companyId, installTxnId);
    } catch (err) {
      // Materialization failed -> attempt rollback
      const errorMsg = err instanceof Error ? err.message : String(err);
      try {
        // If we had a partial result we could roll it back, but materialize either
        // succeeds fully or throws. In case of future partial results, we'd pass them here.
        // For now, just transition to rolled_back or failed.
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
    await this.transition(installTxnId, 'materializing', 'installed', txn.target_package_id ?? undefined);
    await this.repos.installTransactions.finish(installTxnId, 'installed');

    // Clean up cache
    planCache.delete(installTxnId);

    // Emit binding state events for confirmed bindings
    const bindingReqs = plan.bindings;
    for (let i = 0; i < result.bindingIds.length; i++) {
      const req = bindingReqs[i];
      if (!req) continue;
      const confirmation = bindings.find((c) => c.bindingKey === req.bindingKey);
      if (confirmation) {
        this.events.emitBindingState(
          this.companyId,
          result.bindingIds[i]!,
          installTxnId,
          confirmation.bindingType,
          confirmation.bindingKey,
          'pending',
          'satisfied',
        );
      }
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

    // Only awaiting_confirmation can transition to cancelled per state machine
    if (txn.state !== 'awaiting_confirmation') {
      // For other non-terminal states, fail the transaction instead
      await this.transitionToFailed(
        installTxnId,
        txn.state,
        'cancelled_by_user',
        'Installation cancelled by user',
      );
      await this.repos.installTransactions.finish(installTxnId, 'failed');
      planCache.delete(installTxnId);
      return;
    }

    await this.transition(installTxnId, txn.state, 'cancelled', txn.target_package_id ?? undefined);
    await this.repos.installTransactions.finish(installTxnId, 'cancelled');
    planCache.delete(installTxnId);
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

  /** Transition to 'failed' state with error details. */
  private async transitionToFailed(
    txnId: string,
    from: InstallState,
    errorCode: string,
    errorDetail: string,
  ): Promise<void> {
    const result = validateTransition(from, 'failed');
    if (!result.valid) {
      // Some states (like awaiting_confirmation) can't go to failed directly.
      // In those cases, we can only log — the caller should handle this case.
      console.warn(
        `[install-service] Cannot transition ${from} -> failed: ${result.reason}`,
      );
      return;
    }

    await this.repos.installTransactions.updateState(txnId, 'failed', errorCode, errorDetail);
    this.events.emitInstallState(this.companyId, txnId, from, 'failed', undefined, errorCode);
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
        this.events.emitInstallState(this.companyId, txnId, failStage, 'failed', undefined, errorCode);
      }
    } else {
      // Can't go through the stage — just fail from current state
      await this.transitionToFailed(txnId, currentState, errorCode, errorDetail);
    }

    await this.repos.installTransactions.finish(txnId, 'failed');
  }

  // -------------------------------------------------------------------------
  // Static helpers (for testing / external access to plan cache)
  // -------------------------------------------------------------------------

  /** @internal — clear the plan cache (for testing only). */
  static _clearPlanCache(): void {
    planCache.clear();
  }
}
