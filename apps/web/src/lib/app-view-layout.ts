export type AppView =
  | 'office'
  | 'sops'
  | 'market'
  | 'activity-log'
  | 'library'
  | 'server'
  | 'employee-creator'
  | 'office-editor'
  | 'company-select'
  | 'studio';

export function shouldKeepOfficeMounted(view: AppView): boolean {
  return (
    view === 'office' ||
    view === 'sops' ||
    view === 'market' ||
    view === 'activity-log' ||
    view === 'library' ||
    view === 'server' ||
    view === 'employee-creator'
  );
}

export function isOfficeSceneInteractive(view: AppView): boolean {
  return view === 'office';
}

export function shouldShowEmployeeCreatorOverlay(view: AppView): boolean {
  return view === 'employee-creator';
}
