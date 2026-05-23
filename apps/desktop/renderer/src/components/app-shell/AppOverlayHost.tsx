import type { RuntimeRepositories } from '@offisim/core/browser';
import type { RoleSlug } from '@offisim/shared-types';
import { CompanySelectionPage } from '@offisim/ui-office/web';
import React, { Suspense } from 'react';
import type { OverlayKey } from '../../lib/app-view-layout';
import type { OfficeSessionState, UpdateWorkspaceStateFn } from '../workspaces/types';

const EmployeeCreatorOverlay = React.lazy(() =>
  import('@offisim/ui-office/employee-creator').then((m) => ({
    default: m.EmployeeCreatorOverlay,
  })),
);
const OfficeEditorOverlay = React.lazy(() =>
  import('@offisim/ui-office/office-editor').then((m) => ({ default: m.OfficeEditorOverlay })),
);
const StudioPage = React.lazy(() =>
  import('@offisim/ui-office/studio').then((m) => ({ default: m.StudioPage })),
);
const MarketplaceOverlay = React.lazy(() =>
  import('@offisim/ui-office/marketplace').then((m) => ({
    default: m.MarketplaceDetailOverlay,
  })),
);

interface InstallFlowLike {
  startRegistryInstall: (listingId: string, version: string) => void;
}

export interface AppOverlayHostProps {
  activeOverlay: OverlayKey | null;
  closeOverlay: () => void;
  portalPreviewCompanyId: string | null;
  setPortalPreviewCompanyId: (id: string | null) => void;
  onEnterCompany: (id: string) => void;
  onCreateNew: () => void;
  onArchiveCompany: (id: string) => Promise<void>;
  officeState: OfficeSessionState;
  activeCompanyId: string | null;
  repos: RuntimeRepositories | null;
  onStudioCompanyCreated: (id: string) => void;
  onCreatorDeploy: (input: { name: string; role: RoleSlug; seed: string }) => Promise<void>;
  updateOfficeState: (updater: (prev: OfficeSessionState) => OfficeSessionState) => void;
  updateWorkspaceState: UpdateWorkspaceStateFn;
  installFlow: InstallFlowLike;
}

export function AppOverlayHost(props: AppOverlayHostProps) {
  const {
    activeOverlay,
    closeOverlay,
    portalPreviewCompanyId,
    setPortalPreviewCompanyId,
    onEnterCompany,
    onCreateNew,
    onArchiveCompany,
    officeState,
    activeCompanyId,
    repos,
    onStudioCompanyCreated,
    onCreatorDeploy,
    updateOfficeState,
    updateWorkspaceState,
    installFlow,
  } = props;

  return (
    <>
      {activeOverlay === 'employee-creator' && (
        <div className="fixed inset-0 z-top">
          <Suspense fallback={null}>
            <EmployeeCreatorOverlay open onClose={closeOverlay} onDeploy={onCreatorDeploy} />
          </Suspense>
        </div>
      )}

      {activeOverlay === 'office-editor' && (
        <Suspense fallback={null}>
          <OfficeEditorOverlay open onClose={closeOverlay} />
        </Suspense>
      )}

      {activeOverlay === 'company-select' && (
        <CompanySelectionPage
          previewCompanyId={portalPreviewCompanyId}
          onPreviewCompany={setPortalPreviewCompanyId}
          onEnterCompany={onEnterCompany}
          onCreateNew={onCreateNew}
          onArchiveCompany={onArchiveCompany}
        />
      )}

      {activeOverlay === 'studio' && (
        <Suspense fallback={null}>
          {officeState.studioMode === 'create' ? (
            <StudioPage
              mode="create"
              repos={repos}
              onBack={closeOverlay}
              onCompanyCreated={onStudioCompanyCreated}
            />
          ) : activeCompanyId ? (
            <StudioPage
              mode="edit"
              companyId={activeCompanyId}
              repos={repos}
              onBack={closeOverlay}
              onCompanyCreated={onStudioCompanyCreated}
            />
          ) : null}
        </Suspense>
      )}

      {officeState.marketplaceListingId && (
        <Suspense fallback={null}>
          <MarketplaceOverlay
            listingId={officeState.marketplaceListingId}
            onClose={() => updateOfficeState((prev) => ({ ...prev, marketplaceListingId: null }))}
            onInstall={(listingId, version) => {
              updateWorkspaceState('office', (prev) => ({
                ...prev,
                marketplaceListingId: null,
              }));
              installFlow.startRegistryInstall(listingId, version);
            }}
          />
        </Suspense>
      )}
    </>
  );
}
