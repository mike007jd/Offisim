import {
  EmployeeEditorDialog,
  KeyboardShortcutsDialog,
  type useCompanyEditor,
  type useEmployeeEditor,
  type useInstallFlow,
} from '@offisim/ui-office/web';
import React, { Suspense } from 'react';
import type { OverlayKey } from '../../lib/app-view-layout';

const CompanyCreationWizard = React.lazy(() =>
  import('@offisim/ui-office/wizard').then((m) => ({ default: m.CompanyCreationWizard })),
);
const CompanyEditor = React.lazy(() =>
  import('@offisim/ui-office/company-editor').then((m) => ({ default: m.CompanyEditor })),
);
const InstallDialog = React.lazy(() =>
  import('@offisim/ui-office/install').then((m) => ({ default: m.InstallDialog })),
);

type InstallFlowLike = ReturnType<typeof useInstallFlow>;
type EmployeeEditorLike = ReturnType<typeof useEmployeeEditor>;
type CompanyEditorLike = ReturnType<typeof useCompanyEditor>;

export interface AppGlobalDialogsProps {
  installFlow: InstallFlowLike;
  employeeEditor: EmployeeEditorLike;
  companyEditor: CompanyEditorLike;
  openOfficeEditor: () => void;
  shortcutHelpOpen: boolean;
  setShortcutHelpOpen: (next: boolean) => void;
  isOffice: boolean;
  activeOverlay: OverlayKey | null;
  activeCompanyId: string | null;
  companyWizardMode: 'create-new' | null;
  onWizardComplete: (newCompanyId?: string) => void;
  onCreateYourOwn: (newCompanyId: string) => void | Promise<void>;
  onDismissWizard: () => void;
}

export function AppGlobalDialogs(props: AppGlobalDialogsProps) {
  const {
    installFlow,
    employeeEditor,
    companyEditor,
    openOfficeEditor,
    shortcutHelpOpen,
    setShortcutHelpOpen,
    isOffice,
    activeOverlay,
    activeCompanyId,
    companyWizardMode,
    onWizardComplete,
    onCreateYourOwn,
    onDismissWizard,
  } = props;

  return (
    <>
      <Suspense fallback={null}>
        <InstallDialog {...installFlow} />
      </Suspense>
      <EmployeeEditorDialog {...employeeEditor} />
      <Suspense fallback={null}>
        <CompanyEditor {...companyEditor} onOpenOfficeEditor={openOfficeEditor} />
      </Suspense>
      <KeyboardShortcutsDialog open={shortcutHelpOpen} onOpenChange={setShortcutHelpOpen} />
      {isOffice && activeOverlay === null && (
        <Suspense fallback={null}>
          <CompanyCreationWizard
            mode="populate-existing"
            companyId={activeCompanyId}
            onComplete={onWizardComplete}
            onCreateYourOwn={onCreateYourOwn}
          />
        </Suspense>
      )}
      {companyWizardMode === 'create-new' && (
        <Suspense fallback={null}>
          <CompanyCreationWizard
            mode="create-new"
            onComplete={onWizardComplete}
            onCreateYourOwn={onCreateYourOwn}
            onDismiss={onDismissWizard}
          />
        </Suspense>
      )}
    </>
  );
}
