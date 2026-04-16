import { type Dispatch, type SetStateAction, useCallback, useState } from 'react';
import type { OverlayKey } from '../lib/app-view-layout';

export interface OverlayStateApi {
  activeOverlay: OverlayKey | null;
  setActiveOverlay: Dispatch<SetStateAction<OverlayKey | null>>;
  closeOverlay: () => void;
  openCompanySelect: () => void;
  openStudio: () => void;
  openEmployeeCreator: () => void;
  openOfficeEditor: () => void;
}

export function useOverlayState(initialCompanyId: string | null): OverlayStateApi {
  const [activeOverlay, setActiveOverlay] = useState<OverlayKey | null>(() =>
    initialCompanyId ? null : 'company-select',
  );
  const closeOverlay = useCallback(() => setActiveOverlay(null), []);
  const openCompanySelect = useCallback(() => setActiveOverlay('company-select'), []);
  const openStudio = useCallback(() => setActiveOverlay('studio'), []);
  const openEmployeeCreator = useCallback(() => setActiveOverlay('employee-creator'), []);
  const openOfficeEditor = useCallback(() => setActiveOverlay('office-editor'), []);

  return {
    activeOverlay,
    setActiveOverlay,
    closeOverlay,
    openCompanySelect,
    openStudio,
    openEmployeeCreator,
    openOfficeEditor,
  };
}
