import {
  Alert,
  AlertDescription,
  Button,
  DialogShell,
  Progress,
  ToastBanner,
  useToasts,
} from '@offisim/ui-core';
import { cn } from '@offisim/ui-core';
import { ArrowLeft, ArrowRight, SkipForward, UserPlus } from 'lucide-react';
import { useCallback, useMemo } from 'react';
import {
  DEFAULT_WIZARD_FORM,
  type UseInterviewWizardReturn,
  WIZARD_STEPS,
} from '../../hooks/useInterviewWizard';
import { showDiscardConfirm } from '../../lib/discard-confirm-toast';
import { AppearanceStep } from './interview-steps/AppearanceStep';
import { ExpertiseStep } from './interview-steps/ExpertiseStep';
import { HRPrompt } from './interview-steps/HRPrompt';
import { InstructionsStep } from './interview-steps/InstructionsStep';
import { ModelStep } from './interview-steps/ModelStep';
import { NameStep } from './interview-steps/NameStep';
import { PreviewStep } from './interview-steps/PreviewStep';
import { RoleStep } from './interview-steps/RoleStep';
import { StyleStep } from './interview-steps/StyleStep';

/** Human-readable step labels for the progress indicator. */
const STEP_LABELS: Record<(typeof WIZARD_STEPS)[number], string> = {
  role: 'Role',
  name: 'Name',
  expertise: 'Expertise',
  style: 'Style',
  appearance: 'Appearance',
  instructions: 'Instructions',
  model: 'Model',
  preview: 'Preview',
};

interface InterviewWizardProps {
  isOpen: boolean;
  onClose: () => void;
  wizard: UseInterviewWizardReturn;
}

export function InterviewWizard({ isOpen, onClose, wizard }: InterviewWizardProps) {
  const { toasts, addToast, dismissToast } = useToasts();
  const {
    state,
    currentStepName,
    canProceed,
    isLastStep,
    isFirstStep,
    progress,
    isSubmitting,
    submit,
    error,
    clearError,
    next,
    back,
    skip,
    updateField,
    canSkip,
    reset,
  } = wizard;

  const isDirty = useMemo(
    () =>
      state.currentStep !== 0 ||
      state.completedSteps.size > 0 ||
      JSON.stringify(state.formData) !== JSON.stringify(DEFAULT_WIZARD_FORM),
    [state.completedSteps, state.currentStep, state.formData],
  );

  const discardAndClose = useCallback(() => {
    reset();
    onClose();
  }, [onClose, reset]);

  const requestClose = useCallback(() => {
    if (!isDirty) {
      discardAndClose();
      return;
    }
    showDiscardConfirm(addToast, { onDiscard: discardAndClose });
  }, [addToast, discardAndClose, isDirty]);

  const handleRequestClose = useCallback(() => {
    if (!isDirty) {
      reset();
      return undefined;
    }
    showDiscardConfirm(addToast, { onDiscard: discardAndClose });
    return false;
  }, [addToast, discardAndClose, isDirty, reset]);

  const handleSubmit = async () => {
    const ok = await submit();
    if (ok) onClose();
  };

  return (
    <>
      <DialogShell
        open={isOpen}
        onOpenChange={(open) => {
          if (!open) requestClose();
        }}
        size="lg"
        title="Interview Onboarding Wizard"
        description={`Step ${state.currentStep + 1} of ${WIZARD_STEPS.length}: ${STEP_LABELS[currentStepName]}`}
        onRequestClose={handleRequestClose}
        footer={
          <div className="flex w-full items-center justify-between gap-3">
            <div>
              {!isFirstStep && (
                <Button variant="outline" size="sm" onClick={back} disabled={isSubmitting}>
                  <ArrowLeft className="mr-1 h-3.5 w-3.5" />
                  Back
                </Button>
              )}
            </div>

            <div className="flex items-center gap-2">
              {canSkip && !isLastStep && (
                <Button variant="ghost" size="sm" onClick={skip} disabled={isSubmitting}>
                  Skip
                  <SkipForward className="ml-1 h-3.5 w-3.5" />
                </Button>
              )}

              {isLastStep ? (
                <Button onClick={handleSubmit} disabled={isSubmitting}>
                  {isSubmitting ? (
                    'Creating...'
                  ) : (
                    <>
                      <UserPlus className="mr-1 size-3.5" />
                      Create Employee
                    </>
                  )}
                </Button>
              ) : (
                <Button size="sm" onClick={next} disabled={!canProceed && !canSkip}>
                  Next
                  <ArrowRight className="ml-1 size-3.5" />
                </Button>
              )}
            </div>
          </div>
        }
      >
        <div className="mb-4">
          <div className="mb-2 flex items-center justify-between">
            <span className="font-mono text-xs uppercase tracking-wider text-text-muted">
              Step {state.currentStep + 1} of {WIZARD_STEPS.length}: {STEP_LABELS[currentStepName]}
            </span>
            <span className="font-mono text-xs text-text-muted">{Math.round(progress * 100)}%</span>
          </div>
          <Progress value={progress * 100} />

          <div className="mt-3 flex items-center justify-center gap-1">
            {WIZARD_STEPS.map((stepName, idx) => (
              <Button
                key={stepName}
                type="button"
                variant="ghost"
                size="icon"
                aria-label={`Step ${idx + 1}: ${STEP_LABELS[stepName]}`}
                onClick={() => {
                  if (state.completedSteps.has(idx) && idx !== state.currentStep) {
                    wizard.dispatch({ type: 'goto', step: idx });
                  }
                }}
                className={cn(
                  'size-6 rounded-full text-caption font-semibold',
                  idx === state.currentStep
                    ? 'bg-accent text-text-inverse'
                    : state.completedSteps.has(idx)
                      ? 'cursor-pointer bg-success text-text-inverse hover:bg-success'
                      : 'bg-surface-disabled text-text-disabled',
                )}
                title={STEP_LABELS[stepName]}
              >
                {idx + 1}
              </Button>
            ))}
          </div>
        </div>

        <div className="mb-4">
          <HRPrompt step={currentStepName} />
        </div>

        <div className="min-h-0">
          {currentStepName === 'role' && (
            <RoleStep formData={state.formData} updateField={updateField} />
          )}
          {currentStepName === 'name' && (
            <NameStep formData={state.formData} updateField={updateField} />
          )}
          {currentStepName === 'expertise' && (
            <ExpertiseStep formData={state.formData} updateField={updateField} />
          )}
          {currentStepName === 'style' && (
            <StyleStep formData={state.formData} updateField={updateField} />
          )}
          {currentStepName === 'appearance' && (
            <AppearanceStep formData={state.formData} updateField={updateField} />
          )}
          {currentStepName === 'instructions' && (
            <InstructionsStep formData={state.formData} updateField={updateField} />
          )}
          {currentStepName === 'model' && (
            <ModelStep formData={state.formData} updateField={updateField} />
          )}
          {currentStepName === 'preview' && <PreviewStep formData={state.formData} />}
        </div>

        {error && (
          <Alert variant="destructive" className="mt-4 flex items-start justify-between gap-3">
            <AlertDescription className="flex-1 text-xs">{error}</AlertDescription>
            <Button
              type="button"
              variant="ghost"
              size="sm"
              onClick={clearError}
              className="h-auto p-0 font-mono text-caption uppercase tracking-wider text-error hover:text-error"
            >
              Dismiss
            </Button>
          </Alert>
        )}
      </DialogShell>
      <ToastBanner toasts={toasts} onDismiss={dismissToast} />
    </>
  );
}
