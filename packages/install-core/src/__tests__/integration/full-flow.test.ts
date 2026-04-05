/**
 * Integration tests — full install lifecycle end-to-end.
 *
 * These tests exercise InstallService through complete flows (importFile -> confirmBindings / cancel)
 * verifying state transitions, repository mutations, and event emissions at every step.
 *
 * Uses in-memory repositories and a recording event emitter (no @offisim/core imports).
 */

import type { InstallState } from '@offisim/shared-types';
import type { BindingStatus, BindingType } from '@offisim/shared-types';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { InstallService, InstallServiceError } from '../../install-service.js';
import type {
  AssetBindingRow,
  BindingConfirmation,
  InstallEventEmitter,
  InstallRepositories,
  InstallTransactionRow,
  InstalledAssetRow,
  InstalledPackageRow,
  NewEmployee,
  RuntimeEnvironment,
} from '../../types.js';
import { createTestPkg } from '../fixtures/create-test-pkg.js';

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const COMPANY_ID = 'company-integ-test';

/** Runtime environment compatible with TEST_MANIFEST (runtime_range: >=1.0 <2.0). */
const COMPAT_ENV: RuntimeEnvironment = {
  runtimeVersion: '1.5.0',
  environment: 'desktop',
  schemaVersion: '2026-03',
};

// ---------------------------------------------------------------------------
// In-memory repository store
// ---------------------------------------------------------------------------

interface MemoryStore {
  transactions: InstallTransactionRow[];
  packages: InstalledPackageRow[];
  assets: InstalledAssetRow[];
  bindings: AssetBindingRow[];
  employees: Array<NewEmployee & { employee_id: string }>;
}

function requireDefined<T>(value: T | null | undefined, message: string): T {
  if (value == null) {
    throw new Error(message);
  }
  return value;
}

function requireTransaction(store: MemoryStore, installTxnId: string): InstallTransactionRow {
  return requireDefined(
    store.transactions.find((transaction) => transaction.install_txn_id === installTxnId),
    `Expected transaction ${installTxnId}`,
  );
}

function requireBinding(store: MemoryStore, bindingKey: string): AssetBindingRow {
  return requireDefined(
    store.bindings.find((binding) => binding.binding_key === bindingKey),
    `Expected binding ${bindingKey}`,
  );
}

function requireInstallEvent(
  events: RecordedInstallEvent[],
  index: number,
  message: string,
): RecordedInstallEvent {
  return requireDefined(events[index], message);
}

function createMemoryRepos(): { repos: InstallRepositories; store: MemoryStore } {
  const store: MemoryStore = {
    transactions: [],
    packages: [],
    assets: [],
    bindings: [],
    employees: [],
  };

  const repos: InstallRepositories = {
    installTransactions: {
      create: async (txn) => {
        const row: InstallTransactionRow = { ...txn, finished_at: null };
        store.transactions.push(row);
        return row;
      },
      findById: async (id) => {
        return store.transactions.find((t) => t.install_txn_id === id) ?? null;
      },
      updateState: async (id, state, errorCode, errorDetail) => {
        const txn = store.transactions.find((t) => t.install_txn_id === id);
        if (txn) {
          (txn as unknown as Record<string, unknown>).state = state;
          if (errorCode !== undefined)
            (txn as unknown as Record<string, unknown>).error_code = errorCode;
          if (errorDetail !== undefined)
            (txn as unknown as Record<string, unknown>).error_detail = errorDetail;
        }
      },
      finish: async (id, state) => {
        const txn = store.transactions.find((t) => t.install_txn_id === id);
        if (txn) {
          (txn as unknown as Record<string, unknown>).state = state;
          (txn as unknown as Record<string, unknown>).finished_at = new Date().toISOString();
        }
      },
    },
    installedPackages: {
      create: async (pkg) => {
        store.packages.push(pkg);
        return pkg;
      },
      findByPackageId: async () => [],
      delete: async () => {},
    },
    installedAssets: {
      create: async (asset) => {
        store.assets.push(asset);
        return asset;
      },
      delete: async () => {},
    },
    assetBindings: {
      create: async (binding) => {
        store.bindings.push(binding);
        return binding;
      },
      findByTransaction: async (txnId) => {
        return store.bindings.filter((b) => b.install_txn_id === txnId);
      },
      updateStatus: async (id, status, valueJson) => {
        const binding = store.bindings.find((b) => b.binding_id === id);
        if (binding) {
          (binding as unknown as Record<string, unknown>).status = status;
          if (valueJson !== undefined)
            (binding as unknown as Record<string, unknown>).binding_value_json = valueJson;
        }
      },
      delete: async () => {},
    },
    employees: {
      create: async (emp) => {
        const id = emp.employee_id ?? globalThis.crypto.randomUUID();
        store.employees.push({ ...emp, employee_id: id });
        return { employee_id: id };
      },
      delete: async () => {},
    },
  };

  return { repos, store };
}

