import { Alert, AlertDescription, Progress } from '@offisim/ui-core';
/**
 * InstallProgress — shows install state machine progression.
 * Highlights the current step and displays errors if any.
 */

import { CheckCircle2, Circle, Loader2, XCircle } from 'lucide-react';
import type { InstallStep } from '../../hooks/useInstallFlow.js';

interface InstallProgressProps {
  currentStep: InstallStep;
  error: string | null;
}

interface StepDef {
  key: string;
  label: string;
}

const INSTALL_STEPS: StepDef[] = [
  { key: 'loading', label: 'Loading package' },
  { key: 'review', label: 'Reviewing manifest' },
  { key: 'bindings', label: 'Configuring bindings' },
  { key: 'installing', label: 'Installing assets' },
  { key: 'done', label: 'Complete' },
];

/** Map step to numeric progress */
function stepToProgress(step: InstallStep): number {
  switch (step) {
    case 'loading':
      return 10;
    case 'review':
      return 30;
    case 'bindings':
      return 50;
    case 'installing':
      return 75;
    case 'done':
      return 100;
    case 'error':
      return 0;
    default:
      return 0;
  }
}

/** Determine step status relative to current step */
function getStepStatus(
  stepKey: string,
  currentStep: InstallStep,
): 'completed' | 'active' | 'pending' | 'error' {
  if (currentStep === 'error') return 'error';

  const stepOrder = INSTALL_STEPS.map((s) => s.key);
  const currentIdx = stepOrder.indexOf(currentStep);
  const stepIdx = stepOrder.indexOf(stepKey);

  if (stepIdx < 0 || currentIdx < 0) return 'pending';
  if (stepIdx < currentIdx) return 'completed';
  if (stepIdx === currentIdx) return 'active';
  return 'pending';
}

function StepIcon({ status }: { status: 'completed' | 'active' | 'pending' | 'error' }) {
  const iconProps = {
    className: 'install-progress-icon',
    'data-status': status,
    'aria-hidden': 'true',
  } as const;
  switch (status) {
    case 'completed':
      return <CheckCircle2 {...iconProps} />;
    case 'active':
      return <Loader2 {...iconProps} />;
    case 'error':
      return <XCircle {...iconProps} />;
    default:
      return <Circle {...iconProps} />;
  }
}

export function InstallProgress({ currentStep, error }: InstallProgressProps) {
  const progress = stepToProgress(currentStep);

  return (
    <div className="install-progress">
      <div className="install-progress-head">
        <h3>
          {currentStep === 'installing'
            ? 'Installing...'
            : currentStep === 'done'
              ? 'Installation Complete'
              : 'Progress'}
        </h3>
      </div>

      {/* Progress bar */}
      <Progress value={progress} />

      {/* Step list */}
      <div className="install-progress-list">
        {INSTALL_STEPS.map((step) => {
          const status = getStepStatus(step.key, currentStep);
          return (
            <div key={step.key} className="install-progress-row">
              <StepIcon status={status} />
              <span data-status={status}>{step.label}</span>
            </div>
          );
        })}
      </div>

      {/* Error display */}
      {error && (
        <Alert variant="destructive">
          <XCircle className="install-progress-alert-icon" />
          <AlertDescription>{error}</AlertDescription>
        </Alert>
      )}
    </div>
  );
}
