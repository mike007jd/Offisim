import { disposeEventLogStore, primeEventLogStore } from '@offisim/ui-office/web';
import type { Dispatch, SetStateAction } from 'react';
import { useEffect } from 'react';
import type { UpdateWorkspaceStateFn } from '../components/workspaces/types';
import type { OverlayKey } from '../lib/app-view-layout';

// One-shot intent marker bridging the "Open Studio Editor" flow across the
// runtime re-mount that `<OffisimRuntimeProvider key={companyId}>` forces on
// company switch. Consumed once on the new App mount, then cleared.
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
