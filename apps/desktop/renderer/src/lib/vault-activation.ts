import type {
  EventBus,
  ImportDiagnostic,
  RuntimeRepositories,
  VaultFileSystem,
} from '@offisim/core/browser';
import { VaultSyncService } from '@offisim/core/browser';

export interface VaultActivationOptions {
  fs: VaultFileSystem;
  eventBus: EventBus;
  repos: RuntimeRepositories;
  companyId: string;
}

export interface VaultHydrateOutcome {
  rendered: number;
  importedEmployees: number;
  diagnostics: readonly ImportDiagnostic[];
}

export interface VaultActivation {
  service: VaultSyncService;
  /** The live filesystem backing this activation (desktop fs / web FSAccess). */
  fs: VaultFileSystem;
  /** Re-scan the on-disk vault for newer md files and sync to DB. */
  hydrate(): Promise<VaultHydrateOutcome>;
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
    fs: opts.fs,
    async hydrate() {
      const outcome = await service.hydrateCompany(opts.companyId);
      return {
        rendered: outcome.rendered,
        importedEmployees: outcome.importedEmployees,
        diagnostics: outcome.diagnostics,
      };
    },
    dispose() {
      service.dispose();
    },
  };
}
