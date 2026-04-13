import fs from 'node:fs/promises';
import path from 'node:path';
import type { UserConfig } from 'vite';
import { describe, expect, it } from 'vitest';
import viteConfig from '../../../vite.config';

const hookModulePath = path.resolve(
  __dirname,
  '../../../../../packages/ui-office/src/hooks/useDeepLinkInstall.ts',
);
const desktopRegistrySourcePath = path.resolve(__dirname, '../../lib/desktop-mcp-registry.ts');
const desktopProviderSecretsSourcePath = path.resolve(
  __dirname,
  '../../../../../packages/ui-office/src/lib/desktop-provider-secrets.ts',
);
const vaultActivationSourcePath = path.resolve(__dirname, '../../lib/vault-tauri-activation.ts');
const vaultFsSourcePath = path.resolve(__dirname, '../../lib/vault-tauri-fs.ts');
const tauriDbSourcePath = path.resolve(__dirname, '../../lib/tauri-db.ts');
const runtimeProviderSourcePath = path.resolve(
  __dirname,
  '../../runtime/OffisimRuntimeProvider.tsx',
);

async function resolveViteConfig(env: Record<string, string | undefined>) {
  const previous = {
    TAURI_ENV_PLATFORM: process.env.TAURI_ENV_PLATFORM,
    TAURI_ENV_DEBUG: process.env.TAURI_ENV_DEBUG,
  };

  for (const [key, value] of Object.entries(env)) {
    if (value === undefined) {
      delete process.env[key];
    } else {
      process.env[key] = value;
    }
  }

  try {
    const configFactory = typeof viteConfig === 'function' ? viteConfig : () => viteConfig;
    return (await configFactory({
      command: 'serve',
      mode: 'development',
      isSsrBuild: false,
      isPreview: false,
    })) as UserConfig;
  } finally {
    if (previous.TAURI_ENV_PLATFORM === undefined) {
      process.env.TAURI_ENV_PLATFORM = undefined;
    } else {
      process.env.TAURI_ENV_PLATFORM = previous.TAURI_ENV_PLATFORM;
    }

    if (previous.TAURI_ENV_DEBUG === undefined) {
      process.env.TAURI_ENV_DEBUG = undefined;
    } else {
      process.env.TAURI_ENV_DEBUG = previous.TAURI_ENV_DEBUG;
    }
  }
}

describe('Vite dev server Tauri import handling', () => {
  it('browser frontend aliases Tauri packages to browser-safe stubs', async () => {
    const config = await resolveViteConfig({
      TAURI_ENV_PLATFORM: undefined,
      TAURI_ENV_DEBUG: undefined,
    });
    const aliases = Array.isArray(config.resolve?.alias) ? config.resolve.alias : [];
    const tauriAliases = aliases.filter(
      (entry: unknown): entry is { find: string | RegExp; replacement: string } =>
        typeof entry === 'object' && entry != null && 'replacement' in entry,
    );

    expect(
      tauriAliases.find((entry) => entry.find === '@tauri-apps/api/core')?.replacement,
    ).toContain('src/polyfills/tauri-api-core.ts');
    expect(
      tauriAliases.find((entry) => entry.find === '@tauri-apps/api/path')?.replacement,
    ).toContain('src/polyfills/tauri-api-path.ts');
    expect(
      tauriAliases.find((entry) => entry.find === '@tauri-apps/plugin-fs')?.replacement,
    ).toContain('src/polyfills/tauri-plugin-fs.ts');
    expect(
      tauriAliases.find((entry) => entry.find === '@tauri-apps/plugin-sql')?.replacement,
    ).toContain('src/polyfills/tauri-plugin-sql.ts');
  });

  it('tauri frontend does not alias Tauri packages away', async () => {
    const config = await resolveViteConfig({
      TAURI_ENV_PLATFORM: 'darwin',
      TAURI_ENV_DEBUG: 'true',
    });
    const aliases = Array.isArray(config.resolve?.alias) ? config.resolve.alias : [];

    expect(
      aliases.some(
        (entry: unknown) =>
          typeof entry === 'object' &&
          entry != null &&
          'find' in entry &&
          String(entry.find).startsWith('@tauri-apps/'),
      ),
    ).toBe(false);
  });

  it('source avoids vite-ignore bare-specifier hacks for Tauri packages', async () => {
    const sources = await Promise.all([
      fs.readFile(hookModulePath, 'utf8'),
      fs.readFile(desktopRegistrySourcePath, 'utf8'),
      fs.readFile(desktopProviderSecretsSourcePath, 'utf8'),
      fs.readFile(vaultActivationSourcePath, 'utf8'),
      fs.readFile(vaultFsSourcePath, 'utf8'),
      fs.readFile(tauriDbSourcePath, 'utf8'),
      fs.readFile(runtimeProviderSourcePath, 'utf8'),
    ]);

    for (const source of sources) {
      expect(source).not.toContain('@vite-ignore');
      expect(source).not.toContain("'@tauri-apps' +");
    }
  });
});
