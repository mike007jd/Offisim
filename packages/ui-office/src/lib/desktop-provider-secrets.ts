/**
 * Desktop runtime secret storage — neutral keyring capability.
 *
 * Provides local secret storage for self-developed transport adapters.
 * Does NOT provide vendor-direct gateway creation (removed per AI Runtime Policy).
 */
import type { ProviderProductAccessMode, ProviderProductId } from '@offisim/shared-types';
import { isTauri } from './env';

export interface RuntimeSecretStatus {
  hasSecret: boolean;
}

export interface TrustedHostProductStatus {
  available: boolean;
  resolverKind: string;
  message?: string | null;
}

type DesktopInvoke = <T>(command: string, args?: Record<string, unknown>) => Promise<T>;

async function invokeDesktop<T>(command: string, args?: Record<string, unknown>): Promise<T> {
  const tauriCore = (await import('@tauri-apps/api/core')) as {
    invoke: DesktopInvoke;
  };
  const { invoke } = tauriCore;
  return invoke<T>(command, args);
}

export async function getRuntimeSecretStatus(): Promise<RuntimeSecretStatus> {
  if (!isTauri()) return { hasSecret: false };
  return invokeDesktop<RuntimeSecretStatus>('runtime_secret_status');
}

export async function setRuntimeSecret(secret: string): Promise<void> {
  if (!isTauri()) return;
  await invokeDesktop('runtime_secret_set', { secret });
}

export async function clearRuntimeSecret(): Promise<void> {
  if (!isTauri()) return;
  await invokeDesktop('runtime_secret_clear');
}

export async function getTrustedHostProductStatus(
  productId: ProviderProductId,
  accessMode: ProviderProductAccessMode,
): Promise<TrustedHostProductStatus> {
  if (!isTauri()) {
    return {
      available: false,
      resolverKind: 'none',
      message: 'Trusted host resolution is unavailable in browser runtime.',
    };
  }
  return invokeDesktop<TrustedHostProductStatus>('trusted_host_product_status', {
    productId,
    accessMode,
  });
}
