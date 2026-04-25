import type {
  PersonnelTabId,
  UpdateWorkspaceStateFn,
  WorkspaceKey,
} from '../components/workspaces/types';

export interface RouteToPersonnelDeps {
  setActiveWorkspace: (key: WorkspaceKey) => void;
  updateWorkspaceState: UpdateWorkspaceStateFn;
}

export type RouteToPersonnelFn = (employeeId: string, tab?: PersonnelTabId) => void;

/**
 * Returns a stable callback that atomically writes the Personnel selection +
 * tab and switches the active workspace. Every "edit employee" surface SHALL
 * route through this helper instead of opening a dialog.
 */
export function createRouteToPersonnel({
  setActiveWorkspace,
  updateWorkspaceState,
}: RouteToPersonnelDeps): RouteToPersonnelFn {
  return (employeeId, tab = 'profile') => {
    updateWorkspaceState('personnel', (prev) => ({
      ...prev,
      selectedEmployeeId: employeeId,
      activeEmployeeTab: tab,
    }));
    setActiveWorkspace('personnel');
  };
}
