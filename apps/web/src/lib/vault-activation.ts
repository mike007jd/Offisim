import type { EventBus, RuntimeRepositories, VaultFileSystem } from '@offisim/core/browser';
import { VaultSyncService } from '@offisim/core/browser';

export interface VaultActivationOptions {
  fs: VaultFileSystem;
  eventBus: EventBus;
  repos: RuntimeRepositories;
  companyId: string;
}

export interface VaultActivation {
  service: VaultSyncService;
  /** Re-scan the on-disk vault for newer md files and sync to DB. */
  hydrate(): Promise<{ rendered: number; importedEmployees: number }>;
  dispose(): void;
}

export function activateVaultSync(opts: VaultActivationOptions): VaultActivation {
  const service = new VaultSyncService({
    fs: opts.fs,
    eventBus: opts.eventBus,
    employees: opts.repos.employees,
    memories: opts.repos.memories,
  });
  service.subscribe();

  return {
    service,
    async hydrate() {
      const outcome = await service.hydrateCompany(opts.companyId);
      return { rendered: outcome.rendered, importedEmployees: outcome.importedEmployees };
    },
    dispose() {
      service.dispose();
    },
  };
}
