import { useEffect, useState } from 'react';
import { type PlanStep, type StepStatus, usePlanProgress } from '../../hooks/usePlanProgress';
import { Badge } from '../ui/badge';
import { Progress } from '../ui/progress';

// ---------------------------------------------------------------------------
// Step status indicator
// ---------------------------------------------------------------------------

function StepIcon({ status }: { status: StepStatus }) {
  switch (status) {
    case 'completed':
      return (
        <span className="flex h-5 w-5 items-center justify-center bg-success/20 text-success">
          <svg
            aria-hidden="true"
            xmlns="http://www.w3.org/2000/svg"
            viewBox="0 0 16 16"
            fill="currentColor"
            className="h-3 w-3"
          >
            <path
              fillRule="evenodd"
              d="M12.416 3.376a.75.75 0 0 1 .208 1.04l-5 7.5a.75.75 0 0 1-1.154.114l-3-3a.75.75 0 0 1 1.06-1.06l2.353 2.353 4.493-6.74a.75.75 0 0 1 1.04-.207Z"
              clipRule="evenodd"
            />
          </svg>
        </span>
      );
    case 'active':
      return (
        <span className="relative flex h-5 w-5 items-center justify-center">
          <span className="absolute h-5 w-5 animate-ping bg-accent/30" />
          <span className="relative h-2.5 w-2.5 bg-accent" />
        </span>
      );
    default:
      return (
        <span className="flex h-5 w-5 items-center justify-center">
          <span className="h-2 w-2 bg-shell/40" />
        </span>
      );
  }
}

// ---------------------------------------------------------------------------
// Single step row
// ---------------------------------------------------------------------------

function StepRow({ step }: { step: PlanStep }) {
  return (
    <li className="flex items-start gap-2 py-1.5">
      <div className="mt-0.5 shrink-0">
        <StepIcon status={step.status} />
      </div>
      <div className="min-w-0 flex-1">
        <p
          className={`text-xs leading-snug ${
            step.status === 'completed'
              ? 'text-shell line-through'
              : step.status === 'active'
                ? 'text-sand font-medium'
                : 'text-shell'
          }`}
        >
          {step.description}
        </p>
        {step.status === 'active' && step.taskCount > 0 && (
          <span className="text-[10px] text-shell">
            {step.taskCount} task{step.taskCount !== 1 ? 's' : ''}
          </span>
        )}
      </div>
    </li>
  );
}

// ---------------------------------------------------------------------------
// Main panel
// ---------------------------------------------------------------------------

export function PlanProgressPanel() {
  const plan = usePlanProgress();
  const [collapsed, setCollapsed] = useState(false);

  // Auto-collapse 2s after plan completes
  useEffect(() => {
    if (!plan.isComplete) return;
    const timer = setTimeout(() => setCollapsed(true), 2000);
    return () => clearTimeout(timer);
  }, [plan.isComplete]);

  // Reset collapsed state when a new plan starts
  useEffect(() => {
    if (plan.planId) setCollapsed(false);
  }, [plan.planId]);

  // Don't render when no plan is active
  if (!plan.planId) return null;

  const completedCount = plan.steps.filter((s) => s.status === 'completed').length;
  const totalCount = plan.steps.length;
  const progressPct = totalCount > 0 ? Math.round((completedCount / totalCount) * 100) : 0;

  // Collapsed summary after completion
  if (collapsed && plan.isComplete) {
    return (
      <div className="border-b-2 border-ocean-light bg-ocean-mid/50 px-3 py-2">
        <button
          type="button"
          onClick={() => setCollapsed(false)}
          className="flex w-full items-center gap-2 text-left text-xs text-shell hover:text-shell transition-colors"
        >
          <span className="flex h-4 w-4 items-center justify-center bg-success/20 text-success">
            <svg
              aria-hidden="true"
              xmlns="http://www.w3.org/2000/svg"
              viewBox="0 0 16 16"
              fill="currentColor"
              className="h-2.5 w-2.5"
            >
              <path
                fillRule="evenodd"
                d="M12.416 3.376a.75.75 0 0 1 .208 1.04l-5 7.5a.75.75 0 0 1-1.154.114l-3-3a.75.75 0 0 1 1.06-1.06l2.353 2.353 4.493-6.74a.75.75 0 0 1 1.04-.207Z"
                clipRule="evenodd"
              />
            </svg>
          </span>
          Plan completed ({totalCount} step{totalCount !== 1 ? 's' : ''})
          <span className="ml-auto text-[10px] underline">show</span>
        </button>
      </div>
    );
  }

  return (
    <div className="border-b-2 border-ocean-light bg-ocean-mid/50">
      {/* Header */}
      <div className="flex items-center justify-between px-3 pt-2 pb-1">
        <h3 className="font-pixel-display text-[8px] uppercase tracking-wider text-shell">
          Plan Progress
        </h3>
        <div className="flex items-center gap-1.5">
          {plan.isComplete ? (
            <Badge variant="success" className="text-[10px] px-1.5 py-0">
              Done
            </Badge>
          ) : (
            <Badge variant="info" className="text-[10px] px-1.5 py-0">
              {completedCount}/{totalCount}
            </Badge>
          )}
          {plan.isComplete && (
            <button
              type="button"
              onClick={() => setCollapsed(true)}
              className="text-[10px] text-shell hover:text-shell underline"
            >
              hide
            </button>
          )}
        </div>
      </div>

      {/* Progress bar */}
      <div className="px-3 pb-1">
        <Progress value={progressPct} />
      </div>

      {/* Step list */}
      <ul className="px-3 pb-2">
        {plan.steps.map((step) => (
          <StepRow key={step.stepIndex} step={step} />
        ))}
      </ul>
    </div>
  );
}
