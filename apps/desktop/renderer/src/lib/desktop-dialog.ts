import { open } from '@tauri-apps/plugin-dialog';

export async function pickWorkspaceFolder(title = 'Select workspace folder'): Promise<string | null> {
  if (typeof window === 'undefined' || !('__TAURI_INTERNALS__' in window)) {
    throw new Error('Folder picker requires the desktop runtime');
  }

  const selected = await open({
    directory: true,
    multiple: false,
    title,
  });

  if (typeof selected === 'string') return selected;
  if (Array.isArray(selected)) return typeof selected[0] === 'string' ? selected[0] : null;
  return null;
}
