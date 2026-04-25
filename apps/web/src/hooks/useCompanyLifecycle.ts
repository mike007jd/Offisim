import { employeeCreated } from '@offisim/core/browser';
import type { RoleSlug } from '@offisim/shared-types';
import type { ToastVariant } from '@offisim/ui-core';
import type { ProviderConfig } from '@offisim/ui-office/web';
import type { Dispatch, SetStateAction } from 'react';
import { useCallback } from 'react';
import { PENDING_VIEW_KEY } from './useCompanyBootstrap';

interface EventBusLike {
  emit: (event: ReturnType<typeof employeeCreated>) => void;
}

interface CompanyRow {
  company_id: string;
  status?: string | null;
}

interface LifecycleReposLike {
  employees?: {
    create: (input: {
      company_id: string;
      name: string;
      role_slug: RoleSlug;
      source_asset_id: string | null;
      source_package_id: string | null;
      persona_json: string;
      config_json: string;
    }) => Promise<{ employee_id: string }>;
  };
  companies: {
    update: (id: string, patch: { status?: string }) => Promise<unknown>;
  };
}

export interface CompanyLifecycleDeps {
  repos: LifecycleReposLike | null | undefined;
  eventBus: EventBusLike;
  addToast: (message: string, variant?: ToastVariant) => void;
  refreshCompanies: () => void | Promise<void>;
  switchCompany: (id: string) => void;
  onCompanySwitch: (id: string | null) => void;
  activeCompanyId: string | null;
  companies: readonly CompanyRow[];
  setPortalPreviewCompanyId: Dispatch<SetStateAction<string | null>>;
  companyWizardMode: 'create-new' | null;
  setCompanyWizardMode: Dispatch<SetStateAction<'create-new' | null>>;
  closeOverlay: () => void;
  openStudio: () => void;
  openSettings: () => void;
  reinitRuntime: () => void;
  providerConfig: ProviderConfig | null;
  setProviderConfig: Dispatch<SetStateAction<ProviderConfig | null>>;
  isOffice: boolean;
}

export interface CompanyLifecycleApi {
  handleSaveConfig: (config: ProviderConfig) => void;
  handleWizardComplete: (newCompanyId?: string) => void;
  handleSelectCompany: (id: string) => void;
  handleCreateYourOwn: (newCompanyId: string) => Promise<void>;
  handleStudioCompanyCreated: (newId: string) => void;
  handleArchiveCompany: (companyId: string) => Promise<void>;
  handleCreatorDeploy: (input: { name: string; role: RoleSlug; seed: string }) => Promise<void>;
  handleOpenStudio: () => void;
}

