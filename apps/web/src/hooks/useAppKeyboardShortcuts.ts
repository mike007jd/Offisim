import { getTopmostModalId, isAnyModalOpen } from '@offisim/ui-core';
import { useEffect } from 'react';
import type { OfficeSessionState, UpdateWorkspaceStateFn } from '../components/workspaces/types';
import type { OverlayKey } from '../lib/app-view-layout';
import type { RouteToPersonnelFn } from '../lib/personnel-routing';

export interface AppKeyboardShortcutsDeps {
  isOffice: boolean;
  officeState: OfficeSessionState;
  activeOverlay: OverlayKey | null;
  closeOverlay: () => void;
  goBack: () => void;
  setShortcutHelpOpen: (updater: boolean | ((prev: boolean) => boolean)) => void;
  routeToPersonnel: RouteToPersonnelFn;
  handleToggleDashboard: () => void;
  handleToggleKanban: () => void;
  updateWorkspaceState: UpdateWorkspaceStateFn;
}

export function useAppKeyboardShortcuts(deps: AppKeyboardShortcutsDeps): void {
  const {
    isOffice,
    officeState,
    activeOverlay,
    closeOverlay,
    goBack,
    setShortcutHelpOpen,
    routeToPersonnel,
    handleToggleDashboard,
    handleToggleKanban,
    updateWorkspaceState,
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

      if (
        isOffice &&
        (e.metaKey || e.ctrlKey) &&
        e.key.toLowerCase() === 'd' &&
        officeState.dashboardOpen &&
        getTopmostModalId() === 'dashboard-overlay'
      ) {
        e.preventDefault();
        handleToggleDashboard();
        return;
      }

      if (
        isOffice &&
        (e.metaKey || e.ctrlKey) &&
        e.key.toLowerCase() === 'j' &&
        officeState.kanbanOpen &&
        getTopmostModalId() === 'kanban-overlay'
      ) {
        e.preventDefault();
        handleToggleKanban();
        return;
      }

      // When any topmost modal owns input, leave every other shortcut to the
      // owner's own useTopmostEscape / keydown handlers.
      if (anyModalOpen) return;

      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === 'd') {
        if (!isOffice) return;
        e.preventDefault();
        handleToggleDashboard();
        return;
      }
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
        goBack();
      }
    }
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [
    activeOverlay,
    closeOverlay,
    isOffice,
    routeToPersonnel,
    goBack,
    handleToggleDashboard,
    handleToggleKanban,
    officeState.dashboardOpen,
    officeState.kanbanOpen,
    officeState.selectedEmployeeId,
    setShortcutHelpOpen,
    updateWorkspaceState,
  ]);
}
