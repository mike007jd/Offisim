import { useEffect } from 'react';
import type { OfficeSessionState, UpdateWorkspaceStateFn } from '../components/workspaces/types';
import type { OverlayKey } from '../lib/app-view-layout';

export interface AppKeyboardShortcutsDeps {
  isOffice: boolean;
  officeState: OfficeSessionState;
  activeOverlay: OverlayKey | null;
  closeOverlay: () => void;
  goBack: () => void;
  shortcutHelpOpen: boolean;
  setShortcutHelpOpen: (next: boolean) => void;
  employeeEditor: {
    isOpen: boolean;
    close: () => void;
    openForEdit: (id: string) => Promise<void> | void;
  };
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
    shortcutHelpOpen,
    setShortcutHelpOpen,
    employeeEditor,
    handleToggleDashboard,
    handleToggleKanban,
    updateWorkspaceState,
  } = deps;

  useEffect(() => {
    function handleKeyDown(e: KeyboardEvent) {
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
        void employeeEditor.openForEdit(officeState.selectedEmployeeId);
        return;
      }
      if ((e.metaKey || e.ctrlKey) && (e.key === '/' || e.key === '?')) {
        e.preventDefault();
        setShortcutHelpOpen(true);
        return;
      }
      if (e.key === 'Escape') {
        if (shortcutHelpOpen) {
          setShortcutHelpOpen(false);
          return;
        }
        if (employeeEditor.isOpen) {
          employeeEditor.close();
          return;
        }
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
    employeeEditor,
    goBack,
    handleToggleDashboard,
    handleToggleKanban,
    officeState.selectedEmployeeId,
    setShortcutHelpOpen,
    shortcutHelpOpen,
    updateWorkspaceState,
  ]);
}
