import type { SopDefinition } from '@offisim/shared-types';
import { useEffect, useMemo, useRef, useState } from 'react';
import { usePlanStepStore } from '../../hooks/plan-step-store';
import { useOffisimRuntimeStatus } from '../../runtime/offisim-runtime-context';

const CLEAR_WINDOW_MS = 3000;

export interface SopRunProgressStripProps {
  definition: SopDefinition;
  sopTemplateId: string;
}

export function SopRunProgressStrip({ definition, sopTemplateId }: SopRunProgressStripProps) {
  const store = usePlanStepStore();
  const { isRunning } = useOffisimRuntimeStatus();
  const [withinClearWindow, setWithinClearWindow] = useState(false);
  const wasRunningRef = useRef(false);

  // Mirror useSopRuntimeState's clearing contract: when a run stops, keep the
  // strip mounted for 3s of "just finished" copy; when a run starts, kill any
  // pending clear window so the strip stays mounted for the new run.
  // Only enter the clear window after a true running→stopped transition so
  // the strip never flashes terminal copy on initial mount.
  useEffect(() => {
    if (isRunning) {
      wasRunningRef.current = true;
      setWithinClearWindow(false);
      return;
    }
    if (!wasRunningRef.current) return;
    setWithinClearWindow(true);
    const timer = window.setTimeout(() => setWithinClearWindow(false), CLEAR_WINDOW_MS);
    return () => window.clearTimeout(timer);
  }, [isRunning]);

  const matchesThisSop = store.planId !== null && store.sopTemplateId === sopTemplateId;
  const shouldRender = matchesThisSop && (isRunning || withinClearWindow);

  const stats = useMemo(() => {
    if (!shouldRender) {
      return { totalSteps: 0, completedSteps: 0, failedSteps: 0, hasFailure: false };
    }
    let completedSteps = 0;
    let failedSteps = 0;
    for (const s of store.steps) {
      if (s.status === 'completed') completedSteps++;
      else if (s.status === 'failed') failedSteps++;
    }
    return {
      totalSteps: store.steps.length,
      completedSteps,
      failedSteps,
      hasFailure: failedSteps > 0,
    };
  }, [shouldRender, store.steps]);

  if (!shouldRender) return null;

  const totalSteps = stats.totalSteps || definition.steps.length;
  const currentIndex0 = store.currentStepIndex;
  const currentStep =
    currentIndex0 >= 0 ? store.steps.find((s) => s.stepIndex === currentIndex0) : null;
  const currentStepLabel =
    currentStep && definition.steps[currentIndex0]?.label
      ? definition.steps[currentIndex0]?.label
      : null;

  const totalTasks = store.stats.total;
  const completedTasks = store.stats.completed;

  const tone = stats.hasFailure ? 'danger' : isRunning ? 'active' : 'ok';

  let body: string;
  if (isRunning) {
    const stepN = currentIndex0 >= 0 ? currentIndex0 + 1 : 1;
    const labelPart = currentStepLabel ? ` · ${currentStepLabel}` : '';
    body = `Running step ${stepN} of ${totalSteps}${labelPart} · ${completedTasks}/${totalTasks} tasks`;
  } else if (stats.hasFailure) {
    body = `Run failed · ${stats.failedSteps} of ${totalSteps} steps failed`;
  } else {
    body = `Run completed · ${stats.completedSteps} of ${totalSteps} steps`;
  }

  return (
    <output aria-live="polite" className="sop-run-strip" data-tone={tone}>
      <span className="sop-run-strip-dot" data-tone={tone} />
      <span className="sop-run-strip-copy">{body}</span>
    </output>
  );
}
