/**
 * InstallDialog — shadcn Dialog wrapper that renders different content
 * based on the current install flow step.
 */

import './install-animations.css';
import { CheckCircle2, XCircle } from 'lucide-react';
import type { InstallFlowActions, InstallFlowState } from '../../hooks/useInstallFlow.js';
import { Button } from '../ui/button';
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from '../ui/dialog';
import { BindingForm } from './BindingForm.js';
import { InstallProgress } from './InstallProgress.js';
import { ManifestReview } from './ManifestReview.js';
import { SkillReview } from './SkillReview.js';

type InstallDialogProps = InstallFlowState & InstallFlowActions;

function LoadingContent() {
  return (
    <div className="flex flex-col items-center justify-center py-8 gap-3">
      <div className="h-8 w-8 animate-spin border-2 border-lobster-red border-t-transparent" />
      <p className="text-sm text-shell">Loading package...</p>
    </div>
  );
}

function DoneContent({ onClose }: { onClose: () => void }) {
  return (
    <div className="flex flex-col items-center justify-center py-8 gap-3">
      <CheckCircle2 className="h-10 w-10 text-success" />
      <h3 className="text-base font-semibold text-sand">Installation Complete</h3>
      <p className="text-sm text-shell text-center">The package has been installed successfully.</p>
      <Button onClick={onClose} className="mt-2">
        Close
      </Button>
    </div>
  );
}

function ErrorContent({ error, onCancel }: { error: string; onCancel: () => void }) {
  return (
    <div className="flex flex-col items-center justify-center py-8 gap-3">
      <XCircle className="h-10 w-10 text-error" />
      <h3 className="text-base font-semibold text-sand">Installation Failed</h3>
      <p className="text-sm text-error text-center">{error}</p>
      <Button variant="outline" onClick={onCancel} className="mt-2">
        Close
      </Button>
    </div>
  );
}

/** Map step to dialog title */
function getDialogTitle(step: InstallDialogProps['step'], isSkillImport: boolean): string {
  switch (step) {
    case 'loading':
      return isSkillImport ? 'Loading Skill' : 'Loading Package';
    case 'review':
      return isSkillImport ? 'Import OpenClaw Skill' : 'Review Package';
    case 'bindings':
      return 'Configure Bindings';
    case 'installing':
      return 'Installing';
    case 'done':
      return 'Done';
    case 'error':
      return 'Error';
    default:
      return 'Install Package';
  }
}

export function InstallDialog(props: InstallDialogProps) {
  const {
    isOpen,
    step,
    plan,
    error,
    bindingValues,
    isSkillImport,
    skillValidation,
    confirmInstall,
    submitBindings,
    setBindingValue,
    cancel,
    close,
  } = props;

  // Don't render dialog in idle state
  if (step === 'idle' && !isOpen) return null;

  function renderContent() {
    switch (step) {
      case 'loading':
        return <LoadingContent />;

      case 'review':
        if (!plan) return <LoadingContent />;
        if (isSkillImport) {
          return (
            <SkillReview
              plan={plan}
              skillValidation={skillValidation}
              onApprove={confirmInstall}
              onCancel={cancel}
            />
          );
        }
        return <ManifestReview plan={plan} onApprove={confirmInstall} onCancel={cancel} />;

      case 'bindings':
        if (!plan) return <LoadingContent />;
        return (
          <BindingForm
            bindings={plan.bindings}
            bindingValues={bindingValues}
            onSetValue={setBindingValue}
            onSubmit={submitBindings}
            onCancel={cancel}
          />
        );

      case 'installing':
        return <InstallProgress currentStep={step} error={null} />;

      case 'done':
        return <DoneContent onClose={close} />;

      case 'error':
        return <ErrorContent error={error ?? 'Unknown error'} onCancel={cancel} />;

      default:
        return null;
    }
  }

  return (
    <Dialog
      open={isOpen}
      onOpenChange={(open) => {
        if (!open) cancel();
      }}
    >
      <DialogContent className="max-w-lg">
        <DialogHeader>
          <DialogTitle>{getDialogTitle(step, isSkillImport)}</DialogTitle>
          {step === 'review' && plan && (
            <DialogDescription>
              {isSkillImport
                ? 'Review the skill details before importing as a new employee.'
                : 'Review the package details before installing.'}
            </DialogDescription>
          )}
          {step === 'bindings' && (
            <DialogDescription>Configure model bindings for this package.</DialogDescription>
          )}
        </DialogHeader>
        {renderContent()}
      </DialogContent>
    </Dialog>
  );
}
