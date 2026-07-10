import { invokeCommand } from '@/lib/tauri-commands.js';
import type { VaultFileSystem } from '@offisim/core/browser';

function normalizeVaultPath(path: string): string {
  const trimmed = path.trim().replace(/^\/+/u, '');
  if (trimmed.split('/').some((part) => part === '..')) {
    throw new Error('Vault path cannot contain parent-directory segments.');
  }
  return trimmed;
}

export function createTauriVaultFileSystem(): VaultFileSystem {
  return {
    root: 'app-local-data://vault',
    readFile(relPath) {
      return invokeCommand('runtime_vault_read_file', { path: normalizeVaultPath(relPath) });
    },
    writeFile(relPath, content) {
      return invokeCommand('runtime_vault_write_file', {
        path: normalizeVaultPath(relPath),
        content,
      });
    },
    listDir(relPath) {
      return invokeCommand('runtime_vault_list_dir', { path: normalizeVaultPath(relPath) });
    },
    stat(relPath) {
      return invokeCommand('runtime_vault_stat', {
        path: normalizeVaultPath(relPath),
      });
    },
    remove(relPath) {
      return invokeCommand('runtime_vault_remove', { path: normalizeVaultPath(relPath) });
    },
    mkdir(relPath) {
      return invokeCommand('runtime_vault_mkdir', { path: normalizeVaultPath(relPath) });
    },
    async exists(relPath) {
      return (await this.stat(relPath)) !== null;
    },
  };
}
