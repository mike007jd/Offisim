import { employeeCreated } from '@offisim/core/browser';
import type {
  RoleSlug,
} from '@offisim/shared-types';
import { ToastBanner, useToasts } from '@offisim/ui-core';
import {
  CompanySelectionPage,
  EmployeeEditorDialog,
  ErrorBoundary,
  KeyboardShortcutsDialog,
  type ProviderConfig,
  disposeEventLogStore,
  loadProviderConfig,
  primeEventLogStore,
  useCompany,
  useCompanyEditor,
  useDeepLinkInstall,
  useEmployeeEditor,
  useInstallFlow,
  useOffisimRuntime,
} from '@offisim/ui-office/web';
import React, { Suspense, useCallback, useEffect, useMemo, useState } from 'react';
import { FullPageWorkspaceShell } from './components/workspaces/FullPageWorkspaceShell';
import { WorkspaceRouter } from './components/workspaces/WorkspaceRouter';
import type { WorkspaceKey } from './components/workspaces/types';
import { useWorkspaceBackNavigation } from './components/workspaces/useWorkspaceBackNavigation';
import { useWorkspaceSessionState } from './components/workspaces/useWorkspaceSessionState';
import { useAppRuntimeToasts } from './hooks/useAppRuntimeToasts';
import {
  type AppView,
  type OfficeViewMode,
  isFullPageWorkspaceView,
  isWorkspaceView,
  shouldShowAppShell,
  shouldShowEmployeeCreatorOverlay,
} from './lib/app-view-layout';
import { getOnboardingCopy } from './lib/onboarding-prompts';
import { markAccount, markCompany, useCompanyOnboardingState } from './lib/onboarding-store';

const PENDING_VIEW_KEY = 'offisim:pending-view';

const WORKSPACE_TITLES: Record<string, string> = {
  sops: 'SOPs',
  market: 'Market',
  'activity-log': 'Activity Log',
  settings: 'Settings',
};

/** Lazy-loaded overlay/dialog components — kept out of the initial bundle */
const CompanyCreationWizard = React.lazy(() =>
  import('@offisim/ui-office/wizard').then((m) => ({ default: m.CompanyCreationWizard })),
);
const EmployeeCreatorOverlay = React.lazy(() =>
  import('@offisim/ui-office/employee-creator').then((m) => ({
    default: m.EmployeeCreatorOverlay,
  })),
);
const OfficeEditorOverlay = React.lazy(() =>
  import('@offisim/ui-office/office-editor').then((m) => ({ default: m.OfficeEditorOverlay })),
);
const CompanyEditor = React.lazy(() =>
  import('@offisim/ui-office/company-editor').then((m) => ({ default: m.CompanyEditor })),
);
const InstallDialog = React.lazy(() =>
  import('@offisim/ui-office/install').then((m) => ({ default: m.InstallDialog })),
);
const StudioPage = React.lazy(() =>
  import('@offisim/ui-office/studio').then((m) => ({ default: m.StudioPage })),
);
const OfficeWorkspaceShellLazy = React.lazy(() =>
  import('./components/office-shell/OfficeWorkspaceShell').then((module) => ({
    default: module.OfficeWorkspaceShell,
  })),
);
// MarketplaceDetailOverlay is a legacy overlay path, intentionally kept.
// Primary market inspection happens inside MarketWorkspacePage (the full 3-pane
// workspace). This overlay + `marketplaceListingId` state exist only to handle
// deep-link installs (offisim://install?listing_id=X) that open a listing before
// the workspace is navigated to. No near-term plan to unify — routing deep-link
// installs through MarketWorkspacePage would require a deep-link spec that
// currently has no owner.

interface AppProps {
  /** Callback to propagate company switch up to main.tsx (re-keys OffisimRuntimeProvider). */
  onCompanySwitch: (id: string | null) => void;
}

// WorkspaceSurface removed — workspace pages are now rendered by WorkspaceRouter

