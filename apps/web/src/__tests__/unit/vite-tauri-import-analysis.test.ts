import fs from 'node:fs/promises';
import path from 'node:path';
import { describe, expect, it } from 'vitest';

const hookModulePath = path.resolve(
  __dirname,
  '../../../../../packages/ui-office/dist/hooks/useDeepLinkInstall.js',
);
const desktopRegistrySourcePath = path.resolve(__dirname, '../../lib/desktop-mcp-registry.ts');
const desktopRegistryModulePath = path.resolve(
  __dirname,
  '../../../../../packages/ui-office/dist/lib/desktop-mcp-registry.js',
);
const desktopProviderSecretsModulePath = path.resolve(
  __dirname,
  '../../../../../packages/ui-office/dist/lib/desktop-provider-secrets.js',
);

describe('Vite dev server Tauri import handling', () => {
  it('build output does not contain bare @tauri-apps event imports', async () => {
    const builtHook = await fs.readFile(hookModulePath, 'utf8');

    expect(builtHook).not.toContain('@tauri-apps/api/event');
    expect(builtHook).toContain("const tauriEventModule = '@tauri-apps' + '/api/event';");
    expect(builtHook).toContain('import(/* @vite-ignore */ tauriEventModule)');
  });

  it('app source avoids bare @tauri-apps core imports in dynamic imports', async () => {
    const source = await fs.readFile(desktopRegistrySourcePath, 'utf8');

    expect(source).not.toContain("await import('@tauri-apps/api/core')");
    expect(source).toContain("const tauriCoreModule = '@tauri-apps' + '/api/core';");
    expect(source).toContain('import(/* @vite-ignore */ tauriCoreModule)');
  });

  it('ui-office build output avoids bare @tauri-apps core imports', async () => {
    const [desktopRegistryModule, desktopProviderSecretsModule] = await Promise.all([
      fs.readFile(desktopRegistryModulePath, 'utf8'),
      fs.readFile(desktopProviderSecretsModulePath, 'utf8'),
    ]);

    expect(desktopRegistryModule).not.toContain('@tauri-apps/api/core');
    expect(desktopRegistryModule).toContain("const tauriCoreModule = '@tauri-apps' + '/api/core';");
    expect(desktopRegistryModule).toContain('import(/* @vite-ignore */ tauriCoreModule)');

    expect(desktopProviderSecretsModule).not.toContain('@tauri-apps/api/core');
    expect(desktopProviderSecretsModule).toContain(
      "const tauriCoreModule = '@tauri-apps' + '/api/core';",
    );
    expect(desktopProviderSecretsModule).toContain('import(/* @vite-ignore */ tauriCoreModule)');
  });
});
