import { type Dispatch, type SetStateAction, useCallback, useMemo, useState } from 'react';
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

export interface UseOverlayStateOptions {
  activeCompanyId: string | null;
  initial?: OverlayKey | null;
}

export function useOverlayState({
  activeCompanyId,
  initial,
}: UseOverlayStateOptions): OverlayStateApi {
  const [activeOverlay, setActiveOverlay] = useState<OverlayKey | null>(() =>
    activeCompanyId ? (initial ?? null) : 'company-select',
  );
  const closeOverlay = useCallback(() => setActiveOverlay(null), []);
  const openCompanySelect = useCallback(() => setActiveOverlay('company-select'), []);
  const openStudio = useCallback(() => setActiveOverlay('studio'), []);
  const openEmployeeCreator = useCallback(() => setActiveOverlay('employee-creator'), []);
  const openOfficeEditor = useCallback(() => setActiveOverlay('office-editor'), []);

  // Stable identity so consumers depending on this object as a hook dep don't
  // re-run on every parent render.
  return useMemo(
    () => ({
      activeOverlay,
      setActiveOverlay,
      closeOverlay,
      openCompanySelect,
      openStudio,
      openEmployeeCreator,
      openOfficeEditor,
    }),
    [
      activeOverlay,
      closeOverlay,
      openCompanySelect,
      openStudio,
      openEmployeeCreator,
      openOfficeEditor,
    ],
  );
}