// ---------------------------------------------------------------------------
// Event recorder
// ---------------------------------------------------------------------------

interface RecordedInstallEvent {
  companyId: string;
  txnId: string;
  prev: InstallState;
  next: InstallState;
  packageId?: string;
  errorCode?: string;
}

interface RecordedBindingEvent {
  companyId: string;
  bindingId: string;
  txnId: string;
  type: BindingType;
  key: string;
  prev: BindingStatus;
  next: BindingStatus;
}

function createEventRecorder(): {
  events: InstallEventEmitter;
  installEvents: RecordedInstallEvent[];
  bindingEvents: RecordedBindingEvent[];
} {
  const installEvents: RecordedInstallEvent[] = [];
  const bindingEvents: RecordedBindingEvent[] = [];

  const events: InstallEventEmitter = {
    emitInstallState: (companyId, txnId, prev, next, packageId, errorCode) => {
      installEvents.push({ companyId, txnId, prev, next, packageId, errorCode });
    },
    emitBindingState: (companyId, bindingId, txnId, type, key, prev, next) => {
      bindingEvents.push({ companyId, bindingId, txnId, type, key, prev, next });
    },
  };

  return { events, installEvents, bindingEvents };
}

// ---------------------------------------------------------------------------
// Archive helpers
// ---------------------------------------------------------------------------

/** Valid archive — no privileged permissions, has recommended_models -> produces bindings. */
function createValidArchive(): Uint8Array {
  return createTestPkg({
    manifestOverride: {
      integrity: {
        package_sha256: 'aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa',
      },
    },
  });
}

