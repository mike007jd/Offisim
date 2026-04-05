import { describe, expect, it, vi } from 'vitest';
import type { MaterializeResult } from '../materializer.js';
import { rollback } from '../rollback.js';
import type { InstallRepositories } from '../types.js';

function createMockRepos(): InstallRepositories {
  return {
    installTransactions: {
      create: vi.fn(),
      findById: vi.fn(),
      updateState: vi.fn(),
      finish: vi.fn(),
    },
    installedPackages: {
      create: vi.fn(),
      findByPackageId: vi.fn(),
      delete: vi.fn(),
    },
    installedAssets: {
      create: vi.fn(),
      delete: vi.fn(),
    },
    assetBindings: {
      create: vi.fn(),
      findByTransaction: vi.fn(),
      updateStatus: vi.fn(),
      delete: vi.fn(),
    },
    employees: {
      create: vi.fn(),
      delete: vi.fn(),
    },
  };
}

const RESULT: MaterializeResult = {
  installedPackageId: 'pkg-1',
  installedAssetIds: ['asset-1', 'asset-2'],
  employeeIds: ['emp-1'],
  bindingIds: ['bind-1', 'bind-2'],
};

describe('rollback', () => {
  it('deletes all entities in reverse creation order', async () => {
    const repos = createMockRepos();
    const callOrder: string[] = [];

    (repos.assetBindings.delete as ReturnType<typeof vi.fn>).mockImplementation((id: string) => {
      callOrder.push(`binding:${id}`);
      return Promise.resolve();
    });
    (repos.installedAssets.delete as ReturnType<typeof vi.fn>).mockImplementation((id: string) => {
      callOrder.push(`asset:${id}`);
      return Promise.resolve();
    });
    (repos.employees.delete as ReturnType<typeof vi.fn>).mockImplementation((id: string) => {
      callOrder.push(`employee:${id}`);
      return Promise.resolve();
    });
    (repos.installedPackages.delete as ReturnType<typeof vi.fn>).mockImplementation(
      (id: string) => {
        callOrder.push(`package:${id}`);
        return Promise.resolve();
      },
    );

    await rollback(RESULT, repos);

    expect(callOrder).toEqual([
      'binding:bind-1',
      'binding:bind-2',
      'asset:asset-1',
      'asset:asset-2',
      'employee:emp-1',
      'package:pkg-1',
    ]);
  });

  it('continues on individual delete failure (best-effort)', async () => {
    const repos = createMockRepos();
    const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});

    (repos.assetBindings.delete as ReturnType<typeof vi.fn>).mockRejectedValueOnce(
      new Error('bind fail'),
    );

    await rollback(RESULT, repos);

    // Other deletes still called despite binding failure
    expect(repos.installedAssets.delete).toHaveBeenCalledTimes(2);
    expect(repos.employees.delete).toHaveBeenCalledTimes(1);
    expect(repos.installedPackages.delete).toHaveBeenCalledTimes(1);

    // Warning logged
    expect(warnSpy).toHaveBeenCalledWith(
      '[install-core/rollback] Partial cleanup — some deletes failed:',
      expect.arrayContaining([expect.stringContaining('bind fail')]),
    );

    warnSpy.mockRestore();
  });

  it('handles empty result (no entities to delete)', async () => {
    const repos = createMockRepos();
    const emptyResult: MaterializeResult = {
      installedPackageId: 'pkg-2',
      installedAssetIds: [],
      employeeIds: [],
      bindingIds: [],
    };

    await rollback(emptyResult, repos);

    expect(repos.assetBindings.delete).not.toHaveBeenCalled();
    expect(repos.installedAssets.delete).not.toHaveBeenCalled();
    expect(repos.employees.delete).not.toHaveBeenCalled();
    expect(repos.installedPackages.delete).toHaveBeenCalledWith('pkg-2');
  });
});
