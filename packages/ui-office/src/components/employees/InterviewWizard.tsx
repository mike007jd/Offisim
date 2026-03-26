import { Button, Dialog, DialogContent, DialogTitle, Progress } from '@aics/ui-core';
import { cn } from '@aics/ui-core';
import { ArrowLeft, ArrowRight, SkipForward, UserPlus } from 'lucide-react';
import { type UseInterviewWizardReturn, WIZARD_STEPS } from '../../hooks/useInterviewWizard';
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
  const {
    state,
    currentStepName,
    canProceed,
    isLastStep,
    isFirstStep,
    progress,
    isSubmitting,
    submit,
    next,
    back,
    skip,
    updateField,
    canSkip,
    reset,
  } = wizard;

  const handleClose = () => {
    reset();
    onClose();
  };

  const handleSubmit = async () => {
    await submit();
    onClose();
  };

  return (
    <Dialog
      open={isOpen}
      onOpenChange={(open) => {
        if (!open) handleClose();
      }}
    >
      <DialogContent className="max-w-2xl max-h-[90vh] flex flex-col overflow-hidden">
        <DialogTitle className="sr-only">Interview Onboarding Wizard</DialogTitle>

        {/* Progress bar — pinned header */}
        <div className="shrink-0 mb-4">
          <div className="flex items-center justify-between mb-2">
            <span className="text-xs font-monotext-slate-400 uppercase tracking-wider">
              Step {state.currentStep + 1} of {WIZARD_STEPS.length}: {STEP_LABELS[currentStepName]}
            </span>
            <span className="text-xs font-monotext-slate-400">{Math.round(progress * 100)}%</span>
          </div>
          <Progress value={progress * 100} />

          {/* Step dots */}
          <div className="flex items-center justify-center gap-1.5 mt-3">
            {WIZARD_STEPS.map((stepName, idx) => (
              <button
                key={stepName}
                type="button"
                onClick={() => {
                  if (state.completedSteps.has(idx) && idx !== state.currentStep) {
                    wizard.dispatch({ type: 'goto', step: idx });
                  }
                }}
                className={cn(
                  'w-2 h-2 rounded-full transition-colors',
                  idx === state.currentStep
                    ? 'bg-red-500'
                    : state.completedSteps.has(idx)
                      ? 'bg-emerald-500'
                      : 'bg-slate-700',
                )}
                title={STEP_LABELS[stepName]}
              />
            ))}
          </div>
        </div>

        {/* Scrollable middle: HR Prompt + Step Content */}
        <div className="min-h-0 flex-1 overflow-y-auto">
          {/* HR Prompt */}
          <div className="mb-4">
            <HRPrompt step={currentStepName} />
          </div>

          {/* Step Content */}
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
        </div>
        {/* end scrollable area */}

        {/* Footer Navigation — pinned */}
        <div className="shrink-0 flex items-center justify-between pt-4 border-t border-slate-700 mt-4">
          <div>
            {!isFirstStep && (
              <Button variant="outline" size="sm" onClick={back} disabled={isSubmitting}>
                <ArrowLeft className="h-3.5 w-3.5 mr-1" />
                Back
              </Button>
            )}
          </div>

          <div className="flex items-center gap-2">
            {canSkip && !isLastStep && (
              <Button variant="ghost" size="sm" onClick={skip} disabled={isSubmitting}>
                Skip
                <SkipForward className="h-3.5 w-3.5 ml-1" />
              </Button>
            )}

            {isLastStep ? (
              <Button size="sm" onClick={handleSubmit} disabled={isSubmitting}>
                {isSubmitting ? (
                  'Creating...'
                ) : (
                  <>
                    <UserPlus className="h-3.5 w-3.5 mr-1" />
                    Create Employee
                  </>
                )}
              </Button>
            ) : (
              <Button size="sm" onClick={next} disabled={!canProceed && !canSkip}>
                Next
                <ArrowRight className="h-3.5 w-3.5 ml-1" />
              </Button>
            )}
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}