/** Privileged archive — risk_class 'privileged_asset' -> needsConfirmation = true. */
function createPrivilegedArchive(): Uint8Array {
  return createTestPkg({
    manifestOverride: {
      permissions: {
        risk_class: 'privileged_asset',
        declares_secrets: false,
        filesystem_scope: 'none',
        network_scope: 'none',
      },
      integrity: {
        package_sha256: 'aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa',
      },
    },
  });
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('Install Full-Flow Integration', () => {
  let repos: InstallRepositories;
  let store: MemoryStore;
  let events: InstallEventEmitter;
  let installEvents: RecordedInstallEvent[];
  let bindingEvents: RecordedBindingEvent[];
  let svc: InstallService;

  beforeEach(() => {
    ({ repos, store } = createMemoryRepos());
    const recorder = createEventRecorder();
    events = recorder.events;
    installEvents = recorder.installEvents;
    bindingEvents = recorder.bindingEvents;
    svc = new InstallService({
      repos,
      events,
      companyId: COMPANY_ID,
      environment: COMPAT_ENV,
    });
  });

  afterEach(() => {
    svc.dispose();
  });

  // =========================================================================
  // Happy Path: importFile -> confirmBindings -> installed
  // =========================================================================

  describe('happy path: full install lifecycle', () => {
    it('importFile -> confirmBindings -> installed (with bindings)', async () => {
      // Step 1: Import a valid archive
      const archive = createValidArchive();
      const importResult = await svc.importFile(archive);

      // importFile should succeed with a plan
      expect(importResult.plan).toBeDefined();
      expect(importResult.error).toBeUndefined();
      expect(importResult.installTxnId).toBeTruthy();

      // Transaction should be in awaiting_bindings (has recommended_models, not privileged)
      const txnAfterImport = requireTransaction(store, importResult.installTxnId);
      expect(txnAfterImport.state).toBe('awaiting_bindings');
      expect(txnAfterImport.finished_at).toBeNull();

      // Step 2: Verify all import-phase state transitions occurred in order
      const importTransitions = installEvents.map((e) => `${e.prev}->${e.next}`);
      expect(importTransitions).toEqual([
        'created->manifest_loaded',
        'manifest_loaded->integrity_checked',
        'integrity_checked->compatibility_checked',
        'compatibility_checked->dependency_planned',
        'dependency_planned->awaiting_bindings',
      ]);

      // Step 3: Confirm bindings to complete the install
      const bindings: BindingConfirmation[] = [
        {
          bindingKey: 'test-writer-default:reasoning-heavy',
          bindingType: 'model_profile',
          valueJson: '{"provider":"openai","model":"gpt-4o"}',
        },
      ];

      const eventsBeforeConfirm = installEvents.length;
      await svc.confirmBindings(importResult.installTxnId, bindings);

      // Step 4: Verify final state is installed
      const txnFinal = requireTransaction(store, importResult.installTxnId);
      expect(txnFinal.state).toBe('installed');
      expect(txnFinal.finished_at).not.toBeNull();

      // Step 5: Verify materialized entities
      expect(store.packages).toHaveLength(1);
      expect(store.packages[0]?.package_id).toBe('offisim.employee.test-writer');
      expect(store.packages[0]?.install_state).toBe('installed');

      expect(store.assets).toHaveLength(1);
      expect(store.assets[0]?.asset_id).toBe('test-writer-default');
      expect(store.assets[0]?.asset_kind).toBe('employee');

      expect(store.employees).toHaveLength(1);
      expect(store.employees[0]?.name).toBe('Test Writer');
      expect(store.employees[0]?.role_slug).toBe('test-writer-default');

      // TEST_MANIFEST has 2 recommended_models -> 2 binding rows
      expect(store.bindings).toHaveLength(2);

      // Step 6: Verify binding states
      const confirmedBinding = requireBinding(store, 'test-writer-default:reasoning-heavy');
      expect(confirmedBinding.status).toBe('satisfied');
      expect(confirmedBinding.binding_value_json).toBe('{"provider":"openai","model":"gpt-4o"}');

      const skippedBinding = requireBinding(store, 'test-writer-default:cheap-draft');
      expect(skippedBinding.status).toBe('skipped');

      // Step 7: Verify confirm-phase transitions
      const confirmTransitions = installEvents
        .slice(eventsBeforeConfirm)
        .map((e) => `${e.prev}->${e.next}`);
      expect(confirmTransitions).toEqual([
        'awaiting_bindings->ready_to_install',
        'ready_to_install->materializing',
        'materializing->installed',
      ]);
    });

    it('importFile -> confirmBindings -> installed (privileged package with confirmation)', async () => {
      // Step 1: Import a privileged archive that requires confirmation
      const archive = createPrivilegedArchive();
      const importResult = await svc.importFile(archive);

      expect(importResult.plan).toBeDefined();
      expect(importResult.plan?.needsConfirmation).toBe(true);
      expect(requireTransaction(store, importResult.installTxnId).state).toBe(
        'awaiting_confirmation',
      );

      // Step 2: Import-phase transitions should end at awaiting_confirmation
      const importTransitions = installEvents.map((e) => `${e.prev}->${e.next}`);
      expect(importTransitions[importTransitions.length - 1]).toBe(
        'dependency_planned->awaiting_confirmation',
      );

      // Step 3: Confirm with bindings (user accepts the privileged install)
      const bindings: BindingConfirmation[] = [
        {
          bindingKey: 'test-writer-default:reasoning-heavy',
          bindingType: 'model_profile',
          valueJson: '{"provider":"anthropic","model":"claude-4"}',
        },
      ];

      const eventsBeforeConfirm = installEvents.length;
      await svc.confirmBindings(importResult.installTxnId, bindings);

      // Step 4: Verify full confirm flow through all intermediate states
      const confirmTransitions = installEvents
        .slice(eventsBeforeConfirm)
        .map((e) => `${e.prev}->${e.next}`);
      expect(confirmTransitions).toEqual([
        'awaiting_confirmation->awaiting_bindings',
        'awaiting_bindings->ready_to_install',
        'ready_to_install->materializing',
        'materializing->installed',
      ]);

      // Step 5: Final state
      expect(requireTransaction(store, importResult.installTxnId).state).toBe('installed');
      expect(store.packages).toHaveLength(1);
      expect(store.employees).toHaveLength(1);
    });

    it('importFile -> confirmBindings with no bindings -> installed', async () => {
      // Use a valid archive — even without user-supplied binding values,
      // confirmBindings([]) should still proceed
      const archive = createValidArchive();
      const importResult = await svc.importFile(archive);

      // Confirm with empty bindings — optional bindings will be skipped
      await svc.confirmBindings(importResult.installTxnId, []);

      expect(requireTransaction(store, importResult.installTxnId).state).toBe('installed');
      expect(store.packages).toHaveLength(1);
      expect(store.employees).toHaveLength(1);

      // All bindings should be 'skipped' since none were confirmed
      for (const binding of store.bindings) {
        expect(binding.status).toBe('skipped');
      }
    });

    it('verifies the complete ordered state sequence for a standard install', async () => {
      const archive = createValidArchive();
      const importResult = await svc.importFile(archive);
      await svc.confirmBindings(importResult.installTxnId, []);

      // Collect the full state sequence from events
      const stateSequence: InstallState[] = ['created']; // initial state
      for (const evt of installEvents) {
        stateSequence.push(evt.next);
      }

      expect(stateSequence).toEqual([
        'created',
        'manifest_loaded',
        'integrity_checked',
        'compatibility_checked',
        'dependency_planned',
        'awaiting_bindings',
        'ready_to_install',
        'materializing',
        'installed',
      ]);
    });
  });

  // =========================================================================
  // Failure + Rollback: invalid archive -> error state
  // =========================================================================

  describe('failure: invalid archive -> error state', () => {
    it('corrupt bytes -> failed with error details', async () => {
      const garbage = new Uint8Array([0xde, 0xad, 0xbe, 0xef]);
      const result = await svc.importFile(garbage);

      // Should return an error, no plan
      expect(result.error).toBeDefined();
      expect(result.plan).toBeUndefined();
      expect(result.installTxnId).toBeTruthy();

      // Transaction should be in failed terminal state
      const txn = requireTransaction(store, result.installTxnId);
      expect(txn.state).toBe('failed');
      expect(txn.finished_at).not.toBeNull();
      expect(txn.error_code).toBeTruthy();
      expect(txn.error_detail).toBeTruthy();
    });

    it('missing manifest.json in archive -> failed', async () => {
      const noManifestArchive = createTestPkg({ omitManifest: true });
      const result = await svc.importFile(noManifestArchive);

      expect(result.error).toBeDefined();
      expect(result.plan).toBeUndefined();

      const txn = requireTransaction(store, result.installTxnId);
      expect(txn.state).toBe('failed');
      expect(txn.finished_at).not.toBeNull();
    });

    it('incompatible runtime version -> failed with compatibility error', async () => {
      // Create service with a runtime version outside the manifest's >=1.0 <2.0 range
      const incompatSvc = new InstallService({
        repos,
        events,
        companyId: COMPANY_ID,
        environment: {
          runtimeVersion: '0.1.0',
          environment: 'desktop',
          schemaVersion: '2026-03',
        },
      });

      const archive = createValidArchive();
      const result = await incompatSvc.importFile(archive);

      expect(result.error).toBeDefined();
      expect(result.error).toContain('Compatibility');

      const txn = requireTransaction(store, result.installTxnId);
      expect(txn.state).toBe('failed');
      expect(txn.finished_at).not.toBeNull();

      // Verify a failure event was emitted
      const failEvent = installEvents.find((e) => e.next === 'failed');
      expect(failEvent).toBeDefined();
    });

    it('failure events contain error codes', async () => {
      const garbage = new Uint8Array([0x00]);
      await svc.importFile(garbage);

      // Find the event that transitions to 'failed'
      const failEvent = installEvents.find((e) => e.next === 'failed');
      expect(failEvent).toBeDefined();
      expect(failEvent?.errorCode).toBeDefined();
      expect(failEvent?.companyId).toBe(COMPANY_ID);
    });

    it('creates a transaction row even when import fails', async () => {
      const garbage = new Uint8Array([0xff, 0xfe]);
      const result = await svc.importFile(garbage);

      // Transaction was created before the error occurred
      expect(store.transactions).toHaveLength(1);
      expect(requireTransaction(store, result.installTxnId).install_txn_id).toBe(
        result.installTxnId,
      );

      // No materialized entities should exist
      expect(store.packages).toHaveLength(0);
      expect(store.assets).toHaveLength(0);
      expect(store.employees).toHaveLength(0);
      expect(store.bindings).toHaveLength(0);
    });
  });

  // =========================================================================
  // Cancel: importFile -> cancel -> cancelled / failed state
  // =========================================================================

  describe('cancel flow', () => {
    it('privileged package: importFile -> cancel -> cancelled', async () => {
      // Privileged packages reach awaiting_confirmation, which can transition to cancelled
      const archive = createPrivilegedArchive();
      const importResult = await svc.importFile(archive);

      expect(requireTransaction(store, importResult.installTxnId).state).toBe(
        'awaiting_confirmation',
      );

      const eventsBeforeCancel = installEvents.length;
      await svc.cancel(importResult.installTxnId);

      // Final state should be cancelled
      const txn = requireTransaction(store, importResult.installTxnId);
      expect(txn.state).toBe('cancelled');
      expect(txn.finished_at).not.toBeNull();

      // Verify the cancel event
      const cancelTransitions = installEvents
        .slice(eventsBeforeCancel)
        .map((e) => `${e.prev}->${e.next}`);
      expect(cancelTransitions).toContain('awaiting_confirmation->cancelled');

      // No materialized entities
      expect(store.packages).toHaveLength(0);
      expect(store.assets).toHaveLength(0);
      expect(store.employees).toHaveLength(0);
    });

    it('standard package: importFile -> cancel from awaiting_bindings -> finished', async () => {
      // Standard packages (with bindings, not privileged) reach awaiting_bindings.
      // State machine does NOT allow awaiting_bindings -> cancelled.
      // cancel() falls back to transitionToFailed, which also can't transition
      // (awaiting_bindings only goes to ready_to_install). The transaction is
      // still marked as finished via finish().
      const archive = createValidArchive();
      const importResult = await svc.importFile(archive);

      expect(requireTransaction(store, importResult.installTxnId).state).toBe('awaiting_bindings');

      await svc.cancel(importResult.installTxnId);

      const txn = requireTransaction(store, importResult.installTxnId);
      // finish() was called — transaction is marked done
      expect(txn.finished_at).not.toBeNull();

      // No materialized entities
      expect(store.packages).toHaveLength(0);
      expect(store.assets).toHaveLength(0);
    });

    it('cancel is idempotent-safe: second cancel throws on terminal state', async () => {
      const archive = createPrivilegedArchive();
      const importResult = await svc.importFile(archive);

      await svc.cancel(importResult.installTxnId);
      expect(requireTransaction(store, importResult.installTxnId).state).toBe('cancelled');

      // Second cancel should throw because we're already in a terminal state
      await expect(svc.cancel(importResult.installTxnId)).rejects.toThrow(InstallServiceError);
      await expect(svc.cancel(importResult.installTxnId)).rejects.toThrow(
        /already in terminal state/,
      );
    });

    it('cancel after successful install throws on terminal state', async () => {
      const archive = createValidArchive();
      const importResult = await svc.importFile(archive);
      await svc.confirmBindings(importResult.installTxnId, []);

      expect(requireTransaction(store, importResult.installTxnId).state).toBe('installed');

      await expect(svc.cancel(importResult.installTxnId)).rejects.toThrow(InstallServiceError);
      await expect(svc.cancel(importResult.installTxnId)).rejects.toThrow(
        /already in terminal state/,
      );
    });

    it('cancel with non-existent txnId throws', async () => {
      await expect(svc.cancel('does-not-exist')).rejects.toThrow(InstallServiceError);
      await expect(svc.cancel('does-not-exist')).rejects.toThrow(/not found/);
    });
  });

  // =========================================================================
  // Event emission verification
  // =========================================================================

  describe('event emission', () => {
    it('every state transition emits an install event with correct companyId and txnId', async () => {
      const archive = createValidArchive();
      const importResult = await svc.importFile(archive);
      await svc.confirmBindings(importResult.installTxnId, [
        {
          bindingKey: 'test-writer-default:reasoning-heavy',
          bindingType: 'model_profile',
          valueJson: '{}',
        },
      ]);

      // Every event should reference the correct company and transaction
      for (const evt of installEvents) {
        expect(evt.companyId).toBe(COMPANY_ID);
        expect(evt.txnId).toBe(importResult.installTxnId);
      }

      // The full flow should produce 8 state transitions:
      // import: created->manifest_loaded, manifest_loaded->integrity_checked,
      //         integrity_checked->compatibility_checked, compatibility_checked->dependency_planned,
      //         dependency_planned->awaiting_bindings
      // confirm: awaiting_bindings->ready_to_install, ready_to_install->materializing,
      //          materializing->installed
      expect(installEvents).toHaveLength(8);
    });

    it('events carry packageId after dependency_planned stage', async () => {
      const archive = createValidArchive();
      await svc.importFile(archive);

      // The transition TO awaiting_bindings (from dependency_planned) should
      // carry the packageId
      const bindingsEvent = installEvents.find((e) => e.next === 'awaiting_bindings');
      expect(bindingsEvent).toBeDefined();
      expect(bindingsEvent?.packageId).toBe('offisim.employee.test-writer');

      // Earlier transitions don't carry packageId
      const manifestEvent = installEvents.find((e) => e.next === 'manifest_loaded');
      expect(manifestEvent).toBeDefined();
      expect(manifestEvent?.packageId).toBeUndefined();
    });

    it('binding events are emitted for confirmed bindings after install', async () => {
      const archive = createValidArchive();
      const importResult = await svc.importFile(archive);

      await svc.confirmBindings(importResult.installTxnId, [
        {
          bindingKey: 'test-writer-default:reasoning-heavy',
          bindingType: 'model_profile',
          valueJson: '{"provider":"openai","model":"gpt-4o"}',
        },
      ]);

      // Should have binding events for the confirmed binding
      expect(bindingEvents.length).toBeGreaterThanOrEqual(1);

      const confirmedEvt = requireDefined(
        bindingEvents.find((e) => e.key === 'test-writer-default:reasoning-heavy'),
        'Expected confirmed binding event',
      );
      expect(confirmedEvt.companyId).toBe(COMPANY_ID);
      expect(confirmedEvt.txnId).toBe(importResult.installTxnId);
      expect(confirmedEvt.type).toBe('model_profile');
      expect(confirmedEvt.prev).toBe('pending');
      expect(confirmedEvt.next).toBe('satisfied');
    });

    it('no binding events for unconfirmed/skipped bindings', async () => {
      const archive = createValidArchive();
      const importResult = await svc.importFile(archive);

      // Confirm only the reasoning-heavy binding, skip cheap-draft
      await svc.confirmBindings(importResult.installTxnId, [
        {
          bindingKey: 'test-writer-default:reasoning-heavy',
          bindingType: 'model_profile',
          valueJson: '{}',
        },
      ]);

      // Only one binding event (for the confirmed one)
      const cheapDraftEvt = bindingEvents.find((e) => e.key === 'test-writer-default:cheap-draft');
      expect(cheapDraftEvt).toBeUndefined();
    });

    it('cancel emits an install event transitioning to cancelled', async () => {
      const archive = createPrivilegedArchive();
      const importResult = await svc.importFile(archive);

      const eventsBeforeCancel = installEvents.length;
      await svc.cancel(importResult.installTxnId);

      const cancelEvents = installEvents.slice(eventsBeforeCancel);
      expect(cancelEvents).toHaveLength(1);
      expect(cancelEvents[0]?.prev).toBe('awaiting_confirmation');
      expect(cancelEvents[0]?.next).toBe('cancelled');
      expect(cancelEvents[0]?.companyId).toBe(COMPANY_ID);
      expect(cancelEvents[0]?.txnId).toBe(importResult.installTxnId);
    });

    it('failure emits an install event with errorCode', async () => {
      const garbage = new Uint8Array([0xba, 0xd0]);
      const result = await svc.importFile(garbage);

      const failEvent = installEvents.find((e) => e.next === 'failed');
      expect(failEvent).toBeDefined();
      expect(failEvent?.errorCode).toBeTruthy();
      expect(failEvent?.txnId).toBe(result.installTxnId);
    });

    it('events form a valid chain — each event.next equals the next event.prev', async () => {
      const archive = createValidArchive();
      const importResult = await svc.importFile(archive);
      await svc.confirmBindings(importResult.installTxnId, []);

      // Verify chain integrity
      for (let i = 1; i < installEvents.length; i++) {
        const prev = requireInstallEvent(
          installEvents,
          i - 1,
          `Missing install event at index ${i - 1}`,
        );
        const curr = requireInstallEvent(installEvents, i, `Missing install event at index ${i}`);
        expect(curr.prev).toBe(prev.next);
      }

      // First event starts from 'created'
      expect(installEvents[0]?.prev).toBe('created');

      // Last event ends at 'installed'
      expect(installEvents[installEvents.length - 1]?.next).toBe('installed');
    });
  });

  // =========================================================================
  // Edge cases and isolation
  // =========================================================================

  describe('isolation and edge cases', () => {
    it('two independent installs do not interfere with each other', async () => {
      const archive1 = createValidArchive();
      const archive2 = createPrivilegedArchive();

      const result1 = await svc.importFile(archive1);
      const result2 = await svc.importFile(archive2);

      // Different transaction IDs
      expect(result1.installTxnId).not.toBe(result2.installTxnId);

      // Different states (archive1 -> awaiting_bindings, archive2 -> awaiting_confirmation)
      const txn1 = requireTransaction(store, result1.installTxnId);
      const txn2 = requireTransaction(store, result2.installTxnId);
      expect(txn1.state).toBe('awaiting_bindings');
      expect(txn2.state).toBe('awaiting_confirmation');

      // Complete first install
      await svc.confirmBindings(result1.installTxnId, []);
      expect(store.transactions.find((t) => t.install_txn_id === result1.installTxnId)?.state).toBe(
        'installed',
      );

      // Second install is still awaiting
      expect(store.transactions.find((t) => t.install_txn_id === result2.installTxnId)?.state).toBe(
        'awaiting_confirmation',
      );

      // Cancel second install
      await svc.cancel(result2.installTxnId);
      expect(store.transactions.find((t) => t.install_txn_id === result2.installTxnId)?.state).toBe(
        'cancelled',
      );
    });

    it('confirmBindings on non-existent txnId throws txn_not_found', async () => {
      await expect(svc.confirmBindings('phantom-txn-id', [])).rejects.toThrow(InstallServiceError);
    });

    it('confirmBindings on already-installed transaction throws invalid_state', async () => {
      const archive = createValidArchive();
      const result = await svc.importFile(archive);
      await svc.confirmBindings(result.installTxnId, []);

      // Plan was removed from cache after first confirm
      await expect(svc.confirmBindings(result.installTxnId, [])).rejects.toThrow(
        InstallServiceError,
      );
    });
  });
});
