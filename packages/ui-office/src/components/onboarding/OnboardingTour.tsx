import { Button } from '@offisim/ui-core';
import { useLayoutEffect, useMemo, useRef, useState } from 'react';
import { useTourTargetElement } from './tour-context.js';
import { TOUR_STEPS, type TourStep } from './tour-steps.js';

interface TargetRect {
  top: number;
  left: number;
  width: number;
  height: number;
}

export interface OnboardingTourProps {
  activeWorkspace: TourStep['workspace'];
  completedStepIds: ReadonlySet<string>;
  dismissed: boolean;
  suppressed?: boolean;
  onCompleteStep: (stepId: string) => void;
  onBackStep: (stepId: string) => void;
  onDismiss: () => void;
  onSwitchWorkspace: (workspace: TourStep['workspace']) => void;
}

function rectsEqual(a: TargetRect | null, b: TargetRect | null): boolean {
  if (a === b) return true;
  if (!a || !b) return false;
  return a.top === b.top && a.left === b.left && a.width === b.width && a.height === b.height;
}

function useElementRect(element: HTMLElement | null): TargetRect | null {
  const [rect, setRect] = useState<TargetRect | null>(null);
  const rafRef = useRef<number | null>(null);

  useLayoutEffect(() => {
    if (!element) {
      setRect(null);
      return;
    }

    const measure = () => {
      if (rafRef.current !== null) return;
      rafRef.current = requestAnimationFrame(() => {
        rafRef.current = null;
        const nextRect = element.getBoundingClientRect();
        const next = {
          top: nextRect.top,
          left: nextRect.left,
          width: nextRect.width,
          height: nextRect.height,
        };
        setRect((prev) => (rectsEqual(prev, next) ? prev : next));
      });
    };

    measure();
    const observer = new ResizeObserver(measure);
    observer.observe(element);
    window.addEventListener('resize', measure);
    window.addEventListener('scroll', measure, { capture: true, passive: true });
    return () => {
      observer.disconnect();
      window.removeEventListener('resize', measure);
      window.removeEventListener('scroll', measure, true);
      if (rafRef.current !== null) cancelAnimationFrame(rafRef.current);
    };
  }, [element]);

  return rect;
}

function computeHintPosition(rect: TargetRect | null) {
  const cardWidth = 320;
  if (!rect) return { left: '50%', bottom: 24, transform: 'translateX(-50%)', width: cardWidth };
  const gap = 12;
  const viewportPadding = 8;
  const estimatedCardHeight = 180;
  const placeAbove = rect.top > window.innerHeight / 2;
  const left = Math.min(
    Math.max(viewportPadding, rect.left + rect.width / 2 - cardWidth / 2),
    window.innerWidth - cardWidth - viewportPadding,
  );
  return placeAbove
    ? { left, bottom: window.innerHeight - rect.top + gap, width: cardWidth }
    : {
        left,
        top: Math.min(rect.top + rect.height + gap, window.innerHeight - estimatedCardHeight),
        width: cardWidth,
      };
}

function workspaceLabel(workspace: TourStep['workspace']): string {
  switch (workspace) {
    case 'activity-log':
      return 'Activity';
    case 'market':
      return 'Market';
    case 'office':
      return 'Office';
    case 'personnel':
      return 'Personnel';
    case 'workspace':
      return 'Workspace';
    case 'settings':
      return 'Settings';
    case 'sops':
      return 'SOPs';
  }
}

export function OnboardingTour({
  activeWorkspace,
  completedStepIds,
  dismissed,
  suppressed = false,
  onCompleteStep,
  onBackStep,
  onDismiss,
  onSwitchWorkspace,
}: OnboardingTourProps) {
  const { activeStep, activeIndex } = useMemo(() => {
    if (dismissed) return { activeStep: null, activeIndex: -1 };
    const index = TOUR_STEPS.findIndex((step) => !completedStepIds.has(step.id));
    return index === -1
      ? { activeStep: null, activeIndex: -1 }
      : { activeStep: TOUR_STEPS[index], activeIndex: index };
  }, [completedStepIds, dismissed]);
  const target = useTourTargetElement(activeStep?.slot ?? 'office:chat-input');
  const targetAvailable = activeStep && activeStep.workspace === activeWorkspace && target;
  const rect = useElementRect(targetAvailable ? target : null);
  const position = useMemo(() => computeHintPosition(rect), [rect]);
  const ringStyle = useMemo(
    () =>
      rect
        ? {
            top: rect.top - 4,
            left: rect.left - 4,
            width: rect.width + 8,
            height: rect.height + 8,
          }
        : null,
    [rect],
  );

  if (!activeStep || suppressed) return null;
  const isLastStep = activeIndex === TOUR_STEPS.length - 1;
  const previousStep = activeIndex > 0 ? TOUR_STEPS[activeIndex - 1] : null;
  const needsWorkspaceSwitch = activeStep.workspace !== activeWorkspace || !target;
  const centeredPosition = {
    left: '50%',
    top: '50%',
    transform: 'translate(-50%, -50%)',
    width: 320,
  };

  return (
    <>
      {ringStyle && !needsWorkspaceSwitch && (
        <div
          className="pointer-events-none fixed z-top rounded-xl ring-2 ring-accent/70 shadow-glow-accent transition-all duration-normal"
          // ui-hardcode-allowed: runtime geometry or third-party primitive style bridge.
          style={ringStyle}
        />
      )}
      <div
        className="pointer-events-auto fixed z-top rounded-2xl border border-border-default bg-surface-elevated p-4 shadow-modal"
        // ui-hardcode-allowed: runtime geometry or third-party primitive style bridge.
        style={needsWorkspaceSwitch ? centeredPosition : position}
        data-onboarding-step={activeStep.id}
      >
        <p className="text-caption uppercase tracking-wider text-accent-text">
          Step {activeIndex + 1} of {TOUR_STEPS.length}
        </p>
        <h2 className="mt-2 text-sm font-semibold text-text-primary">{activeStep.title}</h2>
        <p className="mt-1.5 text-xs leading-relaxed text-text-secondary">
          {needsWorkspaceSwitch
            ? `Switch to ${workspaceLabel(activeStep.workspace)} to continue.`
            : activeStep.body}
        </p>
        <div className="mt-3 flex items-center justify-between gap-2">
          <Button
            type="button"
            disabled={!previousStep}
            onClick={() => {
              if (!previousStep) return;
              onBackStep(previousStep.id);
              onSwitchWorkspace(previousStep.workspace);
            }}
            variant="secondary"
            size="sm"
            className="h-7 px-3 text-caption disabled:cursor-not-allowed disabled:opacity-45"
          >
            Back
          </Button>
          <div className="flex items-center gap-2">
            <Button
              type="button"
              onClick={onDismiss}
              variant="secondary"
              size="sm"
              className="h-7 px-3 text-caption"
            >
              {activeStep.secondaryActionLabel ?? 'Skip'}
            </Button>
            <Button
              type="button"
              onClick={() => {
                if (needsWorkspaceSwitch) {
                  onSwitchWorkspace(activeStep.workspace);
                  return;
                }
                onCompleteStep(activeStep.id);
              }}
              size="sm"
              className="h-7 px-3 text-caption"
            >
              {needsWorkspaceSwitch
                ? `Switch to ${workspaceLabel(activeStep.workspace)}`
                : (activeStep.primaryActionLabel ?? (isLastStep ? 'Done' : 'Next'))}
            </Button>
          </div>
        </div>
      </div>
    </>
  );
}
