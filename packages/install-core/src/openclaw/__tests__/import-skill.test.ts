import type { InstallState } from '@aics/shared-types';
import type { BindingStatus, BindingType } from '@aics/shared-types';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { InstallService } from '../../install-service.js';
import type {
  AssetBindingRow,
  InstallEventEmitter,
  InstallRepositories,
  InstallTransactionRow,
  InstalledAssetRow,
  InstalledPackageRow,
  NewEmployee,
  RuntimeEnvironment,
} from '../../types.js';

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const COMPANY_ID = 'company-skill-test';

const COMPAT_ENV: RuntimeEnvironment = {
  runtimeVersion: '0.1.0',
  environment: 'desktop',
  schemaVersion: '2026-03',
};

// ---------------------------------------------------------------------------
// In-memory repositories (same pattern as install-service.test.ts)
// ---------------------------------------------------------------------------

interface MemoryStore {
  transactions: InstallTransactionRow[];
  packages: InstalledPackageRow[];
  assets: InstalledAssetRow[];
  bindings: AssetBindingRow[];
  employees: Array<NewEmployee & { employee_id: string }>;
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
    },
    installedAssets: {
      create: async (asset) => {
        store.assets.push(asset);
        return asset;
      },
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
    },
    employees: {
      create: async (emp) => {
        const id = globalThis.crypto.randomUUID();
        store.employees.push({ ...emp, employee_id: id });
        return { employee_id: id };
      },
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
// Test fixtures
// ---------------------------------------------------------------------------

const VALID_SKILL_MD = `---
name: test-coder
description: A test coding assistant
license: MIT
---

You are a coding assistant. Write clean code.
`;

const SKILL_WITH_REQUIREMENTS_MD = `---
name: code-reviewer
description: Reviews code for bugs
metadata:
  openclaw.emoji: "R"
  openclaw.requires:
    bins:
      - git
    env:
      - GITHUB_TOKEN
---

You are a code review expert.
`;

const NO_FRONTMATTER_MD = `Just plain markdown without frontmatter`;

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('InstallService.importSkill', () => {
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
    InstallService._clearPlanCache();
  });

  // -----------------------------------------------------------------------
  // importSkill — happy path
  // -----------------------------------------------------------------------

  it('imports a valid SKILL.md and produces a plan', async () => {
    const result = await svc.importSkill(VALID_SKILL_MD);

    expect(result.error).toBeUndefined();
    expect(result.plan).toBeDefined();
    expect(result.plan!.manifest.package.title).toBe('test-coder');
    expect(result.plan!.manifest.package.kind).toBe('employee');
    expect(result.installTxnId).toBeTruthy();
  });

  it('creates a transaction row with source_ref openclaw-skill', async () => {
    await svc.importSkill(VALID_SKILL_MD);

    expect(store.transactions).toHaveLength(1);
    const txn = store.transactions[0]!;
    expect(txn.company_id).toBe(COMPANY_ID);
    expect(txn.source_type).toBe('file');
    expect(txn.source_ref).toBe('openclaw-skill');
    expect(txn.actor_type).toBe('user');
  });

  it('stores instructions in custom.openclaw_instructions on the manifest', async () => {
    const result = await svc.importSkill(VALID_SKILL_MD);

    expect(result.plan!.manifest.custom?.openclaw_instructions).toContain('coding assistant');
  });

  it('stores skill validation warnings on the result', async () => {
    const result = await svc.importSkill(VALID_SKILL_MD);

    expect(result.skillValidation).toBeDefined();
    expect(result.skillValidation!.valid).toBe(true);
    // No requirements in the simple fixture → no warnings
    expect(result.skillValidation!.warnings).toHaveLength(0);
  });

  it('stores skill validation warnings when requirements present', async () => {
    const result = await svc.importSkill(SKILL_WITH_REQUIREMENTS_MD);

    expect(result.skillValidation).toBeDefined();
    expect(result.skillValidation!.valid).toBe(true);
    // Should have warnings for bins (git) and env (GITHUB_TOKEN)
    expect(result.skillValidation!.warnings.length).toBeGreaterThanOrEqual(2);
  });

  it('ends in ready_to_install for simple skills (no bindings)', async () => {
    await svc.importSkill(VALID_SKILL_MD);

    const txn = store.transactions[0]!;
    expect(txn.state).toBe('ready_to_install');
  });

  it('produces a plan with zero hashes (synthetic package)', async () => {
    const result = await svc.importSkill(VALID_SKILL_MD);

    expect(result.plan!.packageHash).toBe('0'.repeat(64));
    expect(result.plan!.manifestHash).toBe('0'.repeat(64));
  });

  it('produces a plan with needsConfirmation: false', async () => {
    const result = await svc.importSkill(VALID_SKILL_MD);

    expect(result.plan!.needsConfirmation).toBe(false);
    expect(result.plan!.confirmationReasons).toEqual([]);
  });

  // -----------------------------------------------------------------------
  // importSkill — error paths
  // -----------------------------------------------------------------------

  it('returns error for invalid SKILL.md (no frontmatter)', async () => {
    const result = await svc.importSkill(NO_FRONTMATTER_MD);

    expect(result.error).toBeDefined();
    expect(result.error).toContain('frontmatter');
    expect(result.plan).toBeUndefined();
  });

  it('transitions to failed on parse error', async () => {
    await svc.importSkill(NO_FRONTMATTER_MD);

    const txn = store.transactions[0]!;
    expect(txn.state).toBe('failed');
    expect(txn.finished_at).not.toBeNull();
    expect(txn.error_code).toBe('skill_parse_failed');
  });

  it('returns error for incompatible runtime version', async () => {
    const incompatSvc = new InstallService({
      repos,
      events,
      companyId: COMPANY_ID,
      environment: {
        runtimeVersion: '99.0.0',
        environment: 'desktop',
        schemaVersion: '2026-03',
      },
    });

    const result = await incompatSvc.importSkill(VALID_SKILL_MD);

    expect(result.error).toBeDefined();
    expect(result.error).toContain('Compatibility');

    const txn = store.transactions[0]!;
    expect(txn.state).toBe('failed');
  });

  // -----------------------------------------------------------------------
  // importSkill → confirmBindings — full flow
  // -----------------------------------------------------------------------

  it('full flow: importSkill -> confirmBindings -> employee created', async () => {
    const importResult = await svc.importSkill(VALID_SKILL_MD);
    expect(importResult.plan).toBeDefined();

    const materializeResult = await svc.confirmBindings(importResult.installTxnId, []);

    expect(materializeResult.employeeIds).toHaveLength(1);
    expect(materializeResult.installedPackageId).toBeTruthy();

    // Check final state
    const txn = store.transactions[0]!;
    expect(txn.state).toBe('installed');
    expect(txn.finished_at).not.toBeNull();

    // Check materialized entities
    expect(store.packages).toHaveLength(1);
    expect(store.assets).toHaveLength(1);
    expect(store.employees).toHaveLength(1);
  });

  it('creates employee with correct name from skill', async () => {
    const importResult = await svc.importSkill(VALID_SKILL_MD);
    await svc.confirmBindings(importResult.installTxnId, []);

    expect(store.employees).toHaveLength(1);
    const emp = store.employees[0]!;
    expect(emp.name).toBe('test-coder');
    expect(emp.source_package_id).toContain('openclaw-skill');
  });

  // -----------------------------------------------------------------------
  // Event emission
  // -----------------------------------------------------------------------

  it('emits state change events through the full flow', async () => {
    const importResult = await svc.importSkill(VALID_SKILL_MD);
    await svc.confirmBindings(importResult.installTxnId, []);

    const transitions = installEvents.map((e) => `${e.prev}->${e.next}`);
    expect(transitions).toContain('created->manifest_loaded');
    expect(transitions).toContain('manifest_loaded->integrity_checked');
    expect(transitions).toContain('integrity_checked->compatibility_checked');
    expect(transitions).toContain('compatibility_checked->dependency_planned');
    expect(transitions).toContain('materializing->installed');
  });

  it('emits error event when skill parse fails', async () => {
    await svc.importSkill(NO_FRONTMATTER_MD);

    const failEvent = installEvents.find((e) => e.next === 'failed');
    expect(failEvent).toBeDefined();
    expect(failEvent?.errorCode).toBe('skill_parse_failed');
  });

  it('all events have correct companyId and txnId', async () => {
    const importResult = await svc.importSkill(VALID_SKILL_MD);

    for (const evt of installEvents) {
      expect(evt.companyId).toBe(COMPANY_ID);
      expect(evt.txnId).toBe(importResult.installTxnId);
    }
  });
});
