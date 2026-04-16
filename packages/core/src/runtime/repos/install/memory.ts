import {
  type MemoryAssetBindingRepository,
  type MemoryInstallTransactionRepository,
  type MemoryInstalledAssetRepository,
  type MemoryInstalledPackageRepository,
  createMemoryInstallRepositories,
} from '../../memory-install-repos.js';
import type { MemoryRepositoriesSnapshot } from '../memory-types.js';

export {
  MemoryAssetBindingRepository,
  MemoryInstallTransactionRepository,
  MemoryInstalledAssetRepository,
  MemoryInstalledPackageRepository,
} from '../../memory-install-repos.js';

export interface InstallMemoryRepos {
  installTransactions: MemoryInstallTransactionRepository;
  installedPackages: MemoryInstalledPackageRepository;
  installedAssets: MemoryInstalledAssetRepository;
  assetBindings: MemoryAssetBindingRepository;
}

export function createInstallMemoryRepos(
  snapshot?: Partial<MemoryRepositoriesSnapshot>,
): InstallMemoryRepos {
  return createMemoryInstallRepositories(snapshot);
}
