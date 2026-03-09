/**
 * InstallProgress — shows install state machine progression.
 * Highlights the current step and displays errors if any.
 */

import { CheckCircle2, Circle, Loader2, XCircle } from 'lucide-react';
import { Progress } from '../ui/progress';
import { Alert, AlertDescription } from '../ui/alert';
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
function getStepStatus(stepKey: string, currentStep: InstallStep): 'completed' | 'active' | 'pending' | 'error' {
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
  switch (status) {
    case 'completed':
      return <CheckCircle2 className="h-4 w-4 text-success" />;
    case 'active':
      return <Loader2 className="h-4 w-4 text-accent animate-spin" />;
    case 'error':
      return <XCircle className="h-4 w-4 text-error" />;
    default:
      return <Circle className="h-4 w-4 text-text-muted" />;
  }
}

export function InstallProgress({ currentStep, error }: InstallProgressProps) {
  const progress = stepToProgress(currentStep);

  return (
    <div className="flex flex-col gap-4">
      <div>
        <h3 className="text-base font-semibold text-text-primary">
          {currentStep === 'installing' ? 'Installing...' : currentStep === 'done' ? 'Installation Complete' : 'Progress'}
        </h3>
      </div>

      {/* Progress bar */}
      <Progress value={progress} />

      {/* Step list */}
      <div className="space-y-2">
        {INSTALL_STEPS.map((step) => {
          const status = getStepStatus(step.key, currentStep);
          return (
            <div
              key={step.key}
              className="flex items-center gap-2 text-sm"
            >
              <StepIcon status={status} />
              <span
                className={
                  status === 'completed'
                    ? 'text-text-secondary'
                    : status === 'active'
                      ? 'text-text-primary font-medium'
                      : 'text-text-muted'
                }
              >
                {step.label}
              </span>
            </div>
          );
        })}
      </div>

      {/* Error display */}
      {error && (
        <Alert variant="destructive">
          <XCircle className="h-4 w-4" />
          <AlertDescription>{error}</AlertDescription>
        </Alert>
      )}
    </div>
  );
}
