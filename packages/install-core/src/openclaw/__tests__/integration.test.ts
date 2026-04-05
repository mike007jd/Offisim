/**
 * Integration test — Full OpenClaw Skill Import Flow
 *
 * Exercises the complete end-to-end path:
 * parse → validate → synthesize → importSkill → confirmBindings → verify employee
 *
 * Uses in-memory repos (same pattern as import-skill.test.ts).
 */

import type { InstallState } from '@offisim/shared-types';
import type { BindingStatus, BindingType } from '@offisim/shared-types';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { InstallService, InstallServiceError } from '../../install-service.js';
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

const COMPANY_ID = 'company-integration-test';

const COMPAT_ENV: RuntimeEnvironment = {
  runtimeVersion: '0.1.0',
  environment: 'desktop',
  schemaVersion: '2026-03',
};

// ---------------------------------------------------------------------------
// In-memory repositories (same pattern as import-skill.test.ts)
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
// Test fixtures — realistic multi-paragraph SKILL.md files
// ---------------------------------------------------------------------------

/**
 * A realistic SKILL.md with multi-paragraph instructions,
 * requirements (bins + env), and metadata.
 */
const REALISTIC_SKILL_MD = `---
name: Senior Code Reviewer
description: An expert code reviewer specializing in TypeScript and Python
license: Apache-2.0
homepage: https://github.com/example/senior-reviewer
metadata:
  openclaw.emoji: "R"
  openclaw.requires:
    bins:
      - git
      - node
    env:
      - GITHUB_TOKEN
      - OPENAI_API_KEY
  openclaw.os:
    - linux
    - macos
---

You are a senior code reviewer with 15 years of experience in software engineering.

## Core Responsibilities

1. Review pull requests for correctness, performance, and maintainability
2. Identify potential security vulnerabilities
3. Suggest improvements to code architecture
4. Ensure code follows established team conventions

## Review Guidelines

- Always check for proper error handling
- Verify that tests cover the changed code paths
- Look for race conditions in concurrent code
- Check for proper resource cleanup (file handles, connections, etc.)

## Communication Style

Be constructive and educational. When suggesting changes:
- Explain WHY a change is needed, not just WHAT to change
- Provide code examples when possible
- Acknowledge good patterns you see in the code
- Prioritize issues by severity (critical > major > minor > style)
`;

/**
 * A minimal SKILL.md with no requirements — should produce zero warnings.
 */
const MINIMAL_SKILL_MD = `---
name: simple-helper
description: A simple helper assistant
---

You are a helpful assistant. Answer questions clearly and concisely.
`;

/**
 * Second distinct skill for sequential import test.
 */
