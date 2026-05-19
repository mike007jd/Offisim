import type { InMemoryEventBus, RuntimeRepositories } from '@offisim/core/browser';
import { isTauri } from '@offisim/ui-office/web';
import { type VaultActivation, activateVaultSync } from './vault-activation';
import { TauriVaultFileSystem } from './vault-tauri-fs';

export type TauriVaultActivation = VaultActivation & { root: string };

/**
 * Boot the desktop-side vault sync pipeline. Returns null when:
 * - not running inside a Tauri webview, or
 * - the fs capability / plugin registration is missing (in that case also
 *   emits `vault.sync.failed{target:'activate'}` so the UI toast fires).
 *
 * Shared between the full runtime and the lite (no-LLM) runtime so that
 * employee markdown landing does NOT require a provider key.
 */
export async function tryActivateTauriVault(deps: {
  eventBus: InMemoryEventBus;
  repos: RuntimeRepositories;
  companyId: string;
}): Promise<TauriVaultActivation | null> {
  if (!isTauri()) return null;

  let root: string | null = null;
  try {
    const { appDataDir } = (await import('@tauri-apps/api/path')) as {
      appDataDir: () => Promise<string>;
    };
    root = `${(await appDataDir()).replace(/\/+$/u, '')}/vault`;
    const fs = new TauriVaultFileSystem(root);
    // Probe the fs capability *before* wiring activation so permission /
    // plugin-registration failures surface as a toast instead of silently
    // becoming a no-op vault.
    await fs.mkdir('');
    const activation = activateVaultSync({
      fs,
      eventBus: deps.eventBus,
      repos: deps.repos,
      companyId: deps.companyId,
    });
    void activation.hydrate().catch((err) => {
      const reason = err instanceof Error ? err.message : String(err);
      console.warn('[vault] hydrate failed; vault may drift from DB until next boot', err);
      emitActivationFailure(deps.eventBus, deps.companyId, `hydrate: ${reason}`);
    });
    return { ...activation, root };
  } catch (err) {
    const reason = err instanceof Error ? err.message : String(err);
    console.warn('[vault] activation failed', { root, err });
    emitActivationFailure(deps.eventBus, deps.companyId, reason);
    return null;
  }
}

function emitActivationFailure(
  eventBus: InMemoryEventBus,
  companyId: string,
  reason: string,
): void {
  try {
    eventBus.emit({
      type: 'vault.sync.failed',
      entityId: '',
      entityType: 'employee',
      companyId,
      timestamp: Date.now(),
      payload: { employeeId: '', reason, target: 'activate' },
    });
  } catch (emitErr) {
    console.warn('[vault] failed to emit activation failure event', emitErr);
  }
}