export function useCompanyLifecycle(deps: CompanyLifecycleDeps): CompanyLifecycleApi {
  const {
    repos,
    eventBus,
    addToast,
    refreshCompanies,
    switchCompany,
    onCompanySwitch,
    activeCompanyId,
    companies,
    setPortalPreviewCompanyId,
    companyWizardMode,
    setCompanyWizardMode,
    closeOverlay,
    openStudio,
    openSettings,
    reinitRuntime,
    providerConfig,
    setProviderConfig,
    isOffice,
  } = deps;

  const handleOpenStudio = useCallback(() => {
    if (!isOffice) return;
    openStudio();
  }, [isOffice, openStudio]);

  const handleCreatorDeploy = useCallback(
    async ({ name, role, seed }: { name: string; role: RoleSlug; seed: string }) => {
      if (!repos?.employees || !activeCompanyId) {
        addToast('Runtime not ready — please wait a moment', 'error');
        return;
      }
      try {
        addToast(`Deploying ${name} (${role})…`, 'info');
        const result = await repos.employees.create({
          company_id: activeCompanyId,
          name,
          role_slug: role,
          source_asset_id: null,
          source_package_id: null,
          persona_json: JSON.stringify({
            expertise: '',
            style: '',
            customInstructions: '',
            avatarSeed: seed,
          }),
          config_json: JSON.stringify({ modelPreference: '', temperature: 0.7, maxTokens: 4096 }),
        });
        eventBus.emit(employeeCreated(activeCompanyId, result.employee_id, name, role));
        addToast(`${name} deployed successfully`, 'success');
        closeOverlay();
      } catch (err) {
        console.error('[App] Failed to create employee:', err);
        addToast(`Failed to deploy ${name}`, 'error');
      }
    },
    [repos, eventBus, addToast, activeCompanyId, closeOverlay],
  );

  const handleArchiveCompany = useCallback(
    async (companyId: string) => {
      if (!repos) return;
      try {
        await repos.companies.update(companyId, { status: 'archived' });
        await refreshCompanies();
        addToast('Company archived', 'success');
      } catch (err) {
        addToast(err instanceof Error ? err.message : 'Failed to archive company', 'error');
        return;
      }
      setPortalPreviewCompanyId((prev) => {
        if (prev !== companyId) return prev;
        const next = companies.find((c) => c.company_id !== companyId && c.status !== 'archived');
        return next?.company_id ?? null;
      });
      if (activeCompanyId === companyId) {
        onCompanySwitch(null);
      }
    },
    [
      repos,
      refreshCompanies,
      addToast,
      companies,
      activeCompanyId,
      onCompanySwitch,
      setPortalPreviewCompanyId,
    ],
  );

  const handleSaveConfig = useCallback(
    (config: ProviderConfig) => {
      setProviderConfig(config);
      reinitRuntime();
    },
    [setProviderConfig, reinitRuntime],
  );

  const handleWizardComplete = useCallback(
    (newCompanyId?: string) => {
      refreshCompanies();
      if (newCompanyId) {
        setPortalPreviewCompanyId(newCompanyId);
        setCompanyWizardMode(null);
        switchCompany(newCompanyId);
        onCompanySwitch(newCompanyId);
        closeOverlay();
      }
      if (!providerConfig && !companyWizardMode && activeCompanyId) {
        openSettings();
      }
    },
    [
      refreshCompanies,
      setPortalPreviewCompanyId,
      setCompanyWizardMode,
      switchCompany,
      onCompanySwitch,
      closeOverlay,
      providerConfig,
      companyWizardMode,
      activeCompanyId,
      openSettings,
    ],
  );

  const handleSelectCompany = useCallback(
    (id: string) => {
      switchCompany(id);
      onCompanySwitch(id);
      closeOverlay();
    },
    [switchCompany, onCompanySwitch, closeOverlay],
  );

  const handleCreateYourOwn = useCallback(
    async (newCompanyId: string) => {
      // Single async sequence for the wizard's "Open Studio Editor" action:
      //   1. createCustomCompany already ran in the wizard (returned id)
      //   2. set the studio-edit intent marker for the post-remount handoff
      //   3. activate the freshly created company (switchCompany triggers a
      //      <OffisimRuntimeProvider key={companyId}> re-mount in main.tsx —
      //      the marker is the only reliable bridge across that re-mount)
      //   4. close the wizard
      // The new App tree mounts and `useCompanyBootstrap` consumes the
      // marker, opening Studio in edit mode. This is a single user action
      // with sequential setState — not a state-watching effect chain.
      setPortalPreviewCompanyId(newCompanyId);
      sessionStorage.setItem(PENDING_VIEW_KEY, 'studio-edit');
      switchCompany(newCompanyId);
      onCompanySwitch(newCompanyId);
      setCompanyWizardMode(null);
      await refreshCompanies();
    },
    [
      refreshCompanies,
      setPortalPreviewCompanyId,
      switchCompany,
      onCompanySwitch,
      setCompanyWizardMode,
    ],
  );

  const handleStudioCompanyCreated = useCallback(
    (newId: string) => {
      switchCompany(newId);
      onCompanySwitch(newId);
      refreshCompanies();
      setPortalPreviewCompanyId(newId);
      closeOverlay();
    },
    [switchCompany, onCompanySwitch, refreshCompanies, setPortalPreviewCompanyId, closeOverlay],
  );

  return {
    handleSaveConfig,
    handleWizardComplete,
    handleSelectCompany,
    handleCreateYourOwn,
    handleStudioCompanyCreated,
    handleArchiveCompany,
    handleCreatorDeploy,
    handleOpenStudio,
  };
}
