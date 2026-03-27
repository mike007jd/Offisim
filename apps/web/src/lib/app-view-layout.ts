export type AppView = 'office' | 'employee-creator' | 'office-editor' | 'company-select' | 'studio';

export function shouldKeepOfficeMounted(view: AppView): boolean {
  return view === 'office' || view === 'employee-creator';
}

export function isOfficeSceneInteractive(view: AppView): boolean {
  return view === 'office';
}

export function shouldShowEmployeeCreatorOverlay(view: AppView): boolean {
  return view === 'employee-creator';
}
