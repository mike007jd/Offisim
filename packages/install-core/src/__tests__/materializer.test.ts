import { beforeEach, describe, expect, it } from 'vitest';
import { materialize } from '../materializer.js';
import type {
  AssetBindingRow,
  BindingConfirmation,
  InstallPlan,
  InstallRepositories,
  InstalledAssetRow,
  InstalledPackageRow,
  NewEmployee,
} from '../types.js';
import { TEST_MANIFEST } from './fixtures/create-test-pkg.js';

// ---------------------------------------------------------------------------
// In-memory repository stubs
// ---------------------------------------------------------------------------

interface MemoryStore {
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

function createMemoryRepos(): { repos: InstallRepositories; store: MemoryStore } {
  const store: MemoryStore = {
    packages: [],
    assets: [],
    bindings: [],
    employees: [],
  };

  const repos: InstallRepositories = {
    installTransactions: {
      create: async () => {
        throw new Error('Not needed in materializer tests');
      },
      findById: async () => null,
      updateState: async () => {},
      finish: async () => {},
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
      findByTransaction: async () => [],
      updateStatus: async () => {},
      delete: async () => {},
    },
    employees: {
      create: async (emp) => {
        const id = globalThis.crypto.randomUUID();
        store.employees.push({ ...emp, employee_id: id });
        return { employee_id: id };
      },
      delete: async () => {},
    },
  };

  return { repos, store };
}

// ---------------------------------------------------------------------------
// Test plan factory
// ---------------------------------------------------------------------------

function createTestPlan(overrides?: Partial<InstallPlan>): InstallPlan {
  return {
    manifest: TEST_MANIFEST,
    compatibility: { compatible: true, errors: [] },
    bindings: [
      {
        assetId: 'test-writer-default',
        assetKind: 'employee',
        bindingType: 'model_profile',
        bindingKey: 'test-writer-default:reasoning-heavy',
        required: false,
        hint: 'for complex tasks',
        providerHints: ['openai', 'anthropic'],
      },
    ],
    needsConfirmation: false,
    confirmationReasons: [],
    packageHash: 'aaa111',
    manifestHash: 'bbb222',
    ...overrides,
  };
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('materializer / materialize', () => {
  let repos: InstallRepositories;
  let store: MemoryStore;

  const companyId = 'company-test-1';
  const installTxnId = 'txn-test-1';

  beforeEach(() => {
    ({ repos, store } = createMemoryRepos());
  });

  // -----------------------------------------------------------------------
  // Package creation
  // -----------------------------------------------------------------------
  it('creates an installed_packages row', async () => {
    const plan = createTestPlan();
    const result = await materialize(plan, [], repos, companyId, installTxnId);

    expect(store.packages).toHaveLength(1);
    const pkg = requireDefined(store.packages[0], 'Expected installed package row');
    expect(pkg.installed_package_id).toBe(result.installedPackageId);
    expect(pkg.company_id).toBe(companyId);
    expect(pkg.package_id).toBe('offisim.employee.test-writer');
    expect(pkg.package_kind).toBe('employee');
    expect(pkg.version).toBe('1.0.0');
    expect(pkg.source_type).toBe('file');
    expect(pkg.manifest_hash).toBe('bbb222');
    expect(pkg.package_hash).toBe('aaa111');
    expect(pkg.install_state).toBe('installed');
    expect(pkg.enabled).toBe(1);
  });

  // -----------------------------------------------------------------------
  // Asset creation
  // -----------------------------------------------------------------------
  it('creates installed_assets rows for each asset', async () => {
    const plan = createTestPlan();
    const result = await materialize(plan, [], repos, companyId, installTxnId);

    expect(store.assets).toHaveLength(1);
    const asset = requireDefined(store.assets[0], 'Expected installed asset row');
    expect(asset.installed_asset_id).toBe(result.installedAssetIds[0]);
    expect(asset.installed_package_id).toBe(result.installedPackageId);
    expect(asset.asset_id).toBe('test-writer-default');
    expect(asset.asset_kind).toBe('employee');
    expect(asset.entrypoint).toBe('default');
    expect(asset.enabled).toBe(1);
  });

  // -----------------------------------------------------------------------
  // Employee creation (MVP: employee assets only)
  // -----------------------------------------------------------------------
  it('creates employees for employee-kind assets', async () => {
    const plan = createTestPlan();
    const result = await materialize(plan, [], repos, companyId, installTxnId);

    expect(store.employees).toHaveLength(1);
    expect(result.employeeIds).toHaveLength(1);

    const emp = requireDefined(store.employees[0], 'Expected installed employee row');
    expect(emp.company_id).toBe(companyId);
    expect(emp.name).toBe('Test Writer');
    expect(emp.role_slug).toBe('test-writer-default');
    expect(emp.source_asset_id).toBe('test-writer-default');
    expect(emp.source_package_id).toBe('offisim.employee.test-writer');
  });

  it('does not create employees for non-employee assets', async () => {
    const plan = createTestPlan({
      manifest: {
        ...TEST_MANIFEST,
        assets: [
          {
            asset_id: 'some-sop',
            kind: 'sop',
            path: 'assets/sop.json',
            default_enabled: true,
          },
        ],
      },
    });

    const result = await materialize(plan, [], repos, companyId, installTxnId);

    expect(store.employees).toHaveLength(0);
    expect(result.employeeIds).toHaveLength(0);
    // But an installed_asset should still be created
    expect(store.assets).toHaveLength(1);
  });

  // -----------------------------------------------------------------------
  // Binding creation
  // -----------------------------------------------------------------------
  it('creates asset_bindings with satisfied status when confirmed', async () => {
    const plan = createTestPlan();
    const bindings: BindingConfirmation[] = [
      {
        bindingKey: 'test-writer-default:reasoning-heavy',
        bindingType: 'model_profile',
        valueJson: '{"provider":"openai","model":"gpt-4o"}',
      },
    ];

    const result = await materialize(plan, bindings, repos, companyId, installTxnId);

    expect(store.bindings).toHaveLength(1);
    expect(result.bindingIds).toHaveLength(1);

    const binding = requireDefined(store.bindings[0], 'Expected satisfied binding row');
    expect(binding.binding_type).toBe('model_profile');
    expect(binding.binding_key).toBe('test-writer-default:reasoning-heavy');
    expect(binding.binding_value_json).toBe('{"provider":"openai","model":"gpt-4o"}');
    expect(binding.status).toBe('satisfied');
    expect(binding.install_txn_id).toBe(installTxnId);
  });

  it('creates bindings with skipped status when optional and not confirmed', async () => {
    const plan = createTestPlan();
    // No bindings provided — optional bindings should be 'skipped'
    await materialize(plan, [], repos, companyId, installTxnId);

    expect(store.bindings).toHaveLength(1);
    const binding = requireDefined(store.bindings[0], 'Expected skipped binding row');
    expect(binding.status).toBe('skipped');
    expect(binding.binding_value_json).toBeNull();
  });

  it('creates bindings with pending status when required and not confirmed', async () => {
    const plan = createTestPlan({
      bindings: [
        {
          assetId: 'test-writer-default',
          assetKind: 'employee',
          bindingType: 'model_profile',
          bindingKey: 'test-writer-default:reasoning-heavy',
          required: true,
          hint: 'required model',
        },
      ],
    });

    await materialize(plan, [], repos, companyId, installTxnId);

    expect(store.bindings).toHaveLength(1);
    const binding = requireDefined(store.bindings[0], 'Expected pending binding row');
    expect(binding.status).toBe('pending');
  });

  // -----------------------------------------------------------------------
  // Return value completeness
  // -----------------------------------------------------------------------
  it('returns all created entity IDs', async () => {
    const plan = createTestPlan();
    const bindings: BindingConfirmation[] = [
      {
        bindingKey: 'test-writer-default:reasoning-heavy',
        bindingType: 'model_profile',
        valueJson: '{}',
      },
    ];

    const result = await materialize(plan, bindings, repos, companyId, installTxnId);

    expect(result.installedPackageId).toBeDefined();
    expect(result.installedAssetIds).toHaveLength(1);
    expect(result.employeeIds).toHaveLength(1);
    expect(result.bindingIds).toHaveLength(1);

    // All IDs are UUID format
    const uuidRegex = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;
    expect(result.installedPackageId).toMatch(uuidRegex);
    expect(result.installedAssetIds[0]).toMatch(uuidRegex);
    expect(result.employeeIds[0]).toMatch(uuidRegex);
    expect(result.bindingIds[0]).toMatch(uuidRegex);
  });

  // -----------------------------------------------------------------------
  // Multi-asset package
  // -----------------------------------------------------------------------
  it('handles multiple assets in a package', async () => {
    const plan = createTestPlan({
      manifest: {
        ...TEST_MANIFEST,
        assets: [
          {
            asset_id: 'writer-1',
            kind: 'employee',
            path: 'assets/writer-1.json',
            entrypoint: 'main',
            default_enabled: true,
          },
          {
            asset_id: 'writer-2',
            kind: 'employee',
            path: 'assets/writer-2.json',
            default_enabled: false,
          },
        ],
      },
      bindings: [],
    });

    const result = await materialize(plan, [], repos, companyId, installTxnId);

    expect(store.packages).toHaveLength(1);
    expect(store.assets).toHaveLength(2);
    expect(store.employees).toHaveLength(2);
    expect(result.installedAssetIds).toHaveLength(2);
    expect(result.employeeIds).toHaveLength(2);

    // Check enabled flags
    expect(store.assets[0]?.enabled).toBe(1);
    expect(store.assets[1]?.enabled).toBe(0);
  });
});
