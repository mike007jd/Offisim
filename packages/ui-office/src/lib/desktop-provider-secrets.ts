/**
 * Desktop runtime secret storage — neutral keyring capability.
 *
 * Provides local secret storage for self-developed transport adapters.
 * Does NOT provide vendor-direct gateway creation (removed per AI Runtime Policy).
 */
import { isTauri } from './env';

export interface RuntimeSecretStatus {
  hasSecret: boolean;
}

async function invokeDesktop<T>(command: string, args?: Record<string, unknown>): Promise<T> {
  const tauriCoreModule = '@tauri-apps' + '/api/core';
  const { invoke } =
    (await import(/* @vite-ignore */ tauriCoreModule)) as typeof import('@tauri-apps/api/core');
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
