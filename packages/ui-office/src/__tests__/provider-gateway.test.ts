import { beforeEach, describe, expect, it, vi } from 'vitest';
import * as desktopSecrets from '../lib/desktop-provider-secrets';

vi.mock('@tauri-apps/api/core', () => ({
  invoke: vi.fn(),
}));

function setTauriMode(enabled: boolean) {
  if (enabled) {
    Object.defineProperty(window, '__TAURI__', {
      value: {},
      configurable: true,
    });
    return;
  }

  Reflect.deleteProperty(window, '__TAURI__');
}

describe('desktop runtime secrets', () => {
  beforeEach(() => {
    vi.resetModules();
    vi.clearAllMocks();
    setTauriMode(true);
  });

  it('exports runtime secret functions', () => {
    expect(typeof desktopSecrets.getRuntimeSecretStatus).toBe('function');
    expect(typeof desktopSecrets.setRuntimeSecret).toBe('function');
    expect(typeof desktopSecrets.clearRuntimeSecret).toBe('function');
  });

  it('does not export createDesktopProviderGateway (removed per AI Runtime Policy)', () => {
    const mod = desktopSecrets as Record<string, unknown>;
    expect(mod.createDesktopProviderGateway).toBeUndefined();
  });

  it('does not export old provider secret aliases (removed)', () => {
    const mod = desktopSecrets as Record<string, unknown>;
    expect(mod.getProviderSecretStatus).toBeUndefined();
    expect(mod.setProviderSecret).toBeUndefined();
    expect(mod.clearProviderSecret).toBeUndefined();
  });

  it('getRuntimeSecretStatus calls runtime_secret_status', async () => {
    const { invoke } = await import('@tauri-apps/api/core');
    vi.mocked(invoke).mockResolvedValueOnce({ hasSecret: true });

    const status = await desktopSecrets.getRuntimeSecretStatus();
    expect(status).toEqual({ hasSecret: true });
    expect(invoke).toHaveBeenCalledWith('runtime_secret_status', undefined);
  });

  it('returns { hasSecret: false } when not in Tauri', async () => {
    setTauriMode(false);
    const status = await desktopSecrets.getRuntimeSecretStatus();
    expect(status).toEqual({ hasSecret: false });
  });
});
