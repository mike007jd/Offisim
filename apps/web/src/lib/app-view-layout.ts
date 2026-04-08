export type AppView =
  | 'office'
  | 'sops'
  | 'market'
  | 'activity-log'
  | 'settings'
  | 'employee-creator'
  | 'office-editor'
  | 'company-select'
  | 'studio';

export type WorkspaceAppView = (typeof WORKSPACE_VIEWS)[number];
export type FullPageWorkspaceAppView = (typeof FULL_PAGE_WORKSPACE_VIEWS)[number];

export const WORKSPACE_VIEWS = [
  'office',
  'sops',
  'market',
  'activity-log',
  'settings',
] as const satisfies readonly AppView[];

export const FULL_PAGE_WORKSPACE_VIEWS = [
  'sops',
  'market',
  'activity-log',
  'settings',
] as const satisfies readonly AppView[];

export function isWorkspaceView(view: AppView): view is WorkspaceAppView {
  return (WORKSPACE_VIEWS as readonly AppView[]).includes(view);
}

export function isFullPageWorkspaceView(view: AppView): view is FullPageWorkspaceAppView {
  return (FULL_PAGE_WORKSPACE_VIEWS as readonly AppView[]).includes(view);
}

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
  return view === 'office' || view === 'employee-creator';
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
