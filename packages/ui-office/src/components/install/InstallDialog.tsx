import { Button, DialogShell, ToastBanner, useToasts } from '@offisim/ui-core';
/**
 * InstallDialog — shadcn Dialog wrapper that renders different content
 * based on the current install flow step.
 *
 * Supports both fresh installs and upgrades (PRD 3.5).
 * When upgrading, shows UpgradePreview instead of ManifestReview.
 */

import './install-animations.css';
import { CheckCircle2, XCircle } from 'lucide-react';
import { useCallback } from 'react';
import type { InstallFlowActions, InstallFlowState } from '../../hooks/useInstallFlow.js';
import { showDiscardConfirm } from '../../lib/discard-confirm-toast.js';
import { BindingForm } from './BindingForm.js';
import { InstallProgress } from './InstallProgress.js';
import { ManifestReview } from './ManifestReview.js';
import { UpgradePreview } from './UpgradePreview.js';

type InstallDialogProps = InstallFlowState & InstallFlowActions;

function LoadingContent() {
  return (
    <div className="install-dialog-state" data-state="loading">
      <div data-slot="spinner" />
      <p>Loading package...</p>
    </div>
  );
}

function DoneContent({ onClose, isUpgrade = false }: { onClose: () => void; isUpgrade?: boolean }) {
  return (
    <div className="install-dialog-state" data-state="done">
      <CheckCircle2 data-icon="state" aria-hidden="true" />
      <h3>{isUpgrade ? 'Upgrade Complete' : 'Installation Complete'}</h3>
      <p>
        {isUpgrade
          ? 'The package has been upgraded successfully.'
          : 'The package has been installed successfully.'}
      </p>
      <Button onClick={onClose} className="install-dialog-close">
        Close
      </Button>
    </div>
  );
}

function ErrorContent({
  error,
  onCancel,
  onRetry,
}: {
  error: string;
  onCancel: () => void;
  onRetry: () => void;
}) {
  return (
    <div className="install-dialog-state" data-state="error">
      <XCircle data-icon="state" aria-hidden="true" />
      <h3>Installation Failed</h3>
      <p>{error}</p>
      <div>
        <Button variant="outline" onClick={onCancel}>
          Close
        </Button>
        <Button onClick={onRetry}>Retry</Button>
      </div>
    </div>
  );
}

/** Map step to dialog title */
function getDialogTitle(step: InstallDialogProps['step'], isUpgrade: boolean): string {
  switch (step) {
    case 'loading':
      return isUpgrade ? 'Loading Upgrade' : 'Loading Package';
    case 'review':
      return isUpgrade ? 'Review Upgrade' : 'Review Package';
    case 'bindings':
      return 'Configure Bindings';
    case 'installing':
      return isUpgrade ? 'Upgrading' : 'Installing';
    case 'done':
      return isUpgrade ? 'Upgrade Complete' : 'Done';
    case 'error':
      return 'Error';
    default:
      return isUpgrade ? 'Upgrade Package' : 'Install Package';
  }
}

function getDialogDescription(
  step: InstallDialogProps['step'],
  hasUpgradeDiff: boolean,
  hasPlan: boolean,
): string | undefined {
  if (step === 'review' && hasPlan) {
    return hasUpgradeDiff
      ? 'Review the changes before upgrading.'
      : 'Review the package details before installing.';
  }
  if (step === 'bindings') return 'Configure model bindings for this package.';
  return undefined;
}

export function InstallDialog(props: InstallDialogProps) {
  const { toasts, addToast, dismissToast } = useToasts();
  const {
    isOpen,
    step,
    plan,
    error,
    bindingValues,
    upgradeDiff,
    confirmInstall,
    restart,
    submitBindings,
    setBindingValue,
    cancel,
    close,
  } = props;
  const isBlockingStep = step === 'loading' || step === 'installing';
  const isDirty = step === 'bindings' && bindingValues.size > 0;
  const description = getDialogDescription(step, !!upgradeDiff, !!plan);

  const requestClose = useCallback(() => {
    if (isBlockingStep) return;
    if (!isDirty) {
      cancel();
      return;
    }
    showDiscardConfirm(addToast, { onDiscard: cancel });
  }, [addToast, cancel, isBlockingStep, isDirty]);

  const handleRequestClose = useCallback(() => {
    if (isBlockingStep) return false;
    if (!isDirty) return undefined;
    showDiscardConfirm(addToast, { onDiscard: cancel });
    return false;
  }, [addToast, cancel, isBlockingStep, isDirty]);

  // Don't render dialog in idle state
  if (step === 'idle' && !isOpen) return null;

  function renderContent() {
    switch (step) {
      case 'loading':
        return <LoadingContent />;

      case 'review':
        if (!plan) return <LoadingContent />;
        if (upgradeDiff) {
          return (
            <UpgradePreview
              diff={upgradeDiff}
              packageTitle={plan.manifest.package.title}
              onConfirm={confirmInstall}
              onCancel={requestClose}
            />
          );
        }
        return <ManifestReview plan={plan} onApprove={confirmInstall} onCancel={requestClose} />;

      case 'bindings':
        if (!plan) return <LoadingContent />;
        return (
          <BindingForm
            bindings={plan.bindings}
            bindingValues={bindingValues}
            onSetValue={setBindingValue}
            onSubmit={submitBindings}
            onCancel={requestClose}
          />
        );

      case 'installing':
        return <InstallProgress currentStep={step} error={null} />;

      case 'done':
        return <DoneContent onClose={close} isUpgrade={!!upgradeDiff} />;

      case 'error':
        return (
          <ErrorContent
            error={error ?? 'Unknown error'}
            onCancel={requestClose}
            onRetry={restart}
          />
        );

      default:
        return null;
    }
  }

  return (
    <>
      <DialogShell
        open={isOpen}
        onOpenChange={(open) => {
          if (!open) cancel();
        }}
        size="md"
        title={getDialogTitle(step, !!upgradeDiff)}
        description={description}
        onRequestClose={handleRequestClose}
      >
        {renderContent()}
      </DialogShell>
      <ToastBanner toasts={toasts} onDismiss={dismissToast} />
    </>
  );
}
