import type {
  AssetBindingRow,
  InstallTransactionRow,
  InstalledAssetRow,
  InstalledPackageRow,
} from '@aics/install-core';
import { describe, expect, it } from 'vitest';
import { createMemoryInstallRepositories } from '../../runtime/memory-install-repos.js';
import { createMemoryRepositories } from '../../runtime/memory-repositories.js';

function makeTxn(
  overrides?: Partial<Omit<InstallTransactionRow, 'finished_at'>>,
): Omit<InstallTransactionRow, 'finished_at'> {
  return {
    install_txn_id: 'txn-1',
    company_id: 'c-1',
    source_type: 'registry',
    source_ref: 'https://example.com/pkg.aicspkg',
    target_package_id: 'pkg-1',
    target_version: '1.0.0',
    state: 'created',
    error_code: null,
    error_detail: null,
    descriptor_json: null,
    actor_type: 'user',
    started_at: new Date().toISOString(),
    ...overrides,
  };
}

function makePkg(overrides?: Partial<InstalledPackageRow>): InstalledPackageRow {
  return {
    installed_package_id: 'ip-1',
    company_id: 'c-1',
    package_id: 'pkg-1',
    package_kind: 'employee_pack',
    version: '1.0.0',
    source_type: 'registry',
    source_ref: null,
    manifest_hash: 'abc123',
    package_hash: 'def456',
    install_state: 'installed',
    enabled: 1,
    installed_at: new Date().toISOString(),
    updated_at: new Date().toISOString(),
    ...overrides,
  };
}

function makeAsset(overrides?: Partial<InstalledAssetRow>): InstalledAssetRow {
  return {
    installed_asset_id: 'ia-1',
    installed_package_id: 'ip-1',
    asset_id: 'asset-1',
    asset_kind: 'employee',
    local_instance_id: null,
    entrypoint: null,
    enabled: 1,
    override_json: null,
    created_at: new Date().toISOString(),
    updated_at: new Date().toISOString(),
    ...overrides,
  };
}

function makeBinding(overrides?: Partial<AssetBindingRow>): AssetBindingRow {
  return {
    binding_id: 'bind-1',
    installed_asset_id: null,
    install_txn_id: 'txn-1',
    binding_type: 'model_profile',
    binding_key: 'default_model',
    binding_value_json: null,
    status: 'pending',
    created_at: new Date().toISOString(),
    updated_at: new Date().toISOString(),
    ...overrides,
  };
}

describe('MemoryInstallTransactionRepository', () => {
  it('create and findById', async () => {
    const { installTransactions } = createMemoryInstallRepositories();
    const txn = makeTxn();
    const created = await installTransactions.create(txn);
    expect(created.install_txn_id).toBe('txn-1');
    expect(created.finished_at).toBeNull();

    const found = await installTransactions.findById('txn-1');
    expect(found).not.toBeNull();
    expect(found?.state).toBe('created');
  });

  it('findById returns null for missing', async () => {
    const { installTransactions } = createMemoryInstallRepositories();
    expect(await installTransactions.findById('nope')).toBeNull();
  });

  it('updateState changes state and error fields', async () => {
    const { installTransactions } = createMemoryInstallRepositories();
    await installTransactions.create(makeTxn());
    await installTransactions.updateState(
      'txn-1',
      'failed',
      'integrity_mismatch',
      'hash does not match',
    );

    const row = await installTransactions.findById('txn-1');
    expect(row?.state).toBe('failed');
    expect(row?.error_code).toBe('integrity_mismatch');
    expect(row?.error_detail).toBe('hash does not match');
  });

  it('finish sets state and finished_at', async () => {
    const { installTransactions } = createMemoryInstallRepositories();
    await installTransactions.create(makeTxn());
    await installTransactions.finish('txn-1', 'installed');

    const row = await installTransactions.findById('txn-1');
    expect(row?.state).toBe('installed');
    expect(row?.finished_at).toBeTruthy();
  });
});

describe('MemoryInstalledPackageRepository', () => {
  it('create and findByPackageId', async () => {
    const { installedPackages } = createMemoryInstallRepositories();
    const pkg = makePkg();
    await installedPackages.create(pkg);

    const found = await installedPackages.findByPackageId('c-1', 'pkg-1');
    expect(found).toHaveLength(1);
    expect(found[0]?.installed_package_id).toBe('ip-1');
  });

  it('findByPackageId returns empty for mismatch', async () => {
    const { installedPackages } = createMemoryInstallRepositories();
    await installedPackages.create(makePkg());
    expect(await installedPackages.findByPackageId('c-1', 'wrong')).toHaveLength(0);
    expect(await installedPackages.findByPackageId('wrong', 'pkg-1')).toHaveLength(0);
  });
});

describe('MemoryInstalledAssetRepository', () => {
  it('create returns the asset', async () => {
    const { installedAssets } = createMemoryInstallRepositories();
    const asset = makeAsset();
    const created = await installedAssets.create(asset);
    expect(created.installed_asset_id).toBe('ia-1');
    expect(created.asset_kind).toBe('employee');
  });
});

describe('MemoryAssetBindingRepository', () => {
  it('create and findByTransaction', async () => {
    const { assetBindings } = createMemoryInstallRepositories();
    await assetBindings.create(makeBinding());
    await assetBindings.create(
      makeBinding({ binding_id: 'bind-2', binding_type: 'mcp_slot', binding_key: 'mcp_github' }),
    );

    const found = await assetBindings.findByTransaction('txn-1');
    expect(found).toHaveLength(2);
  });

  it('findByTransaction returns empty for unknown txn', async () => {
    const { assetBindings } = createMemoryInstallRepositories();
    expect(await assetBindings.findByTransaction('nope')).toHaveLength(0);
  });

  it('updateStatus changes status and value', async () => {
    const { assetBindings } = createMemoryInstallRepositories();
    await assetBindings.create(makeBinding());
    await assetBindings.updateStatus('bind-1', 'satisfied', '{"model":"gpt-4"}');

    const found = await assetBindings.findByTransaction('txn-1');
    expect(found[0]?.status).toBe('satisfied');
    expect(found[0]?.binding_value_json).toBe('{"model":"gpt-4"}');
  });
});

describe('EmployeeRepository.create', () => {
  it('creates an employee and returns employee_id', async () => {
    const repos = createMemoryRepositories();
    const result = await repos.employees.create({
      company_id: 'c-1',
      source_asset_id: 'asset-1',
      source_package_id: 'pkg-1',
      name: 'Alice',
      role_slug: 'developer',
    });
    expect(result.employee_id).toBeTruthy();
    expect(typeof result.employee_id).toBe('string');

    // Verify the employee can be found
    const emp = await repos.employees.findById(result.employee_id);
    expect(emp).not.toBeNull();
    expect(emp?.name).toBe('Alice');
    expect(emp?.role_slug).toBe('developer');
    expect(emp?.company_id).toBe('c-1');
  });
});
