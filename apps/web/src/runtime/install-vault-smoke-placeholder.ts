export function installVaultSmokePlaceholder(): void {
  if (import.meta.env.PROD || typeof window === 'undefined') return;

  const smokeWindow = window as typeof window & {
    __VAULT_SMOKE__?: () => Promise<unknown>;
  };

  smokeWindow.__VAULT_SMOKE__ = async () => ({
    ok: false as const,
    reason: 'vault smoke hook not ready yet — select or create a company first',
    probe: {
      has_TAURI: '__TAURI__' in window,
      has_TAURI_INTERNALS: '__TAURI_INTERNALS__' in window,
      runtimeReady: false,
      runtimeHasVaultActivation: false,
      runtimeReposEmployees: false,
    },
  });
}
