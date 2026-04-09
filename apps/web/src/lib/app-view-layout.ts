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
export type OfficeViewMode = '2D' | '3D';

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
 * be mounted. True for Office and the employee-creator overlay (which renders
 * on top of the Office shell).
 */
export function shouldShowAppShell(view: AppView): boolean {
  return view === 'office' || view === 'employee-creator';
}


export function isOfficeSceneInteractive(view: AppView): boolean {
  return view === 'office';
}

export function shouldShowEmployeeCreatorOverlay(view: AppView): boolean {
  return view === 'employee-creator';
}
