import { type ProjectWorkspaceSelectionClaim, invokeCommand } from './tauri-commands.js';

export async function pickWorkspaceFolder(
  title = 'Select workspace folder',
): Promise<ProjectWorkspaceSelectionClaim | null> {
  if (typeof window === 'undefined' || !('__TAURI_INTERNALS__' in window)) {
    throw new Error('Folder picker requires the desktop runtime');
  }

  return invokeCommand('project_workspace_select', { title });
}
