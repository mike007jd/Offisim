import fs from 'node:fs/promises';
import path from 'node:path';
import { describe, expect, it } from 'vitest';

const hookModulePath = path.resolve(
  __dirname,
  '../../../../../packages/ui-office/dist/hooks/useDeepLinkInstall.js',
);

describe('Vite dev server Tauri import handling', () => {
  it('build output does not contain bare @tauri-apps event imports', async () => {
    const builtHook = await fs.readFile(hookModulePath, 'utf8');

    expect(builtHook).not.toContain('@tauri-apps/api/event');
    expect(builtHook).toContain("const tauriEventModule = '@tauri-apps' + '/api/event';");
    expect(builtHook).toContain('import(/* @vite-ignore */ tauriEventModule)');
  });
});
