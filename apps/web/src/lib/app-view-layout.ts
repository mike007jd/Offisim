export type AppView =
  | 'office'
  | 'sops'
  | 'market'
  | 'activity-log'
  | 'employee-creator'
  | 'office-editor'
  | 'company-select'
  | 'studio';

/**
 * Whether the main app shell (header + left rail + center + right rail) should
 * be mounted. This is true for all views that live inside the shell — Office
 * and the non-office workspaces routed by WorkspaceRouter.
 *
 * Previously named `shouldKeepOfficeMounted`, this kept the Office scene
 * rendered behind non-office workspaces. Now the WorkspaceRouter handles
 * center-surface switching and the Office scene is only mounted when active.
 */
export function shouldShowAppShell(view: AppView): boolean {
  return (
    view === 'office' ||
    view === 'sops' ||
    view === 'market' ||
    view === 'activity-log' ||
    view === 'employee-creator'
  );
}

/**
 * @deprecated Use `shouldShowAppShell` instead. Kept temporarily for
 * backward compatibility during the workspace IA migration.
 */
export const shouldKeepOfficeMounted = shouldShowAppShell;

export function isOfficeSceneInteractive(view: AppView): boolean {
  return view === 'office';
}

export function shouldShowEmployeeCreatorOverlay(view: AppView): boolean {
  return view === 'employee-creator';
}