const SECOND_SKILL_MD = `---
name: documentation-writer
description: Writes clear technical documentation
license: MIT
---

You are a technical documentation writer. Your job is to create clear,
well-structured documentation for software projects.

## Writing Principles

- Use plain language
- Include code examples
- Structure content with headers and lists
- Keep paragraphs short and focused
`;

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('OpenClaw Skill Import — Integration', () => {
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
  // 1. Full import flow: SKILL.md → employee with persona
  // -----------------------------------------------------------------------

  describe('full import flow: SKILL.md → employee with persona', () => {
    it('importSkill produces a plan with correct manifest fields', async () => {
      const result = await svc.importSkill(REALISTIC_SKILL_MD);

      expect(result.error).toBeUndefined();
      expect(result.plan).toBeDefined();

      const plan = result.plan;
      if (!plan) throw new Error('Expected plan to be defined');

      const pkg = plan.manifest.package;
      expect(pkg).toBeDefined();
      if (!pkg) throw new Error('Expected manifest package');
      expect(pkg.title).toBe('Senior Code Reviewer');
      expect(pkg.kind).toBe('employee');
      expect(pkg.id).toContain('openclaw-skill');

      // Instructions stored in custom
      const custom = plan.manifest.custom;
      expect(custom).toBeDefined();
      if (!custom) throw new Error('Expected manifest custom data to be defined');
      expect(custom.openclaw_instructions).toContain('senior code reviewer');
      expect(custom.openclaw_instructions).toContain('Core Responsibilities');
      expect(custom.openclaw_instructions).toContain('Review Guidelines');
      expect(custom.openclaw_instructions).toContain('Communication Style');
      expect(custom.openclaw_source).toBe('local_import');
    });

    it('has skill validation warnings for bins and env', async () => {
      const result = await svc.importSkill(REALISTIC_SKILL_MD);

      expect(result.skillValidation).toBeDefined();
      expect(result.skillValidation?.valid).toBe(true);

      const warnings = result.skillValidation?.warnings;
      expect(warnings).toBeDefined();
      if (!warnings) throw new Error('Expected validation warnings');
      // bins: git, node → 2 warnings; env: GITHUB_TOKEN, OPENAI_API_KEY → 2 warnings = 4 total
      expect(warnings.length).toBeGreaterThanOrEqual(4);

      const binWarnings = warnings.filter((w) => w.type === 'missing_bin');
      expect(binWarnings).toHaveLength(2);
      expect(binWarnings.some((w) => w.detail.includes('git'))).toBe(true);
      expect(binWarnings.some((w) => w.detail.includes('node'))).toBe(true);

      const envWarnings = warnings.filter((w) => w.type === 'missing_env');
      expect(envWarnings).toHaveLength(2);
      expect(envWarnings.some((w) => w.detail.includes('GITHUB_TOKEN'))).toBe(true);
      expect(envWarnings.some((w) => w.detail.includes('OPENAI_API_KEY'))).toBe(true);
    });

    it('confirmBindings materializes employee and persists all rows', async () => {
      const importResult = await svc.importSkill(REALISTIC_SKILL_MD);
      expect(importResult.plan).toBeDefined();

      const materializeResult = await svc.confirmBindings(importResult.installTxnId, []);

      // Employee was created
      expect(materializeResult.employeeIds).toHaveLength(1);
      expect(materializeResult.installedPackageId).toBeTruthy();

      // Verify employee details
      expect(store.employees).toHaveLength(1);
      const emp = store.employees[0];
      if (!emp) throw new Error('Expected one employee row');
      expect(emp.company_id).toBe(COMPANY_ID);
      expect(emp.name).toBe('Senior Code Reviewer');
      expect(emp.source_package_id).toContain('openclaw-skill');

      // Verify installed_packages row
      expect(store.packages).toHaveLength(1);
      const pkg = store.packages[0];
      if (!pkg) throw new Error('Expected one installed package row');
      expect(pkg.company_id).toBe(COMPANY_ID);
      expect(pkg.package_kind).toBe('employee');
      expect(pkg.package_id).toContain('openclaw-skill');
      expect(pkg.install_state).toBe('installed');
      expect(pkg.enabled).toBe(1);

      // Verify installed_assets row
      expect(store.assets).toHaveLength(1);
      const asset = store.assets[0];
      if (!asset) throw new Error('Expected one installed asset row');
      expect(asset.asset_kind).toBe('employee');
      expect(asset.installed_package_id).toBe(materializeResult.installedPackageId);

      // Verify transaction finished with state 'installed'
      const txn = store.transactions[0];
      if (!txn) throw new Error('Expected one transaction row');
      expect(txn.state).toBe('installed');
      expect(txn.finished_at).not.toBeNull();
      expect(txn.source_ref).toBe('openclaw-skill');
    });

    it('emits correct state transition events through the entire flow', async () => {
      const importResult = await svc.importSkill(REALISTIC_SKILL_MD);
      await svc.confirmBindings(importResult.installTxnId, []);

      const transitions = installEvents.map((e) => `${e.prev}->${e.next}`);

      // Full pipeline transitions
      expect(transitions).toContain('created->manifest_loaded');
      expect(transitions).toContain('manifest_loaded->integrity_checked');
      expect(transitions).toContain('integrity_checked->compatibility_checked');
      expect(transitions).toContain('compatibility_checked->dependency_planned');
      // Skills have no bindings → ready_to_install directly
      expect(transitions).toContain('dependency_planned->ready_to_install');
      expect(transitions).toContain('ready_to_install->materializing');
      expect(transitions).toContain('materializing->installed');

      // All events should reference the correct company and transaction
      for (const evt of installEvents) {
        expect(evt.companyId).toBe(COMPANY_ID);
        expect(evt.txnId).toBe(importResult.installTxnId);
      }
    });
  });

  // -----------------------------------------------------------------------
  // 2. Rejects skill with incompatible runtime version
  // -----------------------------------------------------------------------

  describe('rejects skill with incompatible runtime version', () => {
    it('returns error containing "Compatibility" for runtime version 99.0.0', async () => {
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

      const result = await incompatSvc.importSkill(REALISTIC_SKILL_MD);

      expect(result.error).toBeDefined();
      expect(result.error).toContain('Compatibility');
      expect(result.plan).toBeUndefined();

      // Transaction should exist and be failed
      const txn = store.transactions[0];
      if (!txn) throw new Error('Expected one transaction row');
      expect(txn.state).toBe('failed');
      expect(txn.finished_at).not.toBeNull();
    });

    it('returns error containing "Compatibility" for runtime version 3.0.0 (above range)', async () => {
      const incompatSvc = new InstallService({
        repos,
        events,
        companyId: COMPANY_ID,
        environment: {
          runtimeVersion: '3.0.0',
          environment: 'desktop',
          schemaVersion: '2026-03',
        },
      });

      const result = await incompatSvc.importSkill(MINIMAL_SKILL_MD);

      expect(result.error).toBeDefined();
      expect(result.error).toContain('Compatibility');

      const txn = store.transactions[0];
      if (!txn) throw new Error('Expected one transaction row');
      expect(txn.state).toBe('failed');
    });

    it('still includes skillValidation even when compatibility fails', async () => {
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

      const result = await incompatSvc.importSkill(REALISTIC_SKILL_MD);

      // Skill validation runs before compatibility check, so it should still be present
      expect(result.skillValidation).toBeDefined();
      expect(result.skillValidation?.valid).toBe(true);
    });
  });

  // -----------------------------------------------------------------------
  // 3. Handles cancel after import
  // -----------------------------------------------------------------------

  describe('handles cancel after import', () => {
    it('cancel after importSkill prevents confirmBindings', async () => {
      const importResult = await svc.importSkill(MINIMAL_SKILL_MD);
      expect(importResult.plan).toBeDefined();

      // Cancel the transaction
      await svc.cancel(importResult.installTxnId);

      // Transaction should be in a terminal state
      const txn = store.transactions[0];
      if (!txn) throw new Error('Expected one transaction row');
      expect(txn.finished_at).not.toBeNull();

      // confirmBindings should fail on a terminal transaction
      await expect(svc.confirmBindings(importResult.installTxnId, [])).rejects.toThrow(
        InstallServiceError,
      );

      // No employee should have been created
      expect(store.employees).toHaveLength(0);
      expect(store.packages).toHaveLength(0);
    });
  });

  // -----------------------------------------------------------------------
  // 4. Two skills can be imported sequentially
  // -----------------------------------------------------------------------

  describe('two skills can be imported sequentially', () => {
    it('import skill A → confirm → import skill B → confirm → both employees exist', async () => {
      // Import and confirm skill A
      const resultA = await svc.importSkill(REALISTIC_SKILL_MD);
      expect(resultA.error).toBeUndefined();
      const materializeA = await svc.confirmBindings(resultA.installTxnId, []);
      expect(materializeA.employeeIds).toHaveLength(1);

      // Import and confirm skill B
      const resultB = await svc.importSkill(SECOND_SKILL_MD);
      expect(resultB.error).toBeUndefined();
      const materializeB = await svc.confirmBindings(resultB.installTxnId, []);
      expect(materializeB.employeeIds).toHaveLength(1);

      // Both employees should exist
      expect(store.employees).toHaveLength(2);
      const empNames = store.employees.map((e) => e.name);
      expect(empNames).toContain('Senior Code Reviewer');
      expect(empNames).toContain('documentation-writer');

      // Both packages should exist
      expect(store.packages).toHaveLength(2);
      expect(store.packages[0]?.package_id).not.toBe(store.packages[1]?.package_id);

      // Both assets should exist
      expect(store.assets).toHaveLength(2);

      // Both transactions should be installed
      expect(store.transactions).toHaveLength(2);
      expect(store.transactions[0]?.state).toBe('installed');
      expect(store.transactions[1]?.state).toBe('installed');
    });

    it('sequential imports have distinct transaction IDs', async () => {
      const resultA = await svc.importSkill(MINIMAL_SKILL_MD);
      await svc.confirmBindings(resultA.installTxnId, []);

      const resultB = await svc.importSkill(SECOND_SKILL_MD);
      await svc.confirmBindings(resultB.installTxnId, []);

      expect(resultA.installTxnId).not.toBe(resultB.installTxnId);
    });
  });

  // -----------------------------------------------------------------------
  // 5. Skill with no requirements has no validation warnings
  // -----------------------------------------------------------------------

  describe('skill with no requirements has no validation warnings', () => {
    it('minimal skill produces zero warnings', async () => {
      const result = await svc.importSkill(MINIMAL_SKILL_MD);

      expect(result.error).toBeUndefined();
      expect(result.skillValidation).toBeDefined();
      expect(result.skillValidation?.valid).toBe(true);
      expect(result.skillValidation?.warnings).toHaveLength(0);
    });

    it('minimal skill still produces correct plan and materializes', async () => {
      const importResult = await svc.importSkill(MINIMAL_SKILL_MD);
      expect(importResult.plan).toBeDefined();
      expect(importResult.plan?.manifest.package.title).toBe('simple-helper');
      expect(importResult.plan?.needsConfirmation).toBe(false);
      expect(importResult.plan?.bindings).toHaveLength(0);

      const materializeResult = await svc.confirmBindings(importResult.installTxnId, []);
      expect(materializeResult.employeeIds).toHaveLength(1);

      expect(store.employees).toHaveLength(1);
      expect(store.employees[0]?.name).toBe('simple-helper');
      expect(store.packages[0]?.install_state).toBe('installed');
    });
  });

  // -----------------------------------------------------------------------
  // Additional edge cases
  // -----------------------------------------------------------------------

  describe('additional edge cases', () => {
    it('metadata fields (emoji, homepage, license) are preserved in manifest', async () => {
      const result = await svc.importSkill(REALISTIC_SKILL_MD);

      const plan = result.plan;
      expect(plan).toBeDefined();
      if (!plan) throw new Error('Expected plan to be defined');
      const custom = plan.manifest.custom;
      expect(custom).toBeDefined();
      if (!custom) throw new Error('Expected manifest custom data to be defined');
      expect(custom.openclaw_emoji).toBe('R');
      expect(custom.openclaw_homepage).toBe('https://github.com/example/senior-reviewer');
      expect(plan.manifest.package.license).toBe('Apache-2.0');
    });

    it('synthetic package has zero hashes', async () => {
      const result = await svc.importSkill(REALISTIC_SKILL_MD);

      expect(result.plan?.packageHash).toBe('0'.repeat(64));
      expect(result.plan?.manifestHash).toBe('0'.repeat(64));
    });

    it('permissions are data_asset with no filesystem/network scope', async () => {
      const result = await svc.importSkill(REALISTIC_SKILL_MD);

      const plan = result.plan;
      if (!plan) throw new Error('Expected plan to be defined');

      const perms = plan.manifest.permissions;
      expect(perms).toBeDefined();
      if (!perms) throw new Error('Expected manifest permissions');
      expect(perms.risk_class).toBe('data_asset');
      expect(perms.declares_secrets).toBe(false);
      expect(perms.filesystem_scope).toBe('none');
      expect(perms.network_scope).toBe('none');
    });

    it('importSkill with same skill content twice creates two separate transactions', async () => {
      const result1 = await svc.importSkill(MINIMAL_SKILL_MD);
      await svc.confirmBindings(result1.installTxnId, []);

      const result2 = await svc.importSkill(MINIMAL_SKILL_MD);
      await svc.confirmBindings(result2.installTxnId, []);

      expect(result1.installTxnId).not.toBe(result2.installTxnId);
      expect(store.transactions).toHaveLength(2);
      expect(store.employees).toHaveLength(2);
      // Both employees share the same name (from the same skill)
      expect(store.employees[0]?.name).toBe(store.employees[1]?.name);
    });
  });
});
