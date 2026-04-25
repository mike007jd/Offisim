import { disposeEventLogStore, primeEventLogStore } from '@offisim/ui-office/web';
import type { Dispatch, SetStateAction } from 'react';
import { useEffect } from 'react';
import type { UpdateWorkspaceStateFn } from '../components/workspaces/types';
import type { OverlayKey } from '../lib/app-view-layout';

/**
 * Marker key used by `useCompanyLifecycle.handleCreateYourOwn` to bridge the
 * "Open Studio Editor" intent across the runtime re-mount that company
 * activation triggers via the `<OffisimRuntimeProvider key={companyId}>`
 * pattern in `main.tsx`. The marker is set synchronously inside the wizard's
 * single async sequence and read once on the new App mount; it is NOT a
 * generic state-watching effect chain.
 */
export const PENDING_VIEW_KEY = 'offisim:pending-view';

type PrimeEventBus = Parameters<typeof primeEventLogStore>[0];

interface CompanyRepoLike {
  companies: {
    findById: (id: string) => Promise<{ template_id?: string | null } | null>;
  };
}

export interface CompanyBootstrapDeps {
  activeCompanyId: string | null;
  repos: CompanyRepoLike | null | undefined;
  eventBus: PrimeEventBus;
  onCompanySwitch: (id: string | null) => void;
  setActiveOverlay: Dispatch<SetStateAction<OverlayKey | null>>;
  updateWorkspaceState: UpdateWorkspaceStateFn;
  setActiveTemplateId: (id: string | null) => void;
  portalPreviewCompanyId: string | null;
  setPortalPreviewCompanyId: Dispatch<SetStateAction<string | null>>;
}

export function useCompanyBootstrap(deps: CompanyBootstrapDeps): void {
  const {
    activeCompanyId,
    repos,
    eventBus,
    onCompanySwitch,
    setActiveOverlay,
    updateWorkspaceState,
    setActiveTemplateId,
    portalPreviewCompanyId,
    setPortalPreviewCompanyId,
  } = deps;

  // Company switch → reset overlay default. If the wizard signalled a
  // post-activation intent via `PENDING_VIEW_KEY`, honour it on the freshly
  // mounted App tree (the `<OffisimRuntimeProvider key={companyId}>` in
  // `main.tsx` forces a re-mount on company switch, so the wizard's direct
  // setActiveOverlay call cannot survive). Reading the marker once on mount
  // is not a state-watching effect chain — it consumes a one-shot intent.
  useEffect(() => {
    if (!activeCompanyId) {
      setActiveOverlay('company-select');
      return;
    }
    const pendingView = sessionStorage.getItem(PENDING_VIEW_KEY);
    if (pendingView === 'studio-edit') {
      sessionStorage.removeItem(PENDING_VIEW_KEY);
      updateWorkspaceState('office', (prev) => ({ ...prev, studioMode: 'edit' as const }));
      setActiveOverlay('studio');
      return;
    }
    setActiveOverlay((prev) => (prev === 'company-select' ? null : prev));
  }, [activeCompanyId, setActiveOverlay, updateWorkspaceState]);

  // Template load for active company
  useEffect(() => {
    if (!activeCompanyId || !repos) {
      setActiveTemplateId(null);
      return;
    }
    let cancelled = false;
    void repos.companies.findById(activeCompanyId).then((company) => {
      if (cancelled) return;
      if (!company) {
        onCompanySwitch(null);
        return;
      }
      setActiveTemplateId(company.template_id ?? null);
    });
    return () => {
      cancelled = true;
    };
  }, [activeCompanyId, repos, onCompanySwitch, setActiveTemplateId]);

  // Portal preview sync
  useEffect(() => {
    if (!portalPreviewCompanyId && activeCompanyId) {
      setPortalPreviewCompanyId(activeCompanyId);
    }
  }, [activeCompanyId, portalPreviewCompanyId, setPortalPreviewCompanyId]);

  // Event log prime / dispose
  useEffect(() => {
    primeEventLogStore(eventBus);
    return () => {
      disposeEventLogStore(eventBus);
    };
  }, [eventBus]);
}