export function App({ onCompanySwitch }: AppProps) {
  const { activeCompanyId, companies, switchCompany, refreshCompanies } = useCompany();
  const [view, setView] = useState<AppView>(() => (activeCompanyId ? 'office' : 'company-select'));
  const [viewMode, setViewMode] = useState<OfficeViewMode>('3D');
  const [dashboardOpen, setDashboardOpen] = useState(false);
  const [kanbanOpen, setKanbanOpen] = useState(false);
  const [marketplaceListingId, setMarketplaceListingId] = useState<string | null>(null);
  const [providerConfig, setProviderConfig] = useState<ProviderConfig | null>(loadProviderConfig);
  const [selectedEmployeeId, setSelectedEmployeeId] = useState<string | null>(null);
  const [leftPanelWidth, setLeftPanelWidth] = useState(44);
  const [rightPanelWidth, setRightPanelWidth] = useState(44);
  const [focusOutputsToken, setFocusOutputsToken] = useState(0);
  const [chatOpenToken, setChatOpenToken] = useState(0);
  const [studioMode, setStudioMode] = useState<'create' | 'edit'>('create');
  const [lastUserRequest, setLastUserRequest] = useState<string | null>(null);
  const [companyWizardMode, setCompanyWizardMode] = useState<'create-new' | null>(null);
  const [portalPreviewCompanyId, setPortalPreviewCompanyId] = useState<string | null>(
    activeCompanyId,
  );
  const [activeTemplateId, setActiveTemplateId] = useState<string | null>(null);
  const [shortcutHelpOpen, setShortcutHelpOpen] = useState(false);

  // ── Workspace IA: session state + back navigation ──────────────────
  const {
    state: workspaceSessionState,
    activeWorkspace,
    setActiveWorkspace,
    updateWorkspaceState,
    goBack,
  } = useWorkspaceSessionState();

  useWorkspaceBackNavigation(activeWorkspace, goBack);

  // ── Sync view ↔ activeWorkspace ────────────────────────────────────
  // When the workspace session state changes (e.g. via header nav), update
  // the legacy `view` state to match. This keeps existing code paths working
  // while we migrate to the workspace router.
  const handleWorkspaceSwitch = useCallback(
    (key: WorkspaceKey) => {
      setActiveWorkspace(key);
      setView(key as AppView);
    },
    [setActiveWorkspace],
  );

  // Keep activeWorkspace in sync when view changes from non-workspace paths
  useEffect(() => {
    if (isWorkspaceView(view)) {
      if (activeWorkspace !== view) {
        setActiveWorkspace(view as WorkspaceKey);
      }
    }
  }, [view, activeWorkspace, setActiveWorkspace]);

  const handleOpenSettings = useCallback(() => {
    handleWorkspaceSwitch('settings');
  }, [handleWorkspaceSwitch]);
  const handleBackToOffice = useCallback(() => {
    handleWorkspaceSwitch('office');
  }, [handleWorkspaceSwitch]);
  const { reinitRuntime, repos, eventBus } = useOffisimRuntime();
  const companyEditor = useCompanyEditor();
  const employeeEditor = useEmployeeEditor();
  const installFlow = useInstallFlow();
  const { toasts, addToast, dismissToast } = useToasts();
  useAppRuntimeToasts({
    eventBus,
    addToast,
    onOpenTasks: () => setFocusOutputsToken((token) => token + 1),
  });

  useEffect(() => {
    setView(activeCompanyId ? 'office' : 'company-select');
  }, [activeCompanyId]);

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
  }, [activeCompanyId, repos, onCompanySwitch]);

  useEffect(() => {
    if (!portalPreviewCompanyId && activeCompanyId) {
      setPortalPreviewCompanyId(activeCompanyId);
    }
  }, [activeCompanyId, portalPreviewCompanyId]);

  useEffect(() => {
    if (!activeCompanyId) return;
    const pendingView = sessionStorage.getItem(PENDING_VIEW_KEY);
    if (pendingView === 'studio-edit') {
      sessionStorage.removeItem(PENDING_VIEW_KEY);
      setStudioMode('edit');
      setView('studio');
    }
  }, [activeCompanyId]);

  useEffect(() => {
    primeEventLogStore(eventBus);
    return () => {
      disposeEventLogStore(eventBus);
    };
  }, [eventBus]);

  useEffect(() => {
    function handleKeyDown(e: KeyboardEvent) {
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === 'd') {
        e.preventDefault();
        setDashboardOpen((prev) => !prev);
        return;
      }
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === 'j') {
        e.preventDefault();
        setKanbanOpen((prev) => !prev);
        return;
      }
      if ((e.metaKey || e.ctrlKey) && e.key === '1') {
        e.preventDefault();
        setViewMode((prev) => (prev === '3D' ? '2D' : '3D'));
        return;
      }
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === 'e') {
        if (!selectedEmployeeId) return;
        e.preventDefault();
        void employeeEditor.openForEdit(selectedEmployeeId);
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
        if (dashboardOpen) {
          setDashboardOpen(false);
          return;
        }
        if (kanbanOpen) {
          setKanbanOpen(false);
          return;
        }
        if (marketplaceListingId) {
          setMarketplaceListingId(null);
          return;
        }
        if (employeeEditor.isOpen) {
          employeeEditor.close();
          return;
        }
        if (selectedEmployeeId) {
          setSelectedEmployeeId(null);
          return;
        }
        if (isFullPageWorkspaceView(view)) {
          handleWorkspaceSwitch('office');
        } else if (view !== 'office') {
          setView('office');
        }
      }
    }
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [
    dashboardOpen,
    employeeEditor,
    handleWorkspaceSwitch,
    kanbanOpen,
    marketplaceListingId,
    selectedEmployeeId,
    shortcutHelpOpen,
    view,
  ]);

  useEffect(() => {
    if (providerConfig) {
      markAccount('provider_configured');
    }
  }, [providerConfig]);

  useDeepLinkInstall(
    useCallback(
      ({ listing_id, version }) => {
        console.info('[deep-link] Install requested:', { listing_id, version });
        addToast(`Fetching package ${listing_id} v${version}...`, 'info');
        installFlow.startRegistryInstall(listing_id, version);
      },
      [addToast, installFlow.startRegistryInstall],
    ),
  );

  const handleSelectEmployee = useCallback((id: string | null) => {
    setSelectedEmployeeId(id);
    if (id) {
      markAccount('first_employee_clicked');
    }
  }, []);

  const handleUserMessage = useCallback(
    (text: string) => {
      setLastUserRequest(text);
      if (activeCompanyId) {
        markCompany(activeCompanyId, 'first_task_sent');
      }
    },
    [activeCompanyId],
  );

  // Welcome card only renders on the very first task of a given company.
  const activeCompanyOnboarding = useCompanyOnboardingState(activeCompanyId);
  const onboardingCopy = useMemo(() => getOnboardingCopy(activeTemplateId), [activeTemplateId]);
  const chatOnboardingWelcome = activeCompanyOnboarding.first_task_sent
    ? undefined
    : onboardingCopy.welcome;
  const chatOnboardingStarters = onboardingCopy.starterPrompts;

  const anyOverlayOpen =
    dashboardOpen ||
    kanbanOpen ||
    marketplaceListingId !== null ||
    employeeEditor.isOpen ||
    installFlow.isOpen ||
    companyEditor.isOpen ||
    shortcutHelpOpen ||
    companyWizardMode !== null;

  const handleOpenStudio = useCallback(() => {
    if (activeWorkspace !== 'office') return;
    setStudioMode('edit');
    setView('studio');
  }, [activeWorkspace]);

  const handleLayoutMetricsChange = useCallback(
    ({
      leftPanelWidth: nextLeftPanelWidth,
      rightPanelWidth: nextRightPanelWidth,
    }: {
      leftPanelWidth: number;
      rightPanelWidth: number;
    }) => {
      setLeftPanelWidth(nextLeftPanelWidth);
      setRightPanelWidth(nextRightPanelWidth);
    },
    [],
  );

  // ── Workspace center content via WorkspaceRouter ────────────────────
  // When the active workspace is not 'office', WorkspaceRouter renders the
  // appropriate workspace page. When it IS 'office', it renders children
  // (the Office scene slot) — but we handle that via the sceneCanvas prop
  // in AppLayout, so we only need WorkspaceRouter for non-office workspaces.
  const isNonOfficeWorkspace = isFullPageWorkspaceView(view);

  const workspaceRouterContent = isNonOfficeWorkspace ? (
    <WorkspaceRouter
      activeWorkspace={activeWorkspace}
      sessionState={workspaceSessionState}
      updateWorkspaceState={updateWorkspaceState}
      settingsPageProps={{
        onBack: () => handleWorkspaceSwitch('office'),
        onSave: handleSaveConfig,
        onSaveSuccess: () => addToast('Provider configuration saved', 'success'),
        onToast: (message, variant = 'info') => addToast(message, variant),
      }}
    />
  ) : null;

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
        setView('office');
      } catch (err) {
        console.error('[App] Failed to create employee:', err);
        addToast(`Failed to deploy ${name}`, 'error');
      }
    },
    [repos, eventBus, addToast, activeCompanyId],
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
    [repos, refreshCompanies, addToast, companies, activeCompanyId, onCompanySwitch],
  );

  function handleSaveConfig(config: ProviderConfig) {
    setProviderConfig(config);
    reinitRuntime();
  }

  function handleWizardComplete(newCompanyId?: string) {
    refreshCompanies();
    if (newCompanyId) {
      // Auto-enter the newly created company instead of returning to the portal.
      // Previous behavior (setView('company-select')) forced users to pick their
      // brand-new company from a list, breaking onboarding flow continuity.
      setPortalPreviewCompanyId(newCompanyId);
      setCompanyWizardMode(null);
      switchCompany(newCompanyId);
      onCompanySwitch(newCompanyId);
      setView('office');
    }
    if (!providerConfig && !companyWizardMode && activeCompanyId) {
      handleOpenSettings();
    }
  }

  /** Navigate to company selection, selecting a company triggers runtime switch. */
  function handleSelectCompany(id: string) {
    switchCompany(id);
    onCompanySwitch(id);
    setView('office');
  }

  /** Handle "Create Your Own" from wizard — opens Studio in create mode. */
  function handleCreateYourOwn(newCompanyId: string) {
    refreshCompanies();
    setPortalPreviewCompanyId(newCompanyId);
    sessionStorage.setItem(PENDING_VIEW_KEY, 'studio-edit');
    switchCompany(newCompanyId);
    onCompanySwitch(newCompanyId);
    setCompanyWizardMode(null);
  }

  /** Handle Studio save — switch to the new/edited company and return to office. */
  function handleStudioCompanyCreated(newId: string) {
    switchCompany(newId);
    onCompanySwitch(newId);
    refreshCompanies();
    setPortalPreviewCompanyId(newId);
    setView('office');
  }

  return (
    <ErrorBoundary>
      <>
        <ToastBanner toasts={toasts} onDismiss={dismissToast} />

        {shouldShowEmployeeCreatorOverlay(view) && (
          <div className="fixed inset-0 z-[70]">
            <Suspense fallback={null}>
              <EmployeeCreatorOverlay
                open
                onClose={() => setView('office')}
                onDeploy={handleCreatorDeploy}
              />
            </Suspense>
          </div>
        )}

        {/* ── Full-page views ── */}
        {view === 'office-editor' && (
          <Suspense fallback={null}>
            <OfficeEditorOverlay open onClose={() => setView('office')} />
          </Suspense>
        )}

        {view === 'company-select' && (
          <CompanySelectionPage
            previewCompanyId={portalPreviewCompanyId}
            onPreviewCompany={setPortalPreviewCompanyId}
            onEnterCompany={handleSelectCompany}
            onCreateNew={() => {
              setCompanyWizardMode('create-new');
            }}
            onArchiveCompany={handleArchiveCompany}
          />
        )}

        {view === 'studio' && (
          <Suspense fallback={null}>
            {studioMode === 'create' ? (
              <StudioPage
                mode="create"
                repos={repos}
                onBack={() => setView('office')}
                onCompanyCreated={handleStudioCompanyCreated}
              />
            ) : activeCompanyId ? (
              <StudioPage
                mode="edit"
                companyId={activeCompanyId}
                repos={repos}
                onBack={() => setView('office')}
                onCompanyCreated={handleStudioCompanyCreated}
              />
            ) : null}
          </Suspense>
        )}

        {isNonOfficeWorkspace && (
          <FullPageWorkspaceShell
            title={WORKSPACE_TITLES[activeWorkspace] ?? activeWorkspace}
            onBackToOffice={handleBackToOffice}
          >
            {workspaceRouterContent}
          </FullPageWorkspaceShell>
        )}

        {/* ── Office view (default) ── */}
        {shouldShowAppShell(view) && (
          <Suspense fallback={null}>
            <OfficeWorkspaceShellLazy
              activeCompanyId={activeCompanyId}
              anyOverlayOpen={anyOverlayOpen}
              chatOnboardingStarterPrompts={chatOnboardingStarters}
              chatOnboardingWelcome={chatOnboardingWelcome}
              chatOpenToken={chatOpenToken}
              dashboardOpen={dashboardOpen}
              focusOutputsToken={focusOutputsToken}
              kanbanOpen={kanbanOpen}
              lastUserRequest={lastUserRequest}
              leftPanelWidth={leftPanelWidth}
              rightPanelWidth={rightPanelWidth}
              marketplaceListingId={marketplaceListingId}
              onCloseDashboard={() => setDashboardOpen(false)}
              onCloseKanban={() => setKanbanOpen(false)}
              onCloseMarketplace={() => setMarketplaceListingId(null)}
              onFileImport={(file) => installFlow.startFileImport(file)}
              onInstallListing={(listingId, version) => {
                setMarketplaceListingId(null);
                installFlow.startRegistryInstall(listingId, version);
              }}
              onLayoutMetricsChange={handleLayoutMetricsChange}
              onUserMessage={handleUserMessage}
              providerConfig={providerConfig}
              view={view}
              navigation={{
                onOpenCompanyEditor: companyEditor.open,
                onOpenCompanySelect: () => setView('company-select'),
                onOpenEmployeeCreator: () => setView('employee-creator'),
                onOpenOfficeEditor: () => setView('office-editor'),
                onOpenSettings: handleOpenSettings,
                onOpenStudio: handleOpenStudio,
                onWorkspaceSwitch: handleWorkspaceSwitch,
                onToggleDashboard: () => setDashboardOpen((open) => !open),
                onToggleKanban: () => setKanbanOpen((open) => !open),
              }}
              employee={{
                selectedId: selectedEmployeeId,
                onSelect: handleSelectEmployee,
                onStartChat: (id) => {
                  handleSelectEmployee(id);
                  setChatOpenToken((token) => token + 1);
                },
                onOpenEditor: (id) => {
                  void employeeEditor.openForEdit(id);
                },
              }}
              sceneView={{
                viewMode,
                onViewModeChange: setViewMode,
                onSceneFallbackTo2D: () => {
                  setViewMode('2D');
                  addToast('3D rendering failed — switched to 2D view', 'error');
                },
              }}
            />
          </Suspense>
        )}

        {/* ── Global dialogs (available across all views) ── */}
        <Suspense fallback={null}>
          <InstallDialog {...installFlow} />
        </Suspense>
        <EmployeeEditorDialog {...employeeEditor} />
        <Suspense fallback={null}>
          <CompanyEditor {...companyEditor} onOpenOfficeEditor={() => setView('office-editor')} />
        </Suspense>
        <KeyboardShortcutsDialog open={shortcutHelpOpen} onOpenChange={setShortcutHelpOpen} />
        {view === 'office' && (
          <Suspense fallback={null}>
            <CompanyCreationWizard
              mode="populate-existing"
              companyId={activeCompanyId}
              onComplete={handleWizardComplete}
              onCreateYourOwn={handleCreateYourOwn}
            />
          </Suspense>
        )}
        {companyWizardMode === 'create-new' && (
          <Suspense fallback={null}>
            <CompanyCreationWizard
              mode="create-new"
              onComplete={handleWizardComplete}
              onCreateYourOwn={handleCreateYourOwn}
              onDismiss={() => setCompanyWizardMode(null)}
            />
          </Suspense>
        )}
      </>
    </ErrorBoundary>
  );
}
