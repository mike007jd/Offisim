import { isAnyModalOpen } from '@offisim/ui-core';
import { useEffect } from 'react';
import type {
  OfficeSessionState,
  UpdateWorkspaceStateFn,
  WorkspaceKey,
  WorkspaceSessionState,
} from '../components/workspaces/types';
import { tryWorkspaceInternalBack } from '../components/workspaces/useWorkspaceSessionState';
import type { OverlayKey } from '../lib/app-view-layout';
import type { RouteToPersonnelFn } from '../lib/personnel-routing';

export interface AppKeyboardShortcutsDeps {
  activeWorkspace: WorkspaceKey;
  workspaceSessionState: WorkspaceSessionState;
  isOffice: boolean;
  officeState: OfficeSessionState;
  activeOverlay: OverlayKey | null;
  closeOverlay: () => void;
  setShortcutHelpOpen: (updater: boolean | ((prev: boolean) => boolean)) => void;
  routeToPersonnel: RouteToPersonnelFn;
  handleToggleKanban: () => void;
  updateWorkspaceState: UpdateWorkspaceStateFn;
  onViewModeClick: () => void;
}

export function useAppKeyboardShortcuts(deps: AppKeyboardShortcutsDeps): void {
  const {
    activeWorkspace,
    workspaceSessionState,
    isOffice,
    officeState,
    activeOverlay,
    closeOverlay,
    setShortcutHelpOpen,
    routeToPersonnel,
    handleToggleKanban,
    updateWorkspaceState,
    onViewModeClick,
  } = deps;

  useEffect(() => {
    function handleKeyDown(e: KeyboardEvent) {
      const anyModalOpen = isAnyModalOpen();

      // Cmd/Ctrl+/ always toggles the shortcut help. Surface it even while
      // other modals are open so users can discover shortcuts at any time.
      if ((e.metaKey || e.ctrlKey) && (e.key === '/' || e.key === '?')) {
        e.preventDefault();
        setShortcutHelpOpen((prev) => !prev);
        return;
      }

      // When any topmost modal owns input, leave every other shortcut to the
      // owner's own useTopmostEscape / keydown handlers.
      if (anyModalOpen) return;

      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === 'j') {
        if (!isOffice) return;
        e.preventDefault();
        handleToggleKanban();
        return;
      }
      if ((e.metaKey || e.ctrlKey) && e.key === '1') {
        if (!isOffice) return;
        e.preventDefault();
        updateWorkspaceState('office', (prev) => ({
          ...prev,
          viewMode: prev.viewMode === '3D' ? '2D' : '3D',
        }));
        onViewModeClick();
        return;
      }
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === 'e') {
        if (!isOffice) return;
        if (!officeState.selectedEmployeeId) return;
        e.preventDefault();
        routeToPersonnel(officeState.selectedEmployeeId, 'profile');
        return;
      }

      // Escape fallback for non-modal overlays (e.g. CompanySelectionPage)
      // that don't register in the modal stack. Modal-backed surfaces already
      // handle Escape via useTopmostEscape.
      if (e.key === 'Escape') {
        if (activeOverlay) {
          closeOverlay();
          return;
        }
        const [consumed, nextSessionState] = tryWorkspaceInternalBack(
          activeWorkspace,
          workspaceSessionState,
        );
        if (consumed) {
          e.preventDefault();
          updateWorkspaceState(activeWorkspace, (prev) => {
            switch (activeWorkspace) {
              case 'office':
                return nextSessionState.office as typeof prev;
              case 'sops':
                return nextSessionState.sops as typeof prev;
              case 'market':
                return nextSessionState.market as typeof prev;
              case 'personnel':
                return nextSessionState.personnel as typeof prev;
              case 'workspace':
                return nextSessionState.workspace as typeof prev;
              case 'activity-log':
                return nextSessionState.activityLog as typeof prev;
              case 'settings':
                return nextSessionState.settings as typeof prev;
              default: {
                // Exhaustiveness guard: TS will error here if a new WorkspaceKey
                // is added without a matching case above.
                const _exhaustive: never = activeWorkspace;
                return _exhaustive;
              }
            }
          });
          return;
        }
        return;
      }
    }
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [
    activeWorkspace,
    activeOverlay,
    closeOverlay,
    isOffice,
    routeToPersonnel,
    handleToggleKanban,
    officeState.selectedEmployeeId,
    onViewModeClick,
    setShortcutHelpOpen,
    updateWorkspaceState,
    workspaceSessionState,
  ]);
}
