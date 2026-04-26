import { isTauri } from './env.js';

/**
 * Thrown by `pickWorkspaceFolder` / `revealWorkspaceFolder` when called in
 * browser mode. UI must gate calls on `isFolderPickerAvailable()` first; this
 * error is the safety net for misuse, not a user-facing message.
 */
export class FolderPickerUnavailableError extends Error {
  constructor(message = 'Folder picker is unavailable in the browser frontend.') {
    super(message);
    this.name = 'FolderPickerUnavailableError';
  }
}

export function isFolderPickerAvailable(): boolean {
  return isTauri();
}

/**
 * Open the OS folder picker. Resolves to the absolute path string the user
 * picked, or `null` if they cancelled. Throws `FolderPickerUnavailableError`
 * in browser mode.
 */
export async function pickWorkspaceFolder(): Promise<string | null> {
  if (!isFolderPickerAvailable()) {
    throw new FolderPickerUnavailableError();
  }
  const { open } = await import('@tauri-apps/plugin-dialog');
  const result = (await open({ directory: true, multiple: false })) as string | null;
  return typeof result === 'string' && result.length > 0 ? result : null;
}

/**
 * Open `path` in the OS file manager (Finder / Explorer / Files). Tries
 * `revealItemInDir` first; on failure falls back to `openPath`. Re-throws
 * the underlying error so the caller can surface a "folder not found" toast.
 */
export async function revealWorkspaceFolder(path: string): Promise<void> {
  if (!isFolderPickerAvailable()) {
    throw new FolderPickerUnavailableError();
  }
  const { revealItemInDir, openPath } = await import('@tauri-apps/plugin-opener');
  try {
    await revealItemInDir(path);
  } catch (revealErr) {
    try {
      await openPath(path);
    } catch (openErr) {
      throw openErr instanceof Error ? openErr : new Error(String(revealErr ?? openErr));
    }
  }
}
