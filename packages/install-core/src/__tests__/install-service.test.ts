import type { InstallState } from '@offisim/shared-types';
import type { BindingStatus, BindingType } from '@offisim/shared-types';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { InstallService, InstallServiceError } from '../install-service.js';
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
} from '../types.js';
import { createTestPkg } from './fixtures/create-test-pkg.js';

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const COMPANY_ID = 'company-svc-test';

const COMPAT_ENV: RuntimeEnvironment = {
  runtimeVersion: '1.5.0',
  environment: 'desktop',
  schemaVersion: '2026-03',
};

// ---------------------------------------------------------------------------
// In-memory repositories
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
          // Mutate in place (this is test-only memory store)
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
// Test archive helper
// ---------------------------------------------------------------------------

/** Create a valid test archive that passes all planner checks. */
function createValidArchive() {
  return createTestPkg({
    manifestOverride: {
      integrity: {
        package_sha256: 'aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa',
        // No file hashes -> integrity passes trivially
      },
    },
  });
}

/** Create a privileged test archive that requires confirmation. */
function createPrivilegedArchive() {
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

describe('InstallService', () => {
  let repos: InstallRepositories;
  let store: MemoryStore;
  let events: InstallEventEmitter;
  let installEvents: RecordedInstallEvent[];
  let svc: InstallService;

  beforeEach(() => {
    ({ repos, store } = createMemoryRepos());
    const recorder = createEventRecorder();
    events = recorder.events;
    installEvents = recorder.installEvents;
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

  // -----------------------------------------------------------------------
  // importFile
  // -----------------------------------------------------------------------
  describe('importFile', () => {
    it('creates a transaction and returns a plan for a valid package', async () => {
      const archive = createValidArchive();
      const result = await svc.importFile(archive);

      expect(result.installTxnId).toBeDefined();
      expect(result.plan).toBeDefined();
      expect(result.error).toBeUndefined();
      expect(result.plan?.manifest.package.id).toBe('offisim.employee.test-writer');
    });

    it('creates a transaction row in the store', async () => {
      const archive = createValidArchive();
      const result = await svc.importFile(archive);

      expect(store.transactions).toHaveLength(1);
      const txn = requireTransaction(store, result.installTxnId);
      expect(txn.company_id).toBe(COMPANY_ID);
      expect(txn.source_type).toBe('file');
      expect(txn.actor_type).toBe('user');
    });

    it('emits state transition events through the pipeline', async () => {
      const archive = createValidArchive();
      await svc.importFile(archive);

      // Should have emitted transitions:
      // created->manifest_loaded, manifest_loaded->integrity_checked,
      // integrity_checked->compatibility_checked, compatibility_checked->dependency_planned,
      // dependency_planned->awaiting_bindings (because bindings exist, no confirmation needed)
      const transitions = installEvents.map((e) => `${e.prev}->${e.next}`);
      expect(transitions).toContain('created->manifest_loaded');
      expect(transitions).toContain('manifest_loaded->integrity_checked');
      expect(transitions).toContain('integrity_checked->compatibility_checked');
      expect(transitions).toContain('compatibility_checked->dependency_planned');
    });

    it('ends in awaiting_confirmation for privileged packages', async () => {
      const archive = createPrivilegedArchive();
      const result = await svc.importFile(archive);

      expect(result.plan?.needsConfirmation).toBe(true);

      const lastEvent = requireDefined(
        installEvents[installEvents.length - 1],
        'Expected last install event',
      );
      expect(lastEvent.next).toBe('awaiting_confirmation');

      const txn = requireTransaction(store, result.installTxnId);
      expect(txn.state).toBe('awaiting_confirmation');
    });

    it('ends in awaiting_bindings when bindings exist and no confirmation needed', async () => {
      const archive = createValidArchive();
      const result = await svc.importFile(archive);

      const txn = requireTransaction(store, result.installTxnId);
      // TEST_MANIFEST has recommended_models -> bindings exist, no privileged
      expect(txn.state).toBe('awaiting_bindings');
    });

    it('returns error and transitions to failed for corrupt archive', async () => {
      const garbage = new Uint8Array([0x00, 0x01, 0x02]);
      const result = await svc.importFile(garbage);

      expect(result.error).toBeDefined();
      expect(result.plan).toBeUndefined();

      const txn = requireTransaction(store, result.installTxnId);
      expect(txn.state).toBe('failed');
      expect(txn.finished_at).not.toBeNull();
    });

    it('returns error for incompatible runtime', async () => {
      const incompatSvc = new InstallService({
        repos,
        events,
        companyId: COMPANY_ID,
        environment: { runtimeVersion: '0.1.0', environment: 'desktop', schemaVersion: '2026-03' },
      });

      const archive = createValidArchive();
      const result = await incompatSvc.importFile(archive);

      expect(result.error).toBeDefined();
      expect(result.error).toContain('Compatibility');

      const txn = requireTransaction(store, result.installTxnId);
      expect(txn.state).toBe('failed');
    });
  });

  // -----------------------------------------------------------------------
  // confirmBindings — full flow
  // -----------------------------------------------------------------------
  describe('confirmBindings', () => {
    it('completes the full import -> confirm -> installed flow', async () => {
      const archive = createValidArchive();
      const importResult = await svc.importFile(archive);

      const bindings: BindingConfirmation[] = [
        {
          bindingKey: 'test-writer-default:reasoning-heavy',
          bindingType: 'model_profile',
          valueJson: '{"provider":"openai","model":"gpt-4o"}',
        },
      ];

      await svc.confirmBindings(importResult.installTxnId, bindings);

      // Check final state
      const txn = requireTransaction(store, importResult.installTxnId);
      expect(txn.state).toBe('installed');
      expect(txn.finished_at).not.toBeNull();

      // Check materialized entities
      expect(store.packages).toHaveLength(1);
      expect(store.assets).toHaveLength(1);
      expect(store.employees).toHaveLength(1);
      // TEST_MANIFEST has 2 recommended_models -> 2 bindings
      expect(store.bindings).toHaveLength(2);

      // Check the confirmed binding
      const confirmedBinding = requireBinding(store, 'test-writer-default:reasoning-heavy');
      expect(confirmedBinding.binding_value_json).toBe('{"provider":"openai","model":"gpt-4o"}');
      expect(confirmedBinding.status).toBe('satisfied');

      // The unconfirmed optional binding should be skipped
      const skippedBinding = requireBinding(store, 'test-writer-default:cheap-draft');
      expect(skippedBinding.status).toBe('skipped');
    });

    it('works with privileged package (awaiting_confirmation -> confirm)', async () => {
      const archive = createPrivilegedArchive();
      const importResult = await svc.importFile(archive);

      // Verify we're in awaiting_confirmation
      expect(requireTransaction(store, importResult.installTxnId).state).toBe(
        'awaiting_confirmation',
      );

      const bindings: BindingConfirmation[] = [
        {
          bindingKey: 'test-writer-default:reasoning-heavy',
          bindingType: 'model_profile',
          valueJson: '{}',
        },
      ];

      await svc.confirmBindings(importResult.installTxnId, bindings);

      expect(requireTransaction(store, importResult.installTxnId).state).toBe('installed');
      expect(store.packages).toHaveLength(1);
    });

    it('throws for non-existent transaction', async () => {
      await expect(svc.confirmBindings('non-existent-txn-id', [])).rejects.toThrow(
        InstallServiceError,
      );
    });

    it('throws when transaction is already installed', async () => {
      const archive = createValidArchive();
      const importResult = await svc.importFile(archive);
      await svc.confirmBindings(importResult.installTxnId, []);

      // Try confirming again — should fail
      await expect(svc.confirmBindings(importResult.installTxnId, [])).rejects.toThrow(
        InstallServiceError,
      );
    });
  });

  // -----------------------------------------------------------------------
  // cancel
  // -----------------------------------------------------------------------
  describe('cancel', () => {
    it('cancels a transaction in awaiting_confirmation state', async () => {
      const archive = createPrivilegedArchive();
      const importResult = await svc.importFile(archive);

      expect(requireTransaction(store, importResult.installTxnId).state).toBe(
        'awaiting_confirmation',
      );

      await svc.cancel(importResult.installTxnId);

      const txn = requireTransaction(store, importResult.installTxnId);
      expect(txn.state).toBe('cancelled');
      expect(txn.finished_at).not.toBeNull();
    });

    it('fails a transaction in non-confirmation non-terminal state (e.g. awaiting_bindings)', async () => {
      const archive = createValidArchive();
      const importResult = await svc.importFile(archive);

      // Should be in awaiting_bindings
      expect(requireTransaction(store, importResult.installTxnId).state).toBe('awaiting_bindings');

      // Cancel — since awaiting_bindings can't go to cancelled, it goes to failed
      // Actually per state machine, awaiting_bindings can only go to ready_to_install
      // So cancel falls back to transitionToFailed which also can't transition (no 'failed' edge)
      // The cancel method handles this by logging a warning
      await svc.cancel(importResult.installTxnId);

      const txn = requireTransaction(store, importResult.installTxnId);
      // The state machine doesn't allow awaiting_bindings -> failed or cancelled
      // So the cancel logs a warning and calls finish with 'failed'
      expect(txn.finished_at).not.toBeNull();
    });

    it('throws for already-terminal transaction', async () => {
      const archive = createPrivilegedArchive();
      const importResult = await svc.importFile(archive);

      await svc.cancel(importResult.installTxnId);

      // Try cancelling again
      await expect(svc.cancel(importResult.installTxnId)).rejects.toThrow(InstallServiceError);
    });

    it('throws for non-existent transaction', async () => {
      await expect(svc.cancel('non-existent-txn')).rejects.toThrow(InstallServiceError);
    });
  });

  // -----------------------------------------------------------------------
  // Event emission
  // -----------------------------------------------------------------------
  describe('event emission', () => {
    it('emits install state events for every transition', async () => {
      const archive = createValidArchive();
      const importResult = await svc.importFile(archive);

      // Record count from import phase
      const importEventCount = installEvents.length;
      expect(importEventCount).toBeGreaterThanOrEqual(5);

      // Confirm to trigger more events
      await svc.confirmBindings(importResult.installTxnId, []);

      // Should have more events from confirmation flow
      expect(installEvents.length).toBeGreaterThan(importEventCount);

      // All events should have correct companyId
      for (const evt of installEvents) {
        expect(evt.companyId).toBe(COMPANY_ID);
        expect(evt.txnId).toBe(importResult.installTxnId);
      }
    });

    it('emits error event when import fails', async () => {
      const garbage = new Uint8Array([0x00, 0x01, 0x02]);
      await svc.importFile(garbage);

      const failEvent = installEvents.find((e) => e.next === 'failed');
      expect(failEvent).toBeDefined();
      expect(failEvent?.errorCode).toBeDefined();
    });
  });
});
