import type { WorkspaceKey } from '../components/workspaces/types';

export type OverlayKey = 'employee-creator' | 'office-editor' | 'company-select' | 'studio';

export type OfficeViewMode = '2D' | '3D';

export function shouldShowAppShell(
  activeWorkspace: WorkspaceKey,
  activeOverlay: OverlayKey | null,
): boolean {
  return (
    activeWorkspace === 'office' &&
    (activeOverlay === null || activeOverlay === 'employee-creator')
  );
}

export function isNonOfficeWorkspace(
  activeWorkspace: WorkspaceKey,
  activeOverlay: OverlayKey | null,
): boolean {
  return activeWorkspace !== 'office' && activeOverlay === null;
}
